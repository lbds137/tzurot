/**
 * Fold-aware pooling runner (the honest re-baseline).
 *
 * Runs the retrieval A/B the way production actually retrieves: with the fold.
 * For each REAL conversation golden (mined via `memory:mine-conversation-goldens`)
 * it runs bare-vs-folded arms — dense (pgvector) and FTS — pools the top-K of
 * each into a judgment sheet, and flags every pooled candidate against the
 * non-circularity guard so a memory the fold window already contains can't count
 * as a "win".
 *
 * NOT a CI test and NOT hermetic: it queries a LIVE, prod-synced memory store
 * directly (dev), because the faithful corpus is the persona's FULL ~19k memory
 * pool with real embeddings — infeasible to re-embed into PGLite. Persona-wide
 * (no personality filter) matches the owner's shareLtmAcrossPersonalities=ON.
 *
 * Run: `EVAL_MEMORY_DATABASE_URL=<dev-url> pnpm eval:fold-goldens`. Skips itself
 * cleanly when the env var or the local goldens file is absent. Output (pool +
 * judgment sheet) is LOCAL-ONLY (gitignored `reports/goldens-mining/`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { PgvectorMemoryAdapter } from '../PgvectorMemoryAdapter.js';
import { buildSearchQuery } from '../prompt/SearchQueryBuilder.js';
import { extractRecentHistoryWindow } from '../RAGUtils.js';
import { classifyCandidate } from './nonCircularityGuard.js';
import type { PooledCandidate, GoldenPool } from './qrelsReconciliation.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const GOLDENS_PATH = join(WORK_DIR, 'conversation-goldens.json');
const DB_URL = process.env.EVAL_MEMORY_DATABASE_URL;

/** Pool depth per arm — TREC-style shallow pools judge fine at 10. */
const POOL_K = 10;
/** Over-fetch before chunk-dedup so a deduped arm still fills K distinct candidates. */
const OVERFETCH = POOL_K * 2;
/** Floor threshold: let ranking (not the production cutoff) decide the pool. */
const SCORE_FLOOR = 0.01;
/** Fold depths swept: production is 3; 5/8 probe whether more context helps. */
const FOLD_TURN_COUNTS = [3, 5, 8] as const;
/** The production fold depth — its window text is what the guard checks against.
 * Sourced from the same constant production uses so it can't drift from a stale literal. */
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

/**
 * Transient during pooling — carries the FULL memory content the guard must see.
 * A truncated preview would let a verbatim fold-window overlap past the cutoff
 * slip through as `eligible`, flattering the folded arm; only the preview is
 * persisted (as `PooledCandidate.contentPreview`), never the full content.
 */
interface PoolingCandidate {
  corpusId: string;
  createdAtMs: number;
  content: string;
  ranks: Record<string, number>;
}

const ready = DB_URL !== undefined && DB_URL.length > 0 && existsSync(GOLDENS_PATH);

describe.skipIf(!ready)('fold-aware pooling (live dev memory store)', () => {
  let prisma: PrismaClient;
  let embeddings: LocalEmbeddingService;
  let adapter: PgvectorMemoryAdapter;
  let goldens: ConversationGolden[];
  const pools: GoldenPool[] = [];

  beforeAll(async () => {
    goldens = (JSON.parse(readFileSync(GOLDENS_PATH, 'utf8')) as { goldens: ConversationGolden[] })
      .goldens;

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DB_URL }),
    }) as PrismaClient;

    embeddings = new LocalEmbeddingService();
    const initialized = await embeddings.initialize();
    if (!initialized) {
      throw new Error('Local embedding model failed to initialize — pooling cannot run');
    }
    adapter = new PgvectorMemoryAdapter(prisma, embeddings);
  }, 900_000);

  afterAll(async () => {
    if (pools.length > 0) {
      writeFileSync(join(WORK_DIR, 'fold-pool.json'), `${JSON.stringify({ pools }, null, 2)}\n`);
      writeFileSync(join(WORK_DIR, 'fold-judgment-sheets.md'), buildJudgmentSheets(pools));
      console.log(
        `\n=== fold-aware pooling: ${pools.length} goldens → ${WORK_DIR}/fold-judgment-sheets.md ===`
      );
    }
    await prisma?.$disconnect();
    await embeddings?.shutdown();
  });

  it('pools bare-vs-folded arms for every golden', { timeout: 1_800_000 }, async () => {
    for (const golden of goldens) {
      const turns = golden.priorHistory.map(turn => ({ role: turn.role, content: turn.content }));
      // Approximation of production's oldestHistoryTimestamp: computed from the mined
      // channel-scoped priorHistory (capped at historyWindow). Production can also fold
      // cross-channel timestamps in, which would push this slightly older — acceptable
      // for the temporal guard (a looser cutoff only makes the folded arm's bar HIGHER).
      const oldestHistoryMs = Math.min(
        ...golden.priorHistory.map(turn => new Date(turn.createdAt).getTime())
      );
      const foldWindowText = extractRecentHistoryWindow(turns, PROD_FOLD_TURNS) ?? '';

      // Build the arm → query map. Dense arms embed + pgvector; FTS arms lexical.
      const denseQueries: Record<string, string> = { 'bare-dense': golden.message };
      for (const n of FOLD_TURN_COUNTS) {
        denseQueries[`fold${n}-dense`] = buildSearchQuery(
          golden.message,
          [],
          undefined,
          extractRecentHistoryWindow(turns, n)
        );
      }

      const pooled = new Map<string, PoolingCandidate>();
      const record = (armName: string, rows: RetrievedRow[]): void => {
        rows.forEach((row, index) => {
          const existing = pooled.get(row.corpusId) ?? {
            corpusId: row.corpusId,
            createdAtMs: row.createdAtMs,
            // The first arm to surface a candidate sets its content. Dense hits are
            // placeholder-resolved ({user}→name) while FTS hits are raw SQL content;
            // the tiny token delta doesn't move the lexical-echo verdict in practice.
            content: row.content,
            ranks: {} as Record<string, number>,
          };
          existing.ranks[armName] = index + 1;
          pooled.set(row.corpusId, existing);
        });
      };

      for (const [armName, query] of Object.entries(denseQueries)) {
        record(armName, await denseArm(adapter, golden.personaId, query));
      }
      record('bare-fts', await ftsArm(prisma, golden.personaId, golden.message));
      record(
        `fold${PROD_FOLD_TURNS}-fts`,
        await ftsArm(prisma, golden.personaId, denseQueries[`fold${PROD_FOLD_TURNS}-dense`])
      );

      // The guard classifies against FULL content; only the preview is persisted.
      const candidates: PooledCandidate[] = [...pooled.values()].map(candidate => ({
        corpusId: candidate.corpusId,
        createdAtMs: candidate.createdAtMs,
        contentPreview: candidate.content.replace(/\s+/g, ' ').slice(0, 240),
        ranks: candidate.ranks,
        verdict: classifyCandidate(
          { createdAtMs: candidate.createdAtMs, content: candidate.content },
          { oldestHistoryMs, foldWindowText }
        ),
      }));

      pools.push({
        goldenId: golden.id,
        message: golden.message,
        style: golden.style,
        oldestHistoryMs,
        arms: [...Object.keys(denseQueries), 'bare-fts', `fold${PROD_FOLD_TURNS}-fts`],
        candidates,
      });
    }
    expect(pools).toHaveLength(goldens.length);
  });
});

interface RetrievedRow {
  corpusId: string;
  createdAtMs: number;
  content: string;
}

/**
 * Dense arm: the production retrieval path (embed → pgvector), persona-wide.
 * Over-fetches then dedups by chunk group (falling back to id) so chunk siblings
 * collapse to one candidate and the arm still yields K distinct rows — without the
 * over-fetch, a top-K crowded with same-source chunks would under-fill the pool.
 */
async function denseArm(
  adapter: PgvectorMemoryAdapter,
  personaId: string,
  query: string
): Promise<RetrievedRow[]> {
  const hits = await adapter.queryMemories(query, {
    personaId,
    limit: OVERFETCH,
    scoreThreshold: SCORE_FLOOR,
  });
  const seen = new Set<string>();
  const rows: RetrievedRow[] = [];
  for (const hit of hits) {
    const meta = hit.metadata as {
      id?: string;
      chunkGroupId?: string | null;
      createdAt?: number;
    };
    const corpusId = meta.chunkGroupId ?? meta.id;
    if (corpusId === undefined || corpusId === null || seen.has(corpusId)) {
      continue;
    }
    seen.add(corpusId);
    rows.push({ corpusId, createdAtMs: meta.createdAt ?? 0, content: hit.pageContent });
    if (rows.length >= POOL_K) {
      break;
    }
  }
  return rows;
}

interface FtsRow {
  id: string;
  content: string;
  created_at: Date;
  chunk_group_id: string | null;
}

/**
 * FTS arm: OR-of-lexemes over the message (plainto_tsquery ANDs every word, which
 * a conversational message never satisfies). Scoped by persona_id + visibility ONLY
 * — matching the dense arm's `buildWhereConditions` exactly (which has no `type`
 * filter), so both arms see the same candidate universe (incl. any knowledge-type
 * rows). Folding balloons the term set, so folded-FTS is near-degenerate — reported
 * for completeness; the decisive arm is folded-dense.
 */
async function ftsArm(
  prisma: PrismaClient,
  personaId: string,
  text: string
): Promise<RetrievedRow[]> {
  const orQuery = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1)
    .join(' | ');
  if (orQuery.length === 0) {
    return [];
  }
  const rows = await prisma.$queryRaw<FtsRow[]>`
    SELECT id, content, created_at, chunk_group_id
    FROM memories
    WHERE persona_id = ${personaId}::uuid
      AND visibility = 'normal'
      AND to_tsvector('english', content) @@ to_tsquery('english', ${orQuery})
    ORDER BY ts_rank(to_tsvector('english', content), to_tsquery('english', ${orQuery})) DESC
    LIMIT ${OVERFETCH * 2}
  `;
  const seen = new Set<string>();
  const out: RetrievedRow[] = [];
  for (const row of rows) {
    const corpusId = row.chunk_group_id ?? row.id;
    if (seen.has(corpusId)) {
      continue;
    }
    seen.add(corpusId);
    out.push({ corpusId, createdAtMs: new Date(row.created_at).getTime(), content: row.content });
    if (out.length >= POOL_K) {
      break;
    }
  }
  return out;
}

/** Build the owner/judge relevance sheet — one section per golden. */
function buildJudgmentSheets(pools: GoldenPool[]): string {
  const lines = [
    '# Fold-aware pooled-judgment sheets',
    '',
    'For each golden: mark every candidate `[R]` relevant, `[S]` sort-of, or leave `[ ]`.',
    'You judge ONLY what is listed. Rank badges show where each arm placed the candidate',
    '(`B`=bare-dense, `F3/F5/F8`=folded-dense at 3/5/8 turns, `Bf/F3f`=bare/folded FTS).',
    '`⊘in-window` / `⊘echo` mark candidates the non-circularity guard disqualifies — the',
    'fold window already contains them, so they DO NOT count even if you mark them relevant.',
    '',
  ];
  for (const pool of pools) {
    lines.push(
      '---',
      '',
      `## ${pool.goldenId.slice(0, 8)} (${pool.style})`,
      '',
      `> ${pool.message}`,
      ''
    );
    const sorted = [...pool.candidates].sort((a, b) => armSortKey(a) - armSortKey(b));
    for (const candidate of sorted) {
      const badges = [
        rankBadge(candidate, 'bare-dense', 'B'),
        rankBadge(candidate, 'fold3-dense', 'F3'),
        rankBadge(candidate, 'fold5-dense', 'F5'),
        rankBadge(candidate, 'fold8-dense', 'F8'),
        rankBadge(candidate, 'bare-fts', 'Bf'),
        rankBadge(candidate, 'fold3-fts', 'F3f'),
        candidate.verdict !== 'eligible' ? `⊘${candidate.verdict}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(
        `- [ ] \`${candidate.corpusId.slice(0, 8)}\` ${badges}`,
        `      ${candidate.contentPreview}…`,
        ''
      );
    }
  }
  return lines.join('\n');
}

/** Sort candidates by best (lowest) rank across the dense arms for sheet readability. */
function armSortKey(candidate: PooledCandidate): number {
  const ranks = Object.values(candidate.ranks);
  return ranks.length === 0 ? 99 : Math.min(...ranks);
}

function rankBadge(candidate: PooledCandidate, arm: string, label: string): string | null {
  const rank = candidate.ranks[arm];
  return rank === undefined ? null : `${label}#${rank}`;
}
