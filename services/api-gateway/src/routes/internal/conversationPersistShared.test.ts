/**
 * Tests for the shared persist-route read helper.
 */

import { describe, it, expect, vi } from 'vitest';
import { type ConversationHistoryClient } from '@tzurot/conversation-history';
import { type createLogger } from '@tzurot/common-types/utils/logger';
import { fetchExistingConversationRow } from './conversationPersistShared.js';

const asClient = (findUnique: ReturnType<typeof vi.fn>): ConversationHistoryClient =>
  ({ conversationHistory: { findUnique } }) as unknown as ConversationHistoryClient;

const makeLogger = (): { error: ReturnType<typeof vi.fn> } => ({ error: vi.fn() });
const asLogger = (log: { error: ReturnType<typeof vi.fn> }): ReturnType<typeof createLogger> =>
  log as unknown as ReturnType<typeof createLogger>;

describe('fetchExistingConversationRow', () => {
  it('returns the selected row when it exists', async () => {
    const row = { content: 'hi', discordMessageId: ['1'], thinkingContent: null };
    const findUnique = vi.fn().mockResolvedValue(row);

    const result = await fetchExistingConversationRow(
      asClient(findUnique),
      'row-id',
      asLogger(makeLogger()),
      'msg',
      { channelId: 'c' }
    );

    expect(result).toBe(row);
    // `thinkingContent` is selected for drift REPORTING, not for the `matched`
    // verdict — the assistant route warns when a replay carries a different
    // trace than the stored row, which it cannot do without reading it here.
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'row-id' },
      select: { content: true, discordMessageId: true, thinkingContent: true },
    });
  });

  it('returns null when no row exists (no logging)', async () => {
    const log = makeLogger();

    const result = await fetchExistingConversationRow(
      asClient(vi.fn().mockResolvedValue(null)),
      'row-id',
      asLogger(log),
      'msg',
      {}
    );

    expect(result).toBeNull();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('self-labels a fast-pool timeout and rethrows', async () => {
    const log = makeLogger();
    const timeoutError = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });

    await expect(
      fetchExistingConversationRow(
        asClient(vi.fn().mockRejectedValue(timeoutError)),
        'row-id',
        asLogger(log),
        'existence check hit a fast-pool DB timeout',
        { channelId: 'c' }
      )
    ).rejects.toBe(timeoutError);

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'statement-timeout',
        sqlstate: '57014',
        id: 'row-id',
        channelId: 'c',
      }),
      'existence check hit a fast-pool DB timeout'
    );
  });

  it('rethrows non-timeout errors without logging (they carry their own shape)', async () => {
    const log = makeLogger();
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

    await expect(
      fetchExistingConversationRow(
        asClient(vi.fn().mockRejectedValue(p2002)),
        'id',
        asLogger(log),
        'msg',
        {}
      )
    ).rejects.toBe(p2002);

    expect(log.error).not.toHaveBeenCalled();
  });
});
