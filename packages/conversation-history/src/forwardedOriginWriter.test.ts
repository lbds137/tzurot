/**
 * Forwarded-Origin Writer Tests
 *
 * The SQL shape is the unit under test as much as the return value: the
 * statement's atomicity is what keeps this writer from clobbering
 * `writeTriggerReferences`, and that property is invisible to a test that only
 * checks the boolean.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the miss/failure log lines below can be asserted on — both
// branches otherwise resolve to a distinct return value, but the log CALL
// itself (or its absence) is a separate property from that return value.
const { mockLoggerDebug, mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: mockLoggerDebug,
      info: vi.fn(),
      warn: mockLoggerWarn,
      error: vi.fn(),
    }),
  };
});

import { mergeForwardedOrigin } from './forwardedOriginWriter.js';
import type { RawCapableConversationHistoryClient } from './ConversationMessageMapper.js';

/**
 * `vi.fn(() => ...)` types its calls as a zero-length tuple, so `calls[0][0]`
 * will not compile. The explicit rest parameter is what makes the recorded
 * arguments readable — and reading them is the point of two tests below.
 */
function rawMock(outcome: number | Error): ReturnType<typeof vi.fn> {
  return vi.fn((..._args: unknown[]) =>
    outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
  );
}

function createClient(executeRaw: ReturnType<typeof vi.fn>): RawCapableConversationHistoryClient {
  return { $executeRaw: executeRaw } as unknown as RawCapableConversationHistoryClient;
}

const ORIGIN = {
  authorName: 'COLD',
  authorId: '1472768398135001108',
  timestamp: '2026-08-18T11:13:53.053Z',
  authorPersonalityId: '3f1d5b2a-0000-4000-8000-000000000001',
};

describe('mergeForwardedOrigin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Plain vi.fn() mocks (not vi.spyOn) are not reset by restoreAllMocks —
    // clear their call history explicitly so a prior test's log calls don't
    // leak into this one's assertions.
    mockLoggerDebug.mockClear();
    mockLoggerWarn.mockClear();
  });

  it('reports success when a row was updated', async () => {
    const executeRaw = rawMock(1);

    await expect(mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN)).resolves.toBe(
      'updated'
    );
  });

  it('reports a miss when no row matched, without throwing', async () => {
    const executeRaw = rawMock(0);

    // The persist is best-effort bot-side, so a missing row is an expected
    // outcome rather than an error — callers branch on it, they do not catch.
    await expect(mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN)).resolves.toBe(
      'missing'
    );
  });

  it('swallows a database failure rather than propagating it', async () => {
    const executeRaw = rawMock(new Error('connection reset'));

    // Attribution is enrichment. A throw here would surface on a path the user
    // can feel, to buy nothing the unattributed quote does not already give.
    await expect(mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN)).resolves.toBe(
      'failed'
    );
  });

  it('distinguishes a database failure from an ordinary miss', async () => {
    // Both leave the quote unattributed, so a boolean return would let the
    // caller log a DB error as "no row matched" — a claim about the database
    // that nothing observed. The two outcomes are asserted as distinct here
    // because that is the only property the separate values buy.
    const missing = await mergeForwardedOrigin(createClient(rawMock(0)), 'row-uuid', ORIGIN);
    const failed = await mergeForwardedOrigin(
      createClient(rawMock(new Error('connection reset'))),
      'row-uuid',
      ORIGIN
    );

    expect(missing).not.toBe(failed);
  });

  it('merges server-side instead of read-modify-write, and bumps updated_at', async () => {
    const executeRaw = rawMock(1);

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    // Asserted because these two properties are the whole reason this writer
    // is raw SQL, and both are invisible in the return value:
    //
    //  - `||` merges in one statement, so this cannot drop the
    //    `referencedMessages` key that writeTriggerReferences owns.
    //  - raw SQL bypasses Prisma's @updatedAt, and conversation_history is
    //    sync-tracked (last-write-wins on updated_at), so an un-bumped column
    //    would let a db-sync silently revert this backfill.
    const [sql] = executeRaw.mock.calls[0] as unknown[];
    const sqlText = Array.isArray(sql) ? sql.join('?') : String(sql);

    expect(sqlText).toContain('||');
    expect(sqlText).toContain('updated_at = NOW()');
    expect(sqlText).not.toMatch(/SELECT/i);
  });

  it('sends the origin nested under forwardedFrom, not at the top level', async () => {
    const executeRaw = rawMock(1);

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    // The patch merges into message_metadata, so a top-level origin would
    // scatter authorName/timestamp as sibling metadata keys instead of
    // populating the field the renderer reads.
    const params = (executeRaw.mock.calls[0] as unknown[]).slice(1);
    const patch = params.find(
      (value): value is string => typeof value === 'string' && value.includes('{')
    );

    expect(patch).toBeDefined();
    expect(JSON.parse(patch ?? '{}')).toEqual({ forwardedFrom: ORIGIN });
  });

  it('logs the miss when no row matched', async () => {
    const executeRaw = rawMock(0);

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    expect(mockLoggerDebug).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'row-uuid' }),
      'No row matched the forwarded-origin backfill'
    );
  });

  it('does not log a miss when the row was updated', async () => {
    const executeRaw = rawMock(1);

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    expect(mockLoggerDebug).not.toHaveBeenCalled();
  });

  it('tags its merge failures with its own operation name', async () => {
    // The operation tag is the only thing distinguishing this writer's
    // failures from the other writer of the same message_metadata column.
    const executeRaw = rawMock(new Error('connection reset'));

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'forwarded-origin-backfill' }),
      'Metadata merge failed'
    );
  });
});
