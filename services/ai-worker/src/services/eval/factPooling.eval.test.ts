/**
 * Fact pooling runner (memory 1b, slice 0).
 *
 * For each REAL conversation golden it mirrors production's fact-retrieval
 * inputs (the conditional-fold search query), pulls a WIDE candidate set from
 * the live dev fact store (top-N by similarity, plus top-M by salience and by
 * recency so the pool covers what any composite policy could surface — not
 * just what today's ordering favors), persists every §3.4 scoring input per
 * candidate, and emits owner judgment sheets.
 *
 * The persisted pool (`fact-pool.json`) is the policy simulator's input: any
 * deterministic weight vector is scoreable retroactively via
 * `factPoolScoring.withPolicyArm` + the shared `poolScoring` instruments,
 * without re-running retrieval or re-judging. Only candidates surfaced in a
 * display arm's top-K appear on the sheet (TREC shallow pooling: persisted-
 * but-unjudged candidates score as not-relevant).
 *
 * NOT a CI test and NOT hermetic: queries a LIVE prod-synced dev store
 * (persona-wide, matching the owner's shareLtmAcrossPersonalities=ON).
 * Run AFTER the fact backfill completes:
 *   `EVAL_MEMORY_DATABASE_URL=<dev-url> pnpm eval:fact-goldens`
 * Skips itself when the env var or goldens file is absent. Output is
 * LOCAL-ONLY (gitignored `reports/goldens-mining/`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@tzurot/common-types/services/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { buildSearchQuery } from '../prompt/SearchQueryBuilder.js';
import { shouldFoldSearchQuery } from '../prompt/queryFoldGate.js';
import { extractRecentHistoryWindow } from '../RAGUtils.js';
import { isLexicalEcho } from './nonCircularityGuard.js';
import {
  FACT_WEIGHT_GRID,
  compositePolicy,
  prodOrderingComparator,
  repetitionOverlap,
  tierRankLift,
  withPolicyArm,
  type FactGoldenPool,
  type FactPooledCandidate,
} from './factPoolScoring.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const GOLDENS_PATH = join(WORK_DIR, 'conversation-goldens.json');
const DB_URL = process.env.EVAL_MEMORY_DATABASE_URL;

/** Sheet depth per display arm — same TREC-style shallow pooling as the episode pool. */
const POOL_K = 10;
/** Wide-set sizes: similarity is the primary universe; salience/recency widen it so
 * composite policies can surface candidates today's ordering never would. */
const WIDE_SIM_LIMIT = 50;
const WIDE_AUX_LIMIT = 20;
const PROD_FOLD_TURNS = AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS;

interface ConversationTurn {
  role: string;
  content: string;
  createdAt: string;
}

interface ConversationGolden {
  id: string;
  channelId: string;
  personaId: string;
  personalityId: string;
  message: string;
  messageMetadata: unknown;
  createdAt: string;
  style: string;
  priorHistory: ConversationTurn[];
}

interface FactRow {
  id: string;
  statement: string;
  entity_tags: string[];
  salience: number;
  tier: string;
  valid_from: Date;
  similarity: number;
}

const ready = DB_URL !== undefined && DB_URL.length > 0 && existsSync(GOLDENS_PATH);

describe.skipIf(!ready)('fact pooling (live dev fact store)', () => {
  let prisma: PrismaClient;
  let embeddings: LocalEmbeddingService;
  let goldens: ConversationGolden[];
  const pools: FactGoldenPool[] = [];
  const runNowMs = Date.now();

  beforeAll(async () => {
    goldens = (JSON.parse(readFileSync(GOLDENS_PATH, 'utf8')) as { goldens: ConversationGolden[] })
      .goldens;

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DB_URL }),
    }) as PrismaClient;

    embeddings = new LocalEmbeddingService();
    const initialized = await embeddings.initialize();
    if (!initialized) {
      throw new Error('Local embedding model failed to initialize — fact pooling cannot run');
    }
  }, 900_000);

  afterAll(async () => {
    if (pools.length > 0) {
      writeFileSync(
        join(WORK_DIR, 'fact-pool.json'),
        `${JSON.stringify({ nowMs: runNowMs, pools }, null, 2)}\n`
      );
      writeFileSync(join(WORK_DIR, 'fact-judgment-sheets.md'), buildFactJudgmentSheets(pools));
      console.log(buildMechanicalReport(pools));
      console.log(
        `\n=== fact pooling: ${pools.length} goldens → ${WORK_DIR}/fact-judgment-sheets.md ===`
      );
    }
    await prisma?.$disconnect();
    await embeddings?.shutdown();
  });

  it('pools fact candidates for every golden', { timeout: 1_800_000 }, async () => {
    for (const golden of goldens) {
      const turns = golden.priorHistory.map(turn => ({ role: turn.role, content: turn.content }));
      const foldWindowText = extractRecentHistoryWindow(turns, PROD_FOLD_TURNS) ?? '';

      // Mirror production's conditional-fold query construction: the SAME
      // searchQuery feeds fact retrieval and episode retrieval in production
      // (factRetrievalHelper receives ConversationInputProcessor's output).
      const folded = shouldFoldSearchQuery(golden.message);
      const searchQuery = folded
        ? buildSearchQuery(golden.message, [], undefined, foldWindowText)
        : golden.message;

      const rawEmbedding = await embeddings.getEmbedding(searchQuery);
      if (rawEmbedding === undefined || rawEmbedding.length === 0) {
        throw new Error(`Embedding service returned no embedding for golden ${golden.id}`);
      }
      const wideSet = await fetchWideCandidateSet(prisma, golden.personaId, [...rawEmbedding]);

      // Base pool with the production-ordering arm ranked over the FULL wide set.
      const prodSorted = [...wideSet].sort(prodOrderingComparator);
      const basePool: FactGoldenPool = {
        goldenId: golden.id,
        message: golden.message,
        style: golden.style,
        // Metadata-only for facts (validFrom doesn't map onto the conversation
        // window). Empty history → MAX_SAFE_INTEGER, not Math.min()'s Infinity,
        // which JSON.stringify silently corrupts to null in the persisted pool.
        oldestHistoryMs:
          golden.priorHistory.length === 0
            ? Number.MAX_SAFE_INTEGER
            : Math.min(...golden.priorHistory.map(turn => new Date(turn.createdAt).getTime())),
        arms: ['prod'],
        channelId: golden.channelId,
        searchQuery,
        folded,
        candidates: prodSorted.map((candidate, index) => ({
          ...candidate,
          verdict: isLexicalEcho(candidate.contentPreview, foldWindowText) ? 'echo' : 'eligible',
          ranks: { prod: index + 1 },
        })),
      };

      // Pre-registered composite arms — derived from the SAME persisted metadata
      // the offline simulator will use, so sheet coverage matches simulability.
      let pool = basePool;
      for (const weights of FACT_WEIGHT_GRID) {
        pool = withPolicyArm(pool, weights.name, compositePolicy(weights, runNowMs));
      }
      pools.push(pool);
    }
    expect(pools).toHaveLength(goldens.length);
  });
});

/**
 * Wide candidate set: top-N by similarity ∪ top-M by salience ∪ top-M by
 * recency, deduped. Scope mirrors `FactStore.findSimilarActiveFacts`'s
 * WIDENED branch (personalityId = null per the owner's
 * shareLtmAcrossPersonalities=ON; the personality filter is omitted rather
 * than parameterized, so the narrower personality-scoped branch is not
 * reproducible here) with the same active-only predicates — the aux fetches
 * only change the ORDER BY, never the WHERE. Persona is always a concrete
 * uuid: world/canon facts (persona_id IS NULL) never enter this pool, so
 * reusing this bench for canon-fact tuning would need a persona IS NULL
 * variant.
 */
async function fetchWideCandidateSet(
  prisma: PrismaClient,
  personaId: string,
  embedding: number[]
): Promise<Omit<FactPooledCandidate, 'verdict' | 'ranks'>[]> {
  const bySimilarity = await fetchFactArm(prisma, personaId, embedding, 'similarity');
  const bySalience = await fetchFactArm(prisma, personaId, embedding, 'salience');
  const byRecency = await fetchFactArm(prisma, personaId, embedding, 'recency');

  const deduped = new Map<string, FactRow>();
  for (const row of [...bySimilarity, ...bySalience, ...byRecency]) {
    if (!deduped.has(row.id)) {
      deduped.set(row.id, row);
    }
  }
  return [...deduped.values()].map(row => ({
    corpusId: row.id,
    createdAtMs: new Date(row.valid_from).getTime(),
    contentPreview: row.statement.replace(/\s+/g, ' ').slice(0, 240),
    similarity: row.similarity,
    salience: row.salience,
    tier: row.tier,
    entityTags: row.entity_tags,
  }));
}

/** One ordered fetch. Same SELECT + WHERE for every arm; ORDER BY varies. */
async function fetchFactArm(
  prisma: PrismaClient,
  personaId: string,
  embedding: number[],
  orderBy: 'similarity' | 'salience' | 'recency'
): Promise<FactRow[]> {
  // Prisma.raw() for the vector literal is safe here for the same reasons as
  // the production call sites (PgvectorQueryBuilder, findSimilarActiveFacts):
  // pgvector's '[n,n,...]' format can't be parameterized, and embeddingVector
  // is constructed from a numeric array only — never user-controlled text.
  const embeddingVector = `[${embedding.join(',')}]`;
  const orderSql =
    orderBy === 'similarity'
      ? Prisma.raw(`f.embedding <=> '${embeddingVector}'::vector ASC`)
      : orderBy === 'salience'
        ? Prisma.raw(`f.salience DESC, f.embedding <=> '${embeddingVector}'::vector ASC`)
        : Prisma.raw(`f.valid_from DESC, f.embedding <=> '${embeddingVector}'::vector ASC`);
  const limit = orderBy === 'similarity' ? WIDE_SIM_LIMIT : WIDE_AUX_LIMIT;

  return prisma.$queryRaw<FactRow[]>(
    Prisma.join(
      [
        Prisma.sql`
      SELECT f.id, f.statement, f.entity_tags, f.salience, f.tier, f.valid_from,
             1 - (f.embedding <=> `,
        Prisma.raw(`'${embeddingVector}'::vector`),
        Prisma.sql`) AS similarity
      FROM memory_facts f
      WHERE f.persona_id = ${personaId}::uuid
        AND f.superseded_at IS NULL
        AND f.forgotten = false
        AND f.visibility = 'normal'
        AND f.embedding IS NOT NULL
      ORDER BY `,
        orderSql,
        Prisma.sql`
      LIMIT ${limit}
    `,
      ],
      ''
    )
  );
}

/**
 * Judgment sheets: only candidates inside a display arm's top-K are listed
 * (bounded judging burden); the persisted pool keeps the full wide set.
 * Salience/tier/entity-tags ride inline so the wrong-entity class is
 * judgeable from the sheet without DB lookups.
 */
function buildFactJudgmentSheets(pools: FactGoldenPool[]): string {
  const lines = [
    '# Fact pooled-judgment sheets (memory 1b)',
    '',
    'For each golden: mark every candidate `[R]` relevant (this fact SHOULD inform the',
    "reply), `[S]` sort-of, or leave `[ ]`. Judge the fact's usefulness for THIS turn,",
    'not its general truth. Rank badges: `P`=production ordering, then the pre-registered',
    'composite arms (`SH`=sim-heavy, `BA`=balanced, `RH`=rec-heavy). `⊘echo` marks facts',
    'the fold window already carries — they cannot earn credit even if marked relevant.',
    '',
  ];
  for (const pool of pools) {
    lines.push(
      '---',
      '',
      `## ${pool.goldenId.slice(0, 8)} (${pool.style}${pool.folded ? ', folded' : ''})`,
      '',
      `> ${pool.message}`,
      ''
    );
    const display = pool.candidates
      .filter(candidate => Object.values(candidate.ranks).some(rank => rank >= 1 && rank <= POOL_K))
      .sort((a, b) => bestRank(a) - bestRank(b));
    for (const candidate of display) {
      const badges = [
        rankBadge(candidate, 'prod', 'P'),
        rankBadge(candidate, 'sim-heavy', 'SH'),
        rankBadge(candidate, 'balanced', 'BA'),
        rankBadge(candidate, 'rec-heavy', 'RH'),
        candidate.verdict !== 'eligible' ? `⊘${candidate.verdict}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const meta = `sal=${candidate.salience.toFixed(2)} tier=${candidate.tier}${
        candidate.entityTags.length > 0 ? ` tags=[${candidate.entityTags.join(', ')}]` : ''
      }`;
      lines.push(
        `- [ ] \`${candidate.corpusId.slice(0, 8)}\` ${badges} · ${meta}`,
        `      ${candidate.contentPreview}…`,
        ''
      );
    }
  }
  return lines.join('\n');
}

/** Pre-judging mechanical metrics — comparable before/after any ranking change. */
function buildMechanicalReport(pools: FactGoldenPool[]): string {
  const arms = ['prod', ...FACT_WEIGHT_GRID.map(weights => weights.name)];
  const lines = ['', '=== mechanical metrics (no judgments needed) ==='];
  for (const arm of arms) {
    const overlap = repetitionOverlap(pools, arm, POOL_K);
    const lift = tierRankLift(pools, arm);
    lines.push(
      `${arm}: same-channel top-${POOL_K} overlap ${overlap.meanJaccard.toFixed(3)} over ` +
        `${overlap.pairs} pairs · corrected-tier mean rank ` +
        `${lift.correctedCandidates === 0 ? 'n/a (0 corrected facts pooled)' : lift.meanCorrectedRank.toFixed(1)} ` +
        `(${lift.correctedCandidates} corrected)`
    );
  }
  return lines.join('\n');
}

function bestRank(candidate: FactPooledCandidate): number {
  const ranks = Object.values(candidate.ranks).filter(rank => rank >= 1);
  return ranks.length === 0 ? 99 : Math.min(...ranks);
}

function rankBadge(candidate: FactPooledCandidate, arm: string, label: string): string | null {
  const rank = candidate.ranks[arm];
  return rank === undefined || rank < 1 || rank > POOL_K ? null : `${label}#${rank}`;
}
