/**
 * Tests for SyncExecutor
 *
 * Tests executeDatabaseSync: edit detection, soft deletes, error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Collection } from 'discord.js';
import type { Message } from 'discord.js';
import type { ConversationSyncService } from '@tzurot/common-types';

// Mock SyncValidator
vi.mock('./SyncValidator.js', () => ({
  collateChunksForSync: vi.fn(),
  contentsDiffer: vi.fn(),
  getOldestTimestamp: vi.fn(),
}));

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

import { executeDatabaseSync } from './SyncExecutor.js';
import { collateChunksForSync, contentsDiffer, getOldestTimestamp } from './SyncValidator.js';

function createMockMessage(id: string, content: string): Message {
  return {
    id,
    content,
    createdAt: new Date('2024-01-01'),
  } as unknown as Message;
}

function createMockConversationSync(
  overrides?: Partial<ConversationSyncService>
): ConversationSyncService {
  return {
    getMessagesByDiscordIds: vi.fn().mockResolvedValue(new Map()),
    updateMessageContent: vi.fn().mockResolvedValue(true),
    getMessagesInTimeWindow: vi.fn().mockResolvedValue([]),
    softDeleteMessages: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as ConversationSyncService;
}

describe('executeDatabaseSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return zero counts for empty message collection', async () => {
    const messages = new Collection<string, Message>();
    const sync = createMockConversationSync();

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result).toEqual({ updated: 0, deleted: 0 });
    expect(sync.getMessagesByDiscordIds).not.toHaveBeenCalled();
  });

  it('should return zero counts when no DB messages match', async () => {
    const messages = new Collection<string, Message>();
    messages.set('msg-1', createMockMessage('msg-1', 'Hello'));

    const sync = createMockConversationSync({
      getMessagesByDiscordIds: vi.fn().mockResolvedValue(new Map()),
    });

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result).toEqual({ updated: 0, deleted: 0 });
  });

  it('should detect and update edited messages', async () => {
    const messages = new Collection<string, Message>();
    messages.set('msg-1', createMockMessage('msg-1', 'Updated content'));

    const dbMessages = new Map([
      [
        'msg-1',
        {
          id: 'db-1',
          discordMessageId: ['msg-1'],
          content: 'Original content',
          deletedAt: null,
        },
      ],
    ]);

    const sync = createMockConversationSync({
      getMessagesByDiscordIds: vi.fn().mockResolvedValue(dbMessages),
      updateMessageContent: vi.fn().mockResolvedValue(true),
    });

    vi.mocked(collateChunksForSync).mockReturnValue('Updated content');
    vi.mocked(contentsDiffer).mockReturnValue(true);
    vi.mocked(getOldestTimestamp).mockReturnValue(null);

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result.updated).toBe(1);
    expect(sync.updateMessageContent).toHaveBeenCalledWith('db-1', 'Updated content');
  });

  it('should not update when content has not changed', async () => {
    const messages = new Collection<string, Message>();
    messages.set('msg-1', createMockMessage('msg-1', 'Same content'));

    const dbMessages = new Map([
      [
        'msg-1',
        {
          id: 'db-1',
          discordMessageId: ['msg-1'],
          content: 'Same content',
          deletedAt: null,
        },
      ],
    ]);

    const sync = createMockConversationSync({
      getMessagesByDiscordIds: vi.fn().mockResolvedValue(dbMessages),
    });

    vi.mocked(collateChunksForSync).mockReturnValue('Same content');
    vi.mocked(contentsDiffer).mockReturnValue(false);
    vi.mocked(getOldestTimestamp).mockReturnValue(null);

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result.updated).toBe(0);
    expect(sync.updateMessageContent).not.toHaveBeenCalled();
  });

  it('should soft delete messages not found in Discord', async () => {
    const messages = new Collection<string, Message>();
    messages.set('msg-1', createMockMessage('msg-1', 'Still here'));

    const dbMessages = new Map([
      [
        'msg-1',
        {
          id: 'db-1',
          discordMessageId: ['msg-1'],
          content: 'Still here',
          deletedAt: null,
        },
      ],
    ]);

    const sync = createMockConversationSync({
      getMessagesByDiscordIds: vi.fn().mockResolvedValue(dbMessages),
      getMessagesInTimeWindow: vi.fn().mockResolvedValue([
        { id: 'db-1', discordMessageId: ['msg-1'] },
        { id: 'db-2', discordMessageId: ['msg-deleted'] }, // Not in Discord
      ]),
      softDeleteMessages: vi.fn().mockResolvedValue(1),
    });

    vi.mocked(collateChunksForSync).mockReturnValue('Still here');
    vi.mocked(contentsDiffer).mockReturnValue(false);
    vi.mocked(getOldestTimestamp).mockReturnValue(new Date('2024-01-01'));

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result.deleted).toBe(1);
    expect(sync.softDeleteMessages).toHaveBeenCalledWith(['db-2']);
  });

  it('should handle errors gracefully and return zero counts', async () => {
    const messages = new Collection<string, Message>();
    messages.set('msg-1', createMockMessage('msg-1', 'Hello'));

    const sync = createMockConversationSync({
      getMessagesByDiscordIds: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result).toEqual({ updated: 0, deleted: 0 });
  });

  it('should skip collation null results', async () => {
    const messages = new Collection<string, Message>();
    messages.set('msg-1', createMockMessage('msg-1', 'Partial'));

    const dbMessages = new Map([
      [
        'msg-1',
        {
          id: 'db-1',
          discordMessageId: ['msg-1', 'msg-2'], // Expects 2 chunks
          content: 'Full content',
          deletedAt: null,
        },
      ],
    ]);

    const sync = createMockConversationSync({
      getMessagesByDiscordIds: vi.fn().mockResolvedValue(dbMessages),
    });

    vi.mocked(collateChunksForSync).mockReturnValue(null);
    vi.mocked(getOldestTimestamp).mockReturnValue(null);

    const result = await executeDatabaseSync(messages, 'ch-1', 'p-1', sync);

    expect(result.updated).toBe(0);
    expect(sync.updateMessageContent).not.toHaveBeenCalled();
  });
});
