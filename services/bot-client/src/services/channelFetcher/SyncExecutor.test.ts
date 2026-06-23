/**
 * Tests for SyncExecutor
 *
 * The diff algorithm itself is tested in common-types (conversationSyncDiff).
 * These tests cover the discord.js adapter: Collection → ObservedSyncMessage
 * mapping and delegation to the gateway sync endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection } from 'discord.js';
import type { Message } from 'discord.js';

vi.mock('../../utils/gatewayWriteHelpers.js', () => ({
  syncConversationViaGateway: vi.fn().mockResolvedValue({ updated: 0, deleted: 0 }),
}));

import { executeDatabaseSync, toObservedSyncMessages } from './SyncExecutor.js';
import { syncConversationViaGateway } from '../../utils/gatewayWriteHelpers.js';

function createMockMessage(id: string, content: string, createdAt: Date): Message {
  return { id, content, createdAt } as unknown as Message;
}

describe('toObservedSyncMessages', () => {
  it('maps id, content, and createdAt from each Discord message', () => {
    const createdAt = new Date('2026-06-01T00:00:00Z');
    const messages = new Collection<string, Message>();
    messages.set('d1', createMockMessage('d1', 'hello', createdAt));
    messages.set('d2', createMockMessage('d2', '', createdAt));

    expect(toObservedSyncMessages(messages)).toEqual([
      { id: 'd1', content: 'hello', createdAt },
      { id: 'd2', content: '', createdAt },
    ]);
  });

  it('returns an empty array for an empty collection', () => {
    expect(toObservedSyncMessages(new Collection<string, Message>())).toEqual([]);
  });
});

describe('executeDatabaseSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes the mapped snapshot through the gateway sync endpoint', async () => {
    vi.mocked(syncConversationViaGateway).mockResolvedValueOnce({ updated: 3, deleted: 1 });
    const createdAt = new Date('2026-06-01T00:00:00Z');
    const messages = new Collection<string, Message>();
    messages.set('d1', createMockMessage('d1', 'hello', createdAt));

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1');

    expect(result).toEqual({ updated: 3, deleted: 1 });
    expect(syncConversationViaGateway).toHaveBeenCalledWith('ch-1', 'p-1', [
      { id: 'd1', content: 'hello', createdAt },
    ]);
  });
});
