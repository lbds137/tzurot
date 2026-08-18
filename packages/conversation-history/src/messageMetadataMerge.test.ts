/**
 * Unit tests for the shared server-side metadata merge.
 *
 * These assert the SQL shape rather than its effect — the effect is pinned
 * against a real database in `ConversationHistoryService.component.test.ts`
 * (§ message_metadata writers interleaving). What belongs here is the part a
 * component test cannot see: that the patch is passed as a bound parameter,
 * that `updated_at` is bumped explicitly, and that a DB error becomes a
 * result rather than a throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeMessageMetadata } from './messageMetadataMerge.js';
import { type RawCapableConversationHistoryClient } from './ConversationMessageMapper.js';

const ROW_ID = 'a3f1c2d4-0000-4000-8000-000000000001';

describe('mergeMessageMetadata', () => {
  let executeRaw: ReturnType<typeof vi.fn>;
  let prisma: RawCapableConversationHistoryClient;

  beforeEach(() => {
    executeRaw = vi.fn().mockResolvedValue(1);
    prisma = { $executeRaw: executeRaw } as unknown as RawCapableConversationHistoryClient;
  });

  it('merges rather than replaces, and bumps updated_at', async () => {
    const result = await mergeMessageMetadata(
      prisma,
      ROW_ID,
      { embedsXml: ['<e/>'] },
      { operation: 'test' }
    );

    expect(result).toBe('updated');
    const sql = (executeRaw.mock.calls[0][0] as string[]).join('');
    // COALESCE, because a row whose metadata is NULL must still accept a
    // patch — `NULL || '{...}'` is NULL, which would silently write nothing.
    expect(sql).toContain("COALESCE(message_metadata, '{}'::jsonb) ||");
    // Raw SQL bypasses Prisma's @updatedAt, and this table is sync-tracked.
    expect(sql).toContain('updated_at = NOW()');
  });

  it('passes the patch as a bound parameter, never as SQL text', async () => {
    // The patch carries user-derived content. A tagged template binds it, so
    // the interpolated values must arrive as arguments beside the strings.
    await mergeMessageMetadata(
      prisma,
      ROW_ID,
      { embedsXml: ["'; DROP TABLE conversation_history; --"] },
      { operation: 'test' }
    );

    const [strings, patch, id] = executeRaw.mock.calls[0] as [string[], string, string];
    expect(strings.join('')).not.toContain('DROP TABLE');
    expect(JSON.parse(patch)).toEqual({
      embedsXml: ["'; DROP TABLE conversation_history; --"],
    });
    expect(id).toBe(ROW_ID);
  });

  it('reports missing when no row matched', async () => {
    executeRaw.mockResolvedValue(0);

    expect(
      await mergeMessageMetadata(prisma, ROW_ID, { embedsXml: [] }, { operation: 'test' })
    ).toBe('missing');
  });

  it('reports failed instead of throwing when the database errors', async () => {
    executeRaw.mockRejectedValue(new Error('connection reset'));

    expect(
      await mergeMessageMetadata(prisma, ROW_ID, { embedsXml: [] }, { operation: 'test' })
    ).toBe('failed');
  });
});
