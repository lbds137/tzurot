/**
 * Forwarded-Origin Writer Tests
 *
 * The SQL shape is the unit under test as much as the return value: the
 * statement's atomicity is what keeps this writer from clobbering
 * `writeTriggerReferences`, and that property is invisible to a test that only
 * checks the boolean.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeForwardedOrigin } from './forwardedOriginWriter.js';
import type { RawCapableConversationHistoryClient } from './forwardedOriginWriter.js';

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
  });

  it('reports success when a row was updated', async () => {
    const executeRaw = vi.fn(() => Promise.resolve(1));

    await expect(mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN)).resolves.toBe(
      true
    );
  });

  it('reports false when no row matched, without throwing', async () => {
    const executeRaw = vi.fn(() => Promise.resolve(0));

    // The persist is best-effort bot-side, so a missing row is an expected
    // outcome rather than an error — callers branch on it, they do not catch.
    await expect(mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN)).resolves.toBe(
      false
    );
  });

  it('swallows a database failure rather than propagating it', async () => {
    const executeRaw = vi.fn(() => Promise.reject(new Error('connection reset')));

    // Attribution is enrichment. A throw here would surface on a path the user
    // can feel, to buy nothing the unattributed quote does not already give.
    await expect(mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN)).resolves.toBe(
      false
    );
  });

  it('merges server-side instead of read-modify-write, and bumps updated_at', async () => {
    const executeRaw = vi.fn(() => Promise.resolve(1));

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    // Asserted because these two properties are the whole reason this writer
    // is raw SQL, and both are invisible in the return value:
    //
    //  - `||` merges in one statement, so this cannot drop the
    //    `referencedMessages` key that writeTriggerReferences owns.
    //  - raw SQL bypasses Prisma's @updatedAt, and conversation_history is
    //    sync-tracked (last-write-wins on updated_at), so an un-bumped column
    //    would let a db-sync silently revert this backfill.
    const sql = (executeRaw.mock.calls[0][0] as unknown as { join?: (s: string) => string }) ?? [];
    const sqlText = Array.isArray(sql) ? sql.join('?') : String(sql);

    expect(sqlText).toContain('||');
    expect(sqlText).toContain('updated_at = NOW()');
    expect(sqlText).not.toMatch(/SELECT/i);
  });

  it('sends the origin nested under forwardedFrom, not at the top level', async () => {
    const executeRaw = vi.fn(() => Promise.resolve(1));

    await mergeForwardedOrigin(createClient(executeRaw), 'row-uuid', ORIGIN);

    // The patch merges into message_metadata, so a top-level origin would
    // scatter authorName/timestamp as sibling metadata keys instead of
    // populating the field the renderer reads.
    const params = executeRaw.mock.calls[0].slice(1);
    const patch = params.find((p): p is string => typeof p === 'string' && p.includes('{'));

    expect(patch).toBeDefined();
    expect(JSON.parse(patch as string)).toEqual({ forwardedFrom: ORIGIN });
  });
});
