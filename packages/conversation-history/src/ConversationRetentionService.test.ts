/**
 * Unit tests for ConversationRetentionService
 * Tests cleanup and retention operations for conversation history
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationRetentionService } from './ConversationRetentionService.js';

// Hoisted so the count-gated info log below can be asserted on directly.
const { mockLoggerInfo } = vi.hoisted(() => ({ mockLoggerInfo: vi.fn() }));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: mockLoggerInfo,
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Hoisted spies on the propagation seam: the batch-commit boundary that
// decides WHICH discord ids (if any) reach memory deletion is otherwise
// invisible to a test that only checks the returned delete count.
const { mockPropagateDeletionToMemories, mockPropagateDeletionToFacts } = vi.hoisted(() => ({
  mockPropagateDeletionToMemories: vi.fn(async () => undefined),
  mockPropagateDeletionToFacts: vi.fn(async () => undefined),
}));
vi.mock('./memoryDeletionPropagation.js', () => ({
  propagateDeletionToMemories: mockPropagateDeletionToMemories,
  propagateDeletionToFacts: mockPropagateDeletionToFacts,
}));
// Helper to create a mock Prisma client with transaction support
function createMockPrismaClient() {
  const mockClient = {
    conversationHistory: {
      findMany: vi.fn(),
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
    it('should delete all messages for channel and personality using batching', async () => {
      const mockMessages = [{ id: 'msg-1' }, { id: 'msg-2' }];
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue(mockMessages);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 2 });

      const count = await service.clearHistory('channel-123', 'personality-456');

      expect(count).toBe(2);
      // Batched query: pagination params + id AND discordMessageId. The latter
      // is what the memory-deletion propagation matches on, and the hard delete
      // destroys these rows — so if the select ever drops it, a purge silently
      // stops retiring the memories derived from the turns it erased.
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: { channelId: 'channel-123', personalityId: 'personality-456' },
        select: { id: true, discordMessageId: true },
        take: 1000, // SYNC_LIMITS.RETENTION_BATCH_SIZE
        orderBy: { id: 'asc' },
      });
      // Batched deletion uses IDs from the batch.
      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['msg-1', 'msg-2'] } },
      });
    });

    it('should return 0 when no messages to delete', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const count = await service.clearHistory('channel-empty', 'personality-456');

      expect(count).toBe(0);
      expect(mockPrismaClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('processes multiple batches, each in its OWN transaction (lock-release seam)', async () => {
      // The crux of the per-batch rework: a full-size batch means "keep going", and
      // each iteration commits its own transaction so row locks release between
      // batches (a sweep-wide transaction + the pool's lock_timeout would 55P03
      // concurrent writers for the whole sweep).
      const fullBatch = Array.from({ length: 1000 }, (_, i) => ({ id: `msg-${i}` }));
      const shortBatch = [{ id: 'msg-last' }];
      mockPrismaClient.conversationHistory.findMany
        .mockResolvedValueOnce(fullBatch)
        .mockResolvedValueOnce(shortBatch);
      mockPrismaClient.conversationHistory.deleteMany
        .mockResolvedValueOnce({ count: 1000 })
        .mockResolvedValueOnce({ count: 1 });

      const count = await service.clearHistory('channel-123', 'personality-456');

      expect(count).toBe(1001);
      // One transaction PER batch — the lock-release boundary this rework exists for.
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['msg-last'] } },
      });
    });

    it('should throw error on database failure', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      await expect(service.clearHistory('channel-123', 'personality-456')).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should delete only messages for specific persona when personaId provided', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([{ id: 'msg-1' }]);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      const count = await service.clearHistory('channel-123', 'personality-456', 'persona-789');

      expect(count).toBe(1);
      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: {
          channelId: 'channel-123',
          personalityId: 'personality-456',
          personaId: 'persona-789',
        },
        select: { id: true, discordMessageId: true },
        take: 1000,
        orderBy: { id: 'asc' },
      });
    });
  });

  describe('clearHistory — personaId filter shape', () => {
    it('omits personaId from the where clause when the argument is an empty string', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.clearHistory('channel-123', 'personality-456', '');

      const where = mockPrismaClient.conversationHistory.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('personaId');
    });
  });

  describe('cleanupOldHistory', () => {
    it('should delete messages older than specified days using batching', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-18T00:00:00Z'));

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([
        { id: 'msg-1' },
        { id: 'msg-2' },
      ]);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 2 });

      const count = await service.cleanupOldHistory(30);

      expect(count).toBe(2);
      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['msg-1', 'msg-2'] } },
      });
    });

    it('should use default 30 days if not specified', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2025-11-18T00:00:00Z');
      vi.setSystemTime(fixedDate);

      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([{ id: 'msg-1' }]);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      const count = await service.cleanupOldHistory();

      expect(count).toBe(1);

      const expectedCutoff = new Date(fixedDate);
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      expect(mockPrismaClient.conversationHistory.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: expectedCutoff } },
        select: { id: true },
        take: 1000,
        orderBy: { id: 'asc' },
      });
    });

    it('should return 0 when no old messages to delete', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      const count = await service.cleanupOldHistory(30);

      expect(count).toBe(0);
      expect(mockPrismaClient.conversationHistory.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.findMany.mockRejectedValue(error);

      await expect(service.cleanupOldHistory(30)).rejects.toThrow('Database connection failed');
    });
  });

  describe('cleanupSoftDeletedMessages', () => {
    it('should hard delete messages with deletedAt older than specified days', async () => {
      vi.useFakeTimers();
      const fixedDate = new Date('2025-11-18T00:00:00Z');
      vi.setSystemTime(fixedDate);

      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 10 });

      const count = await service.cleanupSoftDeletedMessages(7);

      expect(count).toBe(10);

      const expectedCutoff = new Date(fixedDate);
      expectedCutoff.setDate(expectedCutoff.getDate() - 7);

      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenCalledWith({
        where: { deletedAt: { lt: expectedCutoff } },
      });
    });

    it('should use default days if not specified', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-18T00:00:00Z'));

      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 5 });

      const count = await service.cleanupSoftDeletedMessages();

      expect(count).toBe(5);
      expect(mockPrismaClient.conversationHistory.deleteMany).toHaveBeenCalled();
    });

    it('should return 0 when no soft-deleted messages to cleanup', async () => {
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 0 });

      const count = await service.cleanupSoftDeletedMessages(7);

      expect(count).toBe(0);
    });

    it('should throw error on database failure', async () => {
      const error = new Error('Database connection failed');
      mockPrismaClient.conversationHistory.deleteMany.mockRejectedValue(error);

      await expect(service.cleanupSoftDeletedMessages(7)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('memory-propagation seam', () => {
    it("the batch's discord ids reach propagation, after the batch commits", async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([
        { id: 'm1', discordMessageId: ['d1', 'd2'] },
      ]);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      await service.clearHistory('channel-123', 'personality-456');

      expect(mockPropagateDeletionToMemories).toHaveBeenCalledWith(expect.anything(), ['d1', 'd2']);
    });

    it('a batch carrying no discord ids propagates nothing', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([{ id: 'm1' }]);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      await service.clearHistory('channel-123', 'personality-456');

      expect(mockPropagateDeletionToMemories).not.toHaveBeenCalled();
    });

    it('an empty batch propagates nothing', async () => {
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([]);

      await service.clearHistory('channel-123', 'personality-456');

      expect(mockPropagateDeletionToMemories).not.toHaveBeenCalled();
    });

    it('the time-based sweep never propagates, even over rows that carry discord ids', async () => {
      // Time-based retention deliberately does not propagate to memories —
      // long-term memory is meant to outlive the conversation window.
      mockPrismaClient.conversationHistory.findMany.mockResolvedValue([
        { id: 'm1', discordMessageId: ['d1'] },
      ]);
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 1 });

      await expect(service.cleanupOldHistory(30)).resolves.toBe(1);

      expect(mockPropagateDeletionToMemories).not.toHaveBeenCalled();
    });
  });

  describe('cleanupSoftDeletedMessages — count-gated logging', () => {
    it('logs the count only when rows were actually removed', async () => {
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 3 });

      await service.cleanupSoftDeletedMessages(7);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ count: 3 }),
        'Hard deleted soft-deleted messages'
      );
    });

    it('stays silent when nothing was due', async () => {
      mockPrismaClient.conversationHistory.deleteMany.mockResolvedValue({ count: 0 });

      await service.cleanupSoftDeletedMessages(7);

      expect(mockLoggerInfo).not.toHaveBeenCalledWith(
        expect.anything(),
        'Hard deleted soft-deleted messages'
      );
    });
  });
});
