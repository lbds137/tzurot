/**
 * Unit tests for ConversationRetentionService
 * Tests cleanup and retention operations for conversation history
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRetentionService } from './ConversationRetentionService.js';

// Suppress logger output in tests
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Helper to create a mock Prisma client with transaction support
function createMockPrismaClient() {
  const mockClient = {
    conversationHistory: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    conversationHistoryTombstone: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  // Make $transaction execute the callback with the mock client
  mockClient.$transaction.mockImplementation(
    async (callback: (tx: typeof mockClient) => Promise<unknown>) => {
      return callback(mockClient);
    }
  );

  return mockClient;
}

describe('ConversationRetentionService', () => {
  let service: ConversationRetentionService;
  let mockPrismaClient: ReturnType<typeof createMockPrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaClient = createMockPrismaClient();
    service = new ConversationRetentionService(mockPrismaClient as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('clearHistory', () => {
    it('should delete all messages for channel and personality with tombstones', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-1',
        },
        {
          id: 'msg-2',
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-1',
        },
      ];
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 42 });
      mockPrismaClient.conversationHistoryTombstone.createMany.mockResolvedValue({ count: 2 });

      const count = await service.clearHistory('channel-123', 'personality-456');

      expect(count).toBe(42);
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: { channelId: 'channel-123', personalityId: 'personality-456' },
        select: { id: true, channelId: true, personalityId: true, personaId: true },
      });
      expect(mockPrismaClient.conversationHistoryTombstone.createMany).toHaveBeenCalledWith({
        data: mockMessages.map(msg => ({
          id: msg.id,
          channelId: msg.channelId,
          personalityId: msg.personalityId,
          personaId: msg.personaId,
        })),
        skipDuplicates: true,
      });
      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { channelId: 'channel-123', personalityId: 'personality-456' },
      });
    });

    it('should return 0 when no messages to delete', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const count = await service.clearHistory('channel-empty', 'personality-456');

      expect(count).toBe(0);
      expect(mockPrismaClient.conversationHistoryTombstone.createMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      await expect(service.clearHistory('channel-123', 'personality-456')).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should delete only messages for specific persona when personaId provided', async () => {
      const mockMessages = [
        {
          id: 'msg-1',
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
        },
      ];
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 10 });
      mockPrismaClient.conversationHistoryTombstone.createMany.mockResolvedValue({ count: 1 });

      const count = await service.clearHistory('channel-123', 'personality-456', 'persona-789');

      expect(count).toBe(10);
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: {
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
        },
        select: { id: true, channelId: true, personalityId: true, personaId: true },
      });
    });
  });

  describe('cleanupOldHistory', () => {
    it('should delete messages older than specified days and create tombstones', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2025-11-18T00:00:00Z');
      vi.setSystemTime(fixedDate);

      const mockOldMessages = [
        {
          id: 'msg-1',
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
        },
        {
          id: 'msg-2',
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
        },
      ];
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockOldMessages);
      mockPrismaClient.conversationHistoryTombstone.createMany.mockResolvedValue({ count: 2 });
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 2 });

      const count = await service.cleanupOldHistory(30);

      expect(count).toBe(2);

      const expectedCutoff = new Date(fixedDate);
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      expect(mockPrismaClient.conversationHistoryTombstone.createMany).toHaveBeenCalledWith({
        data: mockOldMessages.map(msg => ({
          id: msg.id,
          channelId: msg.channelId,
          personalityId: msg.personalityId,
          personaId: msg.personaId,
        })),
        skipDuplicates: true,
      });
      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expectedCutoff } },
      });
    });

    it('should use default 30 days if not specified', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2025-11-18T00:00:00Z');
      vi.setSystemTime(fixedDate);

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([
        {
          id: 'msg-1',
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: null,
        },
      ]);
      mockPrismaClient.conversationHistoryTombstone.createMany.mockResolvedValue({ count: 1 });
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      const count = await service.cleanupOldHistory();

      expect(count).toBe(1);

      const expectedCutoff = new Date(fixedDate);
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expectedCutoff } },
        select: { id: true, channelId: true, personalityId: true, personaId: true },
      });
    });

    it('should return 0 when no old messages to delete', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const count = await service.cleanupOldHistory(30);

      expect(count).toBe(0);
      expect(mockPrismaClient.conversationHistoryTombstone.createMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      await expect(service.cleanupOldHistory(30)).rejects.toThrow('Database connection failed');
    });

    it('should create tombstones before deleting messages (transaction ordering)', async () => {
      const mockMessages = [
        { id: 'msg-1', channelId: 'ch-1', personalityId: 'p-1', personaId: null },
      ];
      const callOrder: string[] = [];

      mockPrismaClient.conversationHistory.findMany.mockImplementation(async () => {
        callOrder.push('findMany');
        return mockMessages;
      });
      mockPrismaClient.conversationHistoryTombstone.createMany.mockImplementation(async () => {
        callOrder.push('createMany');
        return { count: 1 };
      });
      mockPrismaClient.conversationHistory.deleteMany.mockImplementation(async () => {
        callOrder.push('deleteMany');
        return { count: 1 };
      });

      await service.cleanupOldHistory(30);

      expect(callOrder).toEqual(['findMany', 'createMany', 'deleteMany']);
    });
  });

  describe('cleanupOldTombstones', () => {
    it('should delete tombstones older than specified days', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2025-11-18T00:00:00Z');
      vi.setSystemTime(fixedDate);

      mockPrismaClient.conversationHistoryTombstone.deleteMany.mockResolvedValue({ count: 5 });

      const count = await service.cleanupOldTombstones(7);

      expect(count).toBe(5);

      const expectedCutoff = new Date(fixedDate);
      expectedCutoff.setDate(expectedCutoff.getDate() - 7);

      expect(mockPrismaClient.conversationHistoryTombstone.deleteMany).toHaveBeenCalledWith({
        where: { deletedAt: { lt: expectedCutoff } },
      });
    });

    it('should use default days if not specified', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2025-11-18T00:00:00Z');
      vi.setSystemTime(fixedDate);

      mockPrismaClient.conversationHistoryTombstone.deleteMany.mockResolvedValue({ count: 3 });

      const count = await service.cleanupOldTombstones();

      expect(count).toBe(3);
      expect(mockPrismaClient.conversationHistoryTombstone.deleteMany).toHaveBeenCalled();
    });

    it('should return 0 when no old tombstones to delete', async () => {
      mockPrismaClient.conversationHistoryTombstone.deleteMany.mockResolvedValue({ count: 0 });

      const count = await service.cleanupOldTombstones(7);

      expect(count).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistoryTombstone.deleteMany.mockRejectedValue(error);

      await expect(service.cleanupOldTombstones(7)).rejects.toThrow('Database connection failed');
    });
  });
});
