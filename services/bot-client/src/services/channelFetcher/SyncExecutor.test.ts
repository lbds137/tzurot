/**
 * Tests for SyncExecutor
 *
 * The diff algorithm itself is tested in common-types
 * (ConversationSyncService.runSync + conversationSyncDiff). These tests
 * cover the discord.js adapter: Collection → ObservedSyncMessage mapping
 * and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection } from 'discord.js';
import type { Message } from 'discord.js';
import type { ConversationSyncService } from '@tzurot/common-types';

vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  dualWriteConversationSync: vi.fn().mockResolvedValue(undefined),
}));

import { executeDatabaseSync, toObservedSyncMessages } from './SyncExecutor.js';
import { dualWriteConversationSync } from '../../utils/gatewayServiceCalls.js';

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

  it('delegates to ConversationSyncService.runSync with the mapped snapshot', async () => {
    const createdAt = new Date('2026-06-01T00:00:00Z');
    const messages = new Collection<string, Message>();
    messages.set('d1', createMockMessage('d1', 'hello', createdAt));

    const runSync = vi.fn().mockResolvedValue({ updated: 1, deleted: 2 });
    const sync = { runSync } as unknown as ConversationSyncService;

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result).toEqual({ updated: 1, deleted: 2 });
    expect(runSync).toHaveBeenCalledWith('ch-1', 'p-1', [
      { id: 'd1', content: 'hello', createdAt },
    ]);
  });

  it('replays the same snapshot to the dual-write helper after the local sync', async () => {
    const createdAt = new Date('2026-06-01T00:00:00Z');
    const messages = new Collection<string, Message>();
    messages.set('d1', createMockMessage('d1', 'hello', createdAt));

    const runSync = vi.fn().mockResolvedValue({ updated: 0, deleted: 0 });
    const sync = { runSync } as unknown as ConversationSyncService;

    await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(dualWriteConversationSync).toHaveBeenCalledWith('ch-1', 'p-1', [
      { id: 'd1', content: 'hello', createdAt },
    ]);
  });
});
