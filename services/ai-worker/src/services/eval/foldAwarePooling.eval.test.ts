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
import {
  denseArm,
  ftsArm,
  armSortKey,
  rankBadge,
  oldestHistoryMs,
  type RetrievedRow,
} from './poolingArms.js';
import type { PooledCandidate, GoldenPool } from './qrelsReconciliation.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const GOLDENS_PATH = join(WORK_DIR, 'conversation-goldens.json');
const DB_URL = process.env.EVAL_MEMORY_DATABASE_URL;

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
      const historyFloorMs = oldestHistoryMs(golden.priorHistory);
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
          { oldestHistoryMs: historyFloorMs, foldWindowText }
        ),
      }));

      pools.push({
        goldenId: golden.id,
        message: golden.message,
        style: golden.style,
        oldestHistoryMs: historyFloorMs,
        arms: [...Object.keys(denseQueries), 'bare-fts', `fold${PROD_FOLD_TURNS}-fts`],
        candidates,
      });
    }
    expect(pools).toHaveLength(goldens.length);
  });
});

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
