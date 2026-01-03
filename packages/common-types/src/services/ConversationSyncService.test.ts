/**
 * Tests for ConversationSyncService - Opportunistic Sync with Discord
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from './prisma.js';
import { ConversationSyncService } from './ConversationSyncService.js';
import * as tokenCounter from '../utils/tokenCounter.js';

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
    // $transaction executes the callback with the mock client as the transaction
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      return callback(client);
    }),
  };
  return client;
};

const mockPrismaClient = createMockPrismaClient();

// Spy on countTextTokens to verify it's called correctly
vi.spyOn(tokenCounter, 'countTextTokens');

describe('ConversationSyncService', () => {
  let service: ConversationSyncService;

  beforeEach(() => {
    service = new ConversationSyncService(mockPrismaClient as unknown as PrismaClient);
    vi.clearAllMocks();
  });

  describe('softDeleteMessage', () => {
    it('should soft delete a message by setting deletedAt', async () => {
      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        id: 'msg-123',
        deletedAt: new Date(),
      });

      const result = await service.softDeleteMessage('msg-123');

      expect(result).toBe(true);
      expect(mockPrismaClient.conversationHistory.update).toHaveBeenCalledWith({
        where: { id: 'msg-123' },
        data: { deletedAt: expect.any(Date) },
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
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          channelId: true,
          personalityId: true,
          personaId: true,
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

      (tokenCounter.countTextTokens as ReturnType<typeof vi.fn>).mockReturnValue(expectedTokens);
      mockPrismaClient.conversationHistory.update.mockResolvedValue({
        id: 'msg-123',
        content: newContent,
        tokenCount: expectedTokens,
      });

      const result = await service.updateMessageContent('msg-123', newContent);

      expect(result).toBe(true);
      expect(tokenCounter.countTextTokens).toHaveBeenCalledWith(newContent);
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
});
