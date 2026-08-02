/**
 * Attachment-allocation pooling runner (TASK-393's A/B).
 *
 * For each REAL attachment-bearing golden (mined via
 * `memory:mine-attachment-goldens`) it runs the allocation arms from
 * `allocationArms.ts` — a dose-response sweep of how much attachment text the
 * search query carries (bare → lead → budget → current) — pools the top-K of
 * each into a judgment sheet, and flags every pooled candidate against the
 * non-circularity guard, exactly like the fold-aware re-baseline.
 *
 * The prior this tests against: the fold A/B measured dilution on content-rich
 * queries as monotonically harmful (recall@10 0.436 → 0.390 → 0.256 → 0.195 as
 * the fold widened). If `bare` wins here too, the fix is a gate like
 * `shouldFoldSearchQuery`, not a budget.
 *
 * NOT a CI test and NOT hermetic: it queries a LIVE, prod-synced memory store
 * directly (dev), same as `foldAwarePooling.eval.test.ts` (see its header for
 * why). Run: `EVAL_MEMORY_DATABASE_URL=<dev-url> pnpm eval:allocation-goldens`.
 * Skips itself cleanly when the env var or the local goldens file is absent.
 * Output is LOCAL-ONLY (gitignored `reports/goldens-mining/`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { LocalEmbeddingService } from '@tzurot/embeddings';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { PgvectorMemoryAdapter } from '../PgvectorMemoryAdapter.js';
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
import {
  buildAllocationQueries,
  ALLOCATION_DENSE_ARMS,
  ALLOCATION_FTS_ARM,
} from './allocationArms.js';
import type { PooledCandidate, GoldenPool } from './qrelsReconciliation.js';

const WORK_DIR = join(process.cwd(), 'reports/goldens-mining');
const GOLDENS_PATH = join(WORK_DIR, 'attachment-goldens.json');
const DB_URL = process.env.EVAL_MEMORY_DATABASE_URL;

/** The production fold depth — its window text is what the guard checks against. */
const PROD_FOLD_TURNS = AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS;

/** The FTS diversity arm pools lexical candidates the dense arms can't see. */
const FTS_ARM = ALLOCATION_FTS_ARM;

interface ConversationTurn {
  role: string;
  content: string;
  createdAt: string;
}

interface AttachmentGolden {
  id: string;
  channelId: string;
  personaId: string;
  personalityId: string;
  /** FULL enriched row content (bare message + stored attachment block). */
  message: string;
  messageBare: string;
  attachmentText: string;
  attachmentKind: string;
  messageMetadata: unknown;
  createdAt: string;
  style: string;
  priorHistory: ConversationTurn[];
}

/** Transient during pooling — full content for the guard; only a preview persists. */
interface PoolingCandidate {
  corpusId: string;
  createdAtMs: number;
  content: string;
  ranks: Record<string, number>;
}

const ready = DB_URL !== undefined && DB_URL.length > 0 && existsSync(GOLDENS_PATH);

describe.skipIf(!ready)('attachment-allocation pooling (live dev memory store)', () => {
  let prisma: PrismaClient;
  let embeddings: LocalEmbeddingService;
  let adapter: PgvectorMemoryAdapter;
  let goldens: AttachmentGolden[];
  const pools: GoldenPool[] = [];
  const goldensById = new Map<string, AttachmentGolden>();

  beforeAll(async () => {
    goldens = (JSON.parse(readFileSync(GOLDENS_PATH, 'utf8')) as { goldens: AttachmentGolden[] })
      .goldens;
    for (const golden of goldens) {
      goldensById.set(golden.id, golden);
    }

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
      writeFileSync(
        join(WORK_DIR, 'allocation-pool.json'),
        `${JSON.stringify({ pools }, null, 2)}\n`
      );
      writeFileSync(
        join(WORK_DIR, 'allocation-judgment-sheets.md'),
        buildJudgmentSheets(pools, goldensById)
      );
      console.log(
        `\n=== allocation pooling: ${pools.length} goldens → ${WORK_DIR}/allocation-judgment-sheets.md ===`
      );
    }
    await prisma?.$disconnect();
    await embeddings?.shutdown();
  });

  it('pools the allocation arms for every golden', { timeout: 1_800_000 }, async () => {
    for (const golden of goldens) {
      const turns = golden.priorHistory.map(turn => ({ role: turn.role, content: turn.content }));
      // Same guard inputs as the fold runner (see its inline comments): the
      // window is what production's PROMPT already carries, so an in-window or
      // echoed memory can't count as a retrieval win for ANY allocation arm.
      const historyFloorMs = oldestHistoryMs(golden.priorHistory);
      const foldWindowText = extractRecentHistoryWindow(turns, PROD_FOLD_TURNS) ?? '';

      const queries = buildAllocationQueries(golden);

      const pooled = new Map<string, PoolingCandidate>();
      const record = (armName: string, rows: RetrievedRow[]): void => {
        rows.forEach((row, index) => {
          const existing = pooled.get(row.corpusId) ?? {
            corpusId: row.corpusId,
            createdAtMs: row.createdAtMs,
            content: row.content,
            ranks: {} as Record<string, number>,
          };
          existing.ranks[armName] = index + 1;
          pooled.set(row.corpusId, existing);
        });
      };

      for (const armName of ALLOCATION_DENSE_ARMS) {
        const query = queries[armName];
        // An empty query means the arm has nothing to search with (image-only
        // turn under the bare policy) — it contributes no candidates and scores
        // the miss it earned.
        if (query.length > 0) {
          record(armName, await denseArm(adapter, golden.personaId, query));
        }
      }
      record(FTS_ARM, await ftsArm(prisma, golden.personaId, queries['current-dense']));

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
        kind: golden.attachmentKind,
        oldestHistoryMs: historyFloorMs,
        arms: [...ALLOCATION_DENSE_ARMS, FTS_ARM],
        candidates,
      });
    }
    expect(pools).toHaveLength(goldens.length);
  });
});

/** Sheet header quote budget — enough attachment context to judge relevance by. */
const ATTACHMENT_QUOTE_CHARS = 600;

/**
 * Build the judge relevance sheet — one section per golden. Quotes the bare
 * message in full plus the head of the attachment block (a 29k-char description
 * pasted whole would drown the sheet; relevance is judgeable from the lead).
 */
function buildJudgmentSheets(
  pools: GoldenPool[],
  goldensById: Map<string, AttachmentGolden>
): string {
  const lines = [
    '# Attachment-allocation pooled-judgment sheets',
    '',
    'For each golden: mark every candidate `[R]` relevant, `[S]` sort-of, or leave `[ ]`.',
    'You judge ONLY what is listed. Rank badges show where each arm placed the candidate',
    '(`C`=current [prod: bare+full attachment], `B`=bare message only, `L`=bare+lead',
    'sentences, `G`=bare+budgeted attachment, `Cf`=FTS over the current query).',
    '`⊘in-window` / `⊘echo` mark candidates the non-circularity guard disqualifies — the',
    'prompt window already contains them, so they DO NOT count even if you mark them relevant.',
    '',
  ];
  for (const pool of pools) {
    const golden = goldensById.get(pool.goldenId);
    const attachmentHead = (golden?.attachmentText ?? '')
      .slice(0, ATTACHMENT_QUOTE_CHARS)
      .replace(/\n/g, '\n> ');
    lines.push(
      '---',
      '',
      `## ${pool.goldenId.slice(0, 8)} (${pool.kind ?? '?'}, ${pool.style})`,
      '',
      `> ${golden?.messageBare ?? pool.message}`,
      '>',
      `> ${attachmentHead}${(golden?.attachmentText.length ?? 0) > ATTACHMENT_QUOTE_CHARS ? '…' : ''}`,
      ''
    );
    const sorted = [...pool.candidates].sort((a, b) => armSortKey(a) - armSortKey(b));
    for (const candidate of sorted) {
      const badges = [
        rankBadge(candidate, 'current-dense', 'C'),
        rankBadge(candidate, 'bare-dense', 'B'),
        rankBadge(candidate, 'lead-dense', 'L'),
        rankBadge(candidate, 'budget-dense', 'G'),
        rankBadge(candidate, FTS_ARM, 'Cf'),
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
