/**
 * Component test: `queryUpstreamData` over real PGLite.
 *
 * Seeds `llm_diagnostic_logs` with the four row shapes the report must tell
 * apart (success, thrown failure, empty-after-retries, zero-usage success) plus
 * a non-OpenRouter row, runs the real SQL, and asserts the aggregated stats.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
import { queryUpstreamData } from './upstream-report.js';
import type { PrismaQueryable } from './reportRunner.js';

const ANTHROPIC_ROW = '00000000-0000-4000-8000-000000000401';
const SUCCESS_END_TURN = '00000000-0000-4000-8000-000000000402';
const ZERO_USAGE = '00000000-0000-4000-8000-000000000403';
const THROWN_FAILURE = '00000000-0000-4000-8000-000000000404';
const EMPTY_AFTER_RETRIES = '00000000-0000-4000-8000-000000000405';
const OTHER_PROVIDER = '00000000-0000-4000-8000-000000000406';
// Lepton group: one row per finish-reason column, plus an out-of-window row.
const LENGTH_ROW = '00000000-0000-4000-8000-000000000407';
const CONTENT_FILTER_ROW = '00000000-0000-4000-8000-000000000408';
const FINISH_ERROR_ROW = '00000000-0000-4000-8000-000000000409';
const MISSING_FINISH_ROW = '00000000-0000-4000-8000-000000000410';
const UNKNOWN_FINISH_ROW = '00000000-0000-4000-8000-000000000411';
const STOP_SEQUENCE_ROW = '00000000-0000-4000-8000-000000000412';
const OUT_OF_WINDOW_ROW = '00000000-0000-4000-8000-000000000413';

const MODEL = 'anthropic/claude-haiku-5.5';

/** Insert one diagnostic row with the given payload, via the raw PGlite handle. */
async function seed(pglite: PGlite, id: string, provider: string, data: unknown): Promise<void> {
  await pglite.query(
    `INSERT INTO llm_diagnostic_logs (id, request_id, user_id, model, provider, duration_ms, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, `req-${id}`, '111111111111111111', MODEL, provider, 1000, JSON.stringify(data)]
  );
}

describe('queryUpstreamData (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    // Success: a natural stop from Anthropic with real usage.
    await seed(pglite, ANTHROPIC_ROW, 'openrouter', {
      llmResponse: {
        rawContent: 'hello there',
        finishReason: 'stop',
        completionTokens: 100,
        reasoningDebug: { upstreamProvider: 'Anthropic' },
      },
    });
    // Success: Anthropic's end_turn spelling, which must also count as stop.
    await seed(pglite, SUCCESS_END_TURN, 'openrouter', {
      llmResponse: {
        rawContent: 'done',
        finishReason: 'end_turn',
        completionTokens: 50,
        reasoningDebug: { upstreamProvider: 'Anthropic' },
      },
    });
    // Success with no usage recorded: stored as 0, so it must not drag the average down.
    await seed(pglite, ZERO_USAGE, 'openrouter', {
      llmResponse: {
        rawContent: 'ok',
        finishReason: 'stop',
        completionTokens: 0,
        reasoningDebug: { upstreamProvider: 'Anthropic' },
      },
    });
    // Thrown failure: no host recorded, placeholder reply, error set. Counts as failed, not empty.
    await seed(pglite, THROWN_FAILURE, 'openrouter', {
      error: { message: 'boom' },
      llmResponse: { rawContent: '[error — see error data]' },
    });
    // Empty-after-retries: a recorded host, blank reply, error set. Counts as failed AND empty.
    await seed(pglite, EMPTY_AFTER_RETRIES, 'openrouter', {
      error: { message: 'EMPTY_RESPONSE' },
      llmResponse: {
        rawContent: '   ',
        finishReason: 'stop',
        completionTokens: 0,
        reasoningDebug: { upstreamProvider: 'Parasail' },
      },
    });
    // Lepton group. Each row has a non-blank reply and no error, so only the
    // finish-reason classification differs between them.
    const leptonLlm = (finishReason?: string): unknown => ({
      llmResponse: {
        rawContent: 'reply',
        ...(finishReason === undefined ? {} : { finishReason }),
        completionTokens: 10,
        reasoningDebug: { upstreamProvider: 'Lepton' },
      },
    });
    await seed(pglite, LENGTH_ROW, 'openrouter', leptonLlm('length'));
    await seed(pglite, CONTENT_FILTER_ROW, 'openrouter', leptonLlm('content_filter'));
    await seed(pglite, FINISH_ERROR_ROW, 'openrouter', leptonLlm('error'));
    await seed(pglite, MISSING_FINISH_ROW, 'openrouter', leptonLlm());
    await seed(pglite, UNKNOWN_FINISH_ROW, 'openrouter', leptonLlm('unknown'));
    // stop_sequence is not in NATURAL_STOP_REASONS, but this report counts it as stop.
    await seed(pglite, STOP_SEQUENCE_ROW, 'openrouter', leptonLlm('stop_sequence'));
    // Outside the 7-day window: must be excluded from every column, including Requests.
    await seed(pglite, OUT_OF_WINDOW_ROW, 'openrouter', leptonLlm('stop'));
    await pglite.query(
      `UPDATE llm_diagnostic_logs SET created_at = now() - interval '30 days' WHERE id = $1`,
      [OUT_OF_WINDOW_ROW]
    );

    // Not OpenRouter: must be excluded by the provider filter.
    await seed(pglite, OTHER_PROVIDER, 'anthropic', {
      llmResponse: {
        rawContent: 'direct',
        finishReason: 'stop',
        completionTokens: 999,
        reasoningDebug: { upstreamProvider: 'Anthropic' },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('groups rows by model and upstream host, excluding non-OpenRouter rows', async () => {
    const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);

    const hosts = data.rows.map(r => r.upstream).sort();
    expect(hosts).toEqual(['(none)', 'Anthropic', 'Lepton', 'Parasail']);
  });

  it('counts a successful Anthropic group: stop includes end_turn, and the average skips zero usage', async () => {
    const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);
    const anthropic = data.rows.find(r => r.upstream === 'Anthropic');

    expect(anthropic).toBeDefined();
    expect(anthropic?.requests).toBe(3);
    expect(anthropic?.failed).toBe(0);
    expect(anthropic?.finishStop).toBe(3);
    expect(anthropic?.emptyReplies).toBe(0);
    // (100 + 50) / 2: the zero-usage row is excluded, and the non-OpenRouter 999 is never read.
    expect(anthropic?.avgCompletionTokens).toBe(75);
  });

  it('counts an empty-after-retries failure as failed and empty, and keeps it out of finish and average', async () => {
    const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);
    const parasail = data.rows.find(r => r.upstream === 'Parasail');

    expect(parasail).toBeDefined();
    expect(parasail?.requests).toBe(1);
    expect(parasail?.failed).toBe(1);
    expect(parasail?.emptyReplies).toBe(1);
    expect(parasail?.finishStop).toBe(0);
    expect(parasail?.avgCompletionTokens).toBeNull();
  });

  it('counts a thrown failure under (none) as failed, and not as empty (its placeholder is not blank)', async () => {
    const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);
    const none = data.rows.find(r => r.upstream === '(none)');

    expect(none).toBeDefined();
    expect(none?.requests).toBe(1);
    expect(none?.failed).toBe(1);
    expect(none?.emptyReplies).toBe(0);
    expect(none?.avgCompletionTokens).toBeNull();
  });

  describe('Lepton group (finish-reason columns)', () => {
    it('excludes a row older than the window from Requests and every column', async () => {
      const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);
      const lepton = data.rows.find(r => r.upstream === 'Lepton');

      // 7 seeded rows, one outside the window: 6 remain.
      expect(lepton?.requests).toBe(6);
      expect(lepton?.finishStop).toBe(1);
      expect(lepton?.finishOther).toBe(2);
    });

    it('puts a length row in length, a content_filter row in content_filter, and a finishReason error row in error', async () => {
      const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);
      const lepton = data.rows.find(r => r.upstream === 'Lepton');

      expect(lepton?.finishLength).toBe(1);
      expect(lepton?.finishContentFilter).toBe(1);
      expect(lepton?.finishError).toBe(1);
    });

    it('puts a missing finishReason and an unknown one in other, and stop_sequence in stop', async () => {
      const data = await queryUpstreamData(prisma as unknown as PrismaQueryable, 'local', 7);
      const lepton = data.rows.find(r => r.upstream === 'Lepton');

      expect(lepton?.finishOther).toBe(2);
      expect(lepton?.finishStop).toBe(1);
      expect(lepton?.failed).toBe(0);
    });
  });

  describe('completionTokens stored as a JSON string', () => {
    // Its own fixture: a row added to the shared fixture above would move its
    // expectations. The Cerebras host exists only in this block.
    let stringPglite: PGlite;
    let stringPrisma: PrismaClient;

    beforeAll(async () => {
      stringPglite = createTestPGlite();
      await stringPglite.exec(loadPGliteSchema());
      stringPrisma = new PrismaClient({ adapter: new PrismaPGlite(stringPglite) }) as PrismaClient;

      await seed(stringPglite, '00000000-0000-4000-8000-000000000501', 'openrouter', {
        llmResponse: {
          rawContent: 'numeric',
          finishReason: 'stop',
          completionTokens: 10,
          reasoningDebug: { upstreamProvider: 'Cerebras' },
        },
      });
      await seed(stringPglite, '00000000-0000-4000-8000-000000000502', 'openrouter', {
        llmResponse: {
          rawContent: 'string',
          finishReason: 'stop',
          completionTokens: '12',
          reasoningDebug: { upstreamProvider: 'Cerebras' },
        },
      });
    });

    afterAll(async () => {
      await stringPrisma.$disconnect();
      await stringPglite.close();
    });

    it('excludes the string "12" from the average without a cast error', async () => {
      const data = await queryUpstreamData(stringPrisma as unknown as PrismaQueryable, 'local', 7);
      const cerebras = data.rows.find(r => r.upstream === 'Cerebras');

      expect(cerebras?.requests).toBe(2);
      expect(cerebras?.finishStop).toBe(2);
      // Only the numeric 10 counts; the string "12" would pull the mean to 11.
      expect(cerebras?.avgCompletionTokens).toBe(10);
    });
  });
});
