/**
 * Tests for ConversationSyncService - Opportunistic Sync with Discord
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationSyncService } from './ConversationSyncService.js';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';

// countTextTokens now lives in @tzurot/common-types (consumed by the production
// service via the barrel), so intercept it through a partial mock rather than a
// namespace spy — the latter doesn't reliably catch a re-exported binding.
const { mockCountTextTokens } = vi.hoisted(() => ({ mockCountTextTokens: vi.fn() }));
vi.mock('@tzurot/common-types/utils/tokenCounter', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/tokenCounter')>();
  return {
    ...actual,
    countTextTokens: mockCountTextTokens,
  };
});
// Create mock Prisma client
const createMockPrismaClient = () => {
  const client = {
    conversationHistory: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    conversationHistoryTombstone: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    memory: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    // $transaction executes the callback with the mock client as the transaction
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback(client);
    }),
  };
  return client;
};

describe('ConversationSyncService', () => {
  let service: ConversationSyncService;
  let mockPrismaClient: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    // Clear mock call history / return values between tests (matches the
    // ConversationHistoryService test; mockCountTextTokens is hoisted module-wide)
    vi.clearAllMocks();
    // Create fresh mocks for each test
    mockPrismaClient = createMockPrismaClient();
    service = new ConversationSyncService(mockPrismaClient as unknown as PrismaClient);
  });

  describe('softDeleteMessage', () => {
    it('should soft delete a message by setting deletedAt', async () => {
      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        discordMessageId: ['discord-123'],
      });

      const result = await service.softDeleteMessage('msg-123');

      expect(result).toBe(true);
      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith({
        where: { id: 'msg-123' },
        data: { deletedAt: expect.any(Date) },
        select: { discordMessageId: true },
      });
      // Deletion propagates to linked memories via the Discord id
      expect(mockPrismaClient.memory.updateMany).toHaveBeenCalledWith({
        where: { messageIds: { hasSome: ['discord-123'] }, visibility: 'normal', isLocked: false },
        data: { visibility: 'deleted' },
      });
    });

    it('should return false when soft delete fails', async () => {
      mockPrismaClient.conversationHistory.update.mockRejectedValue(new Error('Database error'));

      const result = await service.softDeleteMessage('msg-123');

      expect(result).toBe(false);
    });
  });

  describe('softDeleteMessages', () => {
    it('should return 0 when no message IDs provided', async () => {
      const result = await service.softDeleteMessages([]);

      expect(result).toBe(0);
      expect(mockPrismaClient.conversationHistory.findMany).not.toHaveBeenCalled();
    });

    it('should soft delete messages and create tombstones in transaction', async () => {
      const messageIds = ['msg-1', 'msg-2', 'msg-3'];
      const mockMessages = messageIds.map(id => ({
        id,
        channelId: 'channel-123',
        personalityId: 'personality-456',
        personaId: 'persona-789',
        discordMessageId: [`discord-${id}`],
      }));

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);
      mockPrismaClient.conversationHistory.updateMany.mockResolvedValue({ count: 3 });
      mockPrismaClient.conversationHistoryTombstone.createMany.mockResolvedValue({ count: 3 });

      // Mock transaction to execute the operations
      mockPrismaClient.$transaction.mockImplementation(async operations => {
        if (Array.isArray(operations)) {
          // Execute each operation
          return Promise.all(operations);
        }
        return operations(mockPrismaClient);
      });

      const result = await service.softDeleteMessages(messageIds);

      expect(result).toBe(3);
      // Bulk propagation seam: the flattened Discord ids reach memory.updateMany
      expect(mockPrismaClient.memory.updateMany).toHaveBeenCalledWith({
        where: {
          messageIds: { hasSome: ['discord-msg-1', 'discord-msg-2', 'discord-msg-3'] },
          visibility: 'normal',
          isLocked: false,
        },
        data: { visibility: 'deleted' },
      });
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          channelId: true,
          personalityId: true,
          personaId: true,
          discordMessageId: true,
        },
        take: 3, // Math.min(messageIds.length, SYNC_LIMITS.MAX_MESSAGE_BATCH)
      });
    });

    it('should return 0 when bulk soft delete fails', async () => {
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(new Error('Database error'));

      const result = await service.softDeleteMessages(['msg-1', 'msg-2']);

      expect(result).toBe(0);
    });
  });

  describe('updateMessageContent', () => {
    it('should update message content and recompute token count', async () => {
      const newContent = 'Updated content from Discord';
      const expectedTokens = 5;

      mockCountTextTokens.mockReturnValue(expectedTokens);
      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        id: 'msg-123',
        content: newContent,
        tokenCount: expectedTokens,
      });

      const result = await service.updateMessageContent('msg-123', newContent);

      expect(result).toBe(true);
      expect(mockCountTextTokens).toHaveBeenCalledWith(newContent);
      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith({
        where: { id: 'msg-123' },
        data: {
          content: newContent,
          tokenCount: expectedTokens,
          editedAt: expect.any(Date),
        },
      });
    });

    it('should return false when update fails', async () => {
      mockPrismaClient.conversationHistory.update.mockRejectedValue(new Error('Database error'));

      const result = await service.updateMessageContent('msg-123', 'new content');

      expect(result).toBe(false);
    });
  });

  describe('getMessagesByDiscordIds', () => {
    it('should return empty map when no IDs provided', async () => {
      const result = await service.getMessagesByDiscordIds([]);

      expect(result.size).toBe(0);
      expect(mockPrismaClient.conversationHistory.findMany).not.toHaveBeenCalled();
    });

    it('should return map of Discord ID to message data', async () => {
      const discordIds = ['discord-1', 'discord-2'];
      const mockMessages = [
        {
          id: 'msg-1',
          content: 'Message 1',
          discordMessageId: ['discord-1'],
          deletedAt: null,
          createdAt: new Date('2025-01-01'),
        },
        {
          id: 'msg-2',
          content: 'Message 2',
          discordMessageId: ['discord-2'],
          deletedAt: null,
          createdAt: new Date('2025-01-02'),
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getMessagesByDiscordIds(discordIds, 'channel-123');

      expect(result.size).toBe(2);
      expect(result.get('discord-1')?.id).toBe('msg-1');
      expect(result.get('discord-2')?.id).toBe('msg-2');
    });

    it('should handle chunked messages with multiple Discord IDs', async () => {
      const discordIds = ['discord-chunk-1', 'discord-chunk-2'];
      const mockMessages = [
        {
          id: 'msg-chunked',
          content: 'Chunked message',
          discordMessageId: ['discord-chunk-1', 'discord-chunk-2', 'discord-chunk-3'],
          deletedAt: null,
          createdAt: new Date('2025-01-01'),
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getMessagesByDiscordIds(discordIds);

      expect(result.size).toBe(2);
      // Both Discord IDs should map to the same message
      expect(result.get('discord-chunk-1')?.id).toBe('msg-chunked');
      expect(result.get('discord-chunk-2')?.id).toBe('msg-chunked');
    });

    it('should filter by channelId and personalityId when provided', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getMessagesByDiscordIds(['discord-1'], 'channel-123', 'personality-456');

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: {
          discordMessageId: { hasSome: ['discord-1'] },
          channelId: 'channel-123',
          personalityId: 'personality-456',
        },
        select: {
          id: true,
          content: true,
          discordMessageId: true,
          deletedAt: true,
          createdAt: true,
        },
        // Bounded query: Math.min(1 * 2, 500) = 2
        take: 2,
      });
    });

    it('should return empty map on error', async () => {
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(new Error('Database error'));

      const result = await service.getMessagesByDiscordIds(['discord-1']);

      expect(result.size).toBe(0);
    });
  });

  describe('getMessagesInTimeWindow', () => {
    it('should return messages in time window with Discord IDs', async () => {
      const since = new Date('2025-01-01');
      const mockMessages = [
        {
          id: 'msg-1',
          discordMessageId: ['discord-1'],
          createdAt: new Date('2025-01-02'),
        },
        {
          id: 'msg-2',
          discordMessageId: ['discord-2'],
          createdAt: new Date('2025-01-03'),
        },
      ];

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);

      const result = await service.getMessagesInTimeWindow('channel-123', 'personality-456', since);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-1');
      expect(result[1].id).toBe('msg-2');

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: {
          channelId: 'channel-123',
          personalityId: 'personality-456',
          deletedAt: null,
          createdAt: { gte: since },
          discordMessageId: { isEmpty: false },
        },
        select: {
          id: true,
          discordMessageId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
    });

    it('should respect custom limit parameter', async () => {
      const since = new Date('2025-01-01T00:00:00Z');
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.getMessagesInTimeWindow('channel-123', 'personality-456', since, 50);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        })
      );
    });

    it('should return empty array on error', async () => {
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(new Error('Database error'));

      const result = await service.getMessagesInTimeWindow(
        'channel-123',
        'personality-456',
        new Date()
      );

      expect(result).toEqual([]);
    });
  });

  describe('runSync', () => {
    const observed = (id: string, content: string, iso = '2026-06-01T00:00:00Z') => ({
      id,
      content,
      createdAt: new Date(iso),
    });

    const dbRow = (id: string, discordIds: string[], content: string) => ({
      id,
      discordMessageId: discordIds,
      content,
      deletedAt: null,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });

    it('returns zero counts for an empty snapshot without touching the DB', async () => {
      const spy = vi.spyOn(service, 'getMessagesByDiscordIds');

      const result = await service.runSync('ch-1', 'p-1', []);

      expect(result).toEqual({ updated: 0, deleted: 0 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns zero counts when no DB messages match', async () => {
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map());
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'hello')]);

      expect(result).toEqual({ updated: 0, deleted: 0 });
    });

    it('detects and updates an edited message', async () => {
      const row = dbRow('db-1', ['d1'], 'original content');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([
        { id: 'db-1', discordMessageId: ['d1'], createdAt: row.createdAt },
      ]);
      const update = vi.spyOn(service, 'updateMessageContent').mockResolvedValue(true);
      const softDelete = vi.spyOn(service, 'softDeleteMessages');

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'edited content')]);

      expect(result).toEqual({ updated: 1, deleted: 0 });
      expect(update).toHaveBeenCalledWith('db-1', 'edited content');
      expect(softDelete).not.toHaveBeenCalled();
    });

    it('does not update when content is unchanged', async () => {
      const row = dbRow('db-1', ['d1'], 'same content');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([
        { id: 'db-1', discordMessageId: ['d1'], createdAt: row.createdAt },
      ]);
      const update = vi.spyOn(service, 'updateMessageContent');

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'same content')]);

      expect(result).toEqual({ updated: 0, deleted: 0 });
      expect(update).not.toHaveBeenCalled();
    });

    it('collates multi-chunk records in DB order before comparing', async () => {
      const row = dbRow('db-1', ['d1', 'd2'], 'part one part two');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(
        new Map([
          ['d1', row],
          ['d2', row],
        ])
      );
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([
        { id: 'db-1', discordMessageId: ['d1', 'd2'], createdAt: row.createdAt },
      ]);
      const update = vi.spyOn(service, 'updateMessageContent');

      // Chunks arrive out of order but collate to the stored content — no edit.
      const result = await service.runSync('ch-1', 'p-1', [
        observed('d2', ' part two'),
        observed('d1', 'part one'),
      ]);

      expect(result.updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('skips edit when chunks are missing from the snapshot (partial fetch)', async () => {
      const row = dbRow('db-1', ['d1', 'd2'], 'part one part two');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);
      const update = vi.spyOn(service, 'updateMessageContent');

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'part one EDITED')]);

      expect(result.updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('soft deletes DB rows absent from the snapshot window', async () => {
      const row = dbRow('db-1', ['d1'], 'still here');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([
        { id: 'db-1', discordMessageId: ['d1'], createdAt: row.createdAt },
        { id: 'db-2', discordMessageId: ['d-deleted'], createdAt: row.createdAt },
      ]);
      const softDelete = vi.spyOn(service, 'softDeleteMessages').mockResolvedValue(1);

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'still here')]);

      expect(result).toEqual({ updated: 0, deleted: 1 });
      expect(softDelete).toHaveBeenCalledWith(['db-2']);
    });

    it('ignores soft-deleted DB rows in the edit pass', async () => {
      const row = { ...dbRow('db-1', ['d1'], 'original'), deletedAt: new Date() };
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);
      const update = vi.spyOn(service, 'updateMessageContent');

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'edited')]);

      expect(result.updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('returns zero counts when the first DB call throws (never propagates)', async () => {
      vi.spyOn(service, 'getMessagesByDiscordIds').mockRejectedValue(new Error('DB down'));

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', 'hello')]);

      expect(result).toEqual({ updated: 0, deleted: 0 });
    });

    it('strips bot footers from collated chunks before comparing (no false edit)', async () => {
      const row = dbRow(
        'db-1',
        ['d1', 'd2'],
        'This is the first chunk of a long response. This is the second chunk.'
      );
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(
        new Map([
          ['d1', row],
          ['d2', row],
        ])
      );
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);
      const update = vi.spyOn(service, 'updateMessageContent');

      const result = await service.runSync('ch-1', 'p-1', [
        observed('d1', 'This is the first chunk of a long response. '),
        observed('d2', 'This is the second chunk.\n-# Model: [test-model](<https://example.com>)'),
      ]);

      expect(result.updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('updates with footer-stripped content when an edited chunk genuinely differs', async () => {
      const row = dbRow('db-1', ['d1', 'd2'], 'First chunk original. Second chunk unchanged.');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(
        new Map([
          ['d1', row],
          ['d2', row],
        ])
      );
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);
      const update = vi.spyOn(service, 'updateMessageContent').mockResolvedValue(true);

      const result = await service.runSync('ch-1', 'p-1', [
        observed('d1', 'First chunk was EDITED. '),
        observed('d2', 'Second chunk unchanged.\n-# Model: [test-model](<https://example.com>)'),
      ]);

      expect(result.updated).toBe(1);
      expect(update).toHaveBeenCalledWith(
        'db-1',
        'First chunk was EDITED. Second chunk unchanged.'
      );
    });

    it('strips multi-line footers (model + guest mode) before comparing', async () => {
      const row = dbRow('db-1', ['d1'], 'Hello world!');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);
      const update = vi.spyOn(service, 'updateMessageContent');

      const result = await service.runSync('ch-1', 'p-1', [
        observed(
          'd1',
          'Hello world!\n-# Model: [meta-llama/llama-3.3-70b-instruct:free](<https://openrouter.ai/meta-llama/llama-3.3-70b-instruct:free>)\n-# 🆓 Using free model (no API key required)'
        ),
      ]);

      expect(result.updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });

    it('does not overwrite non-empty DB content with empty Discord content (voice transcripts)', async () => {
      const row = dbRow('db-1', ['d1'], 'Voice transcript: Hello this is a test message');
      vi.spyOn(service, 'getMessagesByDiscordIds').mockResolvedValue(new Map([['d1', row]]));
      vi.spyOn(service, 'getMessagesInTimeWindow').mockResolvedValue([]);
      const update = vi.spyOn(service, 'updateMessageContent');

      const result = await service.runSync('ch-1', 'p-1', [observed('d1', '')]);

      expect(result.updated).toBe(0);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
