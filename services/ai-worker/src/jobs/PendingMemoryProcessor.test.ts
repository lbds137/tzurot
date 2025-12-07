/**
 * Tests for Pending Memory Processor
 *
 * Tests the job that processes pending_memory records that failed to store
 * to the vector database. Covers:
 * - Processing pending memories with retry logic
 * - Metadata validation
 * - Error handling and max attempts
 * - Statistics collection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingMemoryProcessor } from './PendingMemoryProcessor.js';
import type { PrismaClient } from '@tzurot/common-types';
import type { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';

// Mock dependencies
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

describe('PendingMemoryProcessor', () => {
  let mockPrisma: {
    pendingMemory: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    $disconnect: ReturnType<typeof vi.fn>;
  };

  let mockMemoryAdapter: {
    addMemory: ReturnType<typeof vi.fn>;
  };

  const createValidMetadata = () => ({
    personaId: 'persona-123',
    personalityId: 'personality-123',
    personalityName: 'Test Personality',
    canonScope: 'global' as const,
    createdAt: Date.now(),
    channelId: 'channel-123',
  });

  beforeEach(() => {
    mockPrisma = {
      pendingMemory: {
        findMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      $disconnect: vi.fn(),
    };

    mockMemoryAdapter = {
      addMemory: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processPendingMemories', () => {
    it('should return early if memory adapter is unavailable', async () => {
      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        undefined // No memory adapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
      expect(mockPrisma.pendingMemory.findMany).not.toHaveBeenCalled();
    });

    it('should return early if no pending memories exist', async () => {
      mockPrisma.pendingMemory.findMany.mockResolvedValue([]);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
      expect(mockPrisma.pendingMemory.findMany).toHaveBeenCalledWith({
        where: { attempts: { lt: 3 } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    });

    it('should successfully process and delete pending memory', async () => {
      const pendingMemory = {
        id: 'pending-1',
        text: 'Test memory content',
        metadata: createValidMetadata(),
        attempts: 0,
        createdAt: new Date(),
      };

      mockPrisma.pendingMemory.findMany.mockResolvedValue([pendingMemory]);
      mockMemoryAdapter.addMemory.mockResolvedValue(undefined);
      mockPrisma.pendingMemory.delete.mockResolvedValue(pendingMemory);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      });
      expect(mockMemoryAdapter.addMemory).toHaveBeenCalledWith({
        text: 'Test memory content',
        metadata: expect.objectContaining({
          personaId: 'persona-123',
          personalityId: 'personality-123',
          canonScope: 'global',
        }),
      });
      expect(mockPrisma.pendingMemory.delete).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
      });
    });

    it('should skip and mark invalid metadata records', async () => {
      const pendingMemory = {
        id: 'pending-1',
        text: 'Test memory content',
        metadata: { invalid: 'metadata' }, // Missing required fields
        attempts: 0,
        createdAt: new Date(),
      };

      mockPrisma.pendingMemory.findMany.mockResolvedValue([pendingMemory]);
      mockPrisma.pendingMemory.update.mockResolvedValue(pendingMemory);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 1,
        succeeded: 0,
        failed: 0,
        skipped: 1,
      });
      expect(mockMemoryAdapter.addMemory).not.toHaveBeenCalled();
      expect(mockPrisma.pendingMemory.update).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
        data: expect.objectContaining({
          attempts: 999, // High attempts to prevent retry
          error: expect.stringContaining('Invalid metadata'),
        }),
      });
    });

    it('should increment attempts on storage failure', async () => {
      const pendingMemory = {
        id: 'pending-1',
        text: 'Test memory content',
        metadata: createValidMetadata(),
        attempts: 0,
        createdAt: new Date(),
      };

      mockPrisma.pendingMemory.findMany.mockResolvedValue([pendingMemory]);
      mockMemoryAdapter.addMemory.mockRejectedValue(new Error('Storage failed'));
      mockPrisma.pendingMemory.update.mockResolvedValue(pendingMemory);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 1,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      });
      expect(mockPrisma.pendingMemory.update).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
        data: expect.objectContaining({
          attempts: 1,
          error: 'Storage failed',
        }),
      });
    });

    it('should give up after max attempts (3)', async () => {
      const pendingMemory = {
        id: 'pending-1',
        text: 'Test memory content',
        metadata: createValidMetadata(),
        attempts: 2, // Already at 2, next failure will be 3 (max)
        createdAt: new Date(),
      };

      mockPrisma.pendingMemory.findMany.mockResolvedValue([pendingMemory]);
      mockMemoryAdapter.addMemory.mockRejectedValue(new Error('Storage failed again'));
      mockPrisma.pendingMemory.update.mockResolvedValue(pendingMemory);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 1,
        succeeded: 0,
        failed: 1,
        skipped: 0,
      });
      expect(mockPrisma.pendingMemory.update).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
        data: expect.objectContaining({
          attempts: 3,
          error: 'Storage failed again',
        }),
      });
    });

    it('should process multiple pending memories', async () => {
      const pendingMemories = [
        {
          id: 'pending-1',
          text: 'Memory 1',
          metadata: createValidMetadata(),
          attempts: 0,
          createdAt: new Date(),
        },
        {
          id: 'pending-2',
          text: 'Memory 2',
          metadata: createValidMetadata(),
          attempts: 0,
          createdAt: new Date(),
        },
        {
          id: 'pending-3',
          text: 'Memory 3',
          metadata: { invalid: 'data' },
          attempts: 0,
          createdAt: new Date(),
        },
      ];

      mockPrisma.pendingMemory.findMany.mockResolvedValue(pendingMemories);
      mockMemoryAdapter.addMemory
        .mockResolvedValueOnce(undefined) // First succeeds
        .mockRejectedValueOnce(new Error('Failed')); // Second fails
      mockPrisma.pendingMemory.delete.mockResolvedValue({});
      mockPrisma.pendingMemory.update.mockResolvedValue({});

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 3,
        succeeded: 1,
        failed: 1,
        skipped: 1,
      });
    });

    it('should handle non-Error error objects', async () => {
      const pendingMemory = {
        id: 'pending-1',
        text: 'Test memory content',
        metadata: createValidMetadata(),
        attempts: 0,
        createdAt: new Date(),
      };

      mockPrisma.pendingMemory.findMany.mockResolvedValue([pendingMemory]);
      mockMemoryAdapter.addMemory.mockRejectedValue('String error message');
      mockPrisma.pendingMemory.update.mockResolvedValue(pendingMemory);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(mockPrisma.pendingMemory.update).toHaveBeenCalledWith({
        where: { id: 'pending-1' },
        data: expect.objectContaining({
          error: 'String error message',
        }),
      });
      expect(result.failed).toBe(1);
    });

    it('should handle findMany errors gracefully', async () => {
      mockPrisma.pendingMemory.findMany.mockRejectedValue(new Error('Database error'));

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        mockMemoryAdapter as unknown as PgvectorMemoryAdapter
      );

      const result = await processor.processPendingMemories();

      expect(result).toEqual({
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      });
    });
  });

  describe('getStats', () => {
    it('should return statistics about pending memories', async () => {
      const pending = [{ attempts: 0 }, { attempts: 0 }, { attempts: 1 }, { attempts: 2 }];

      mockPrisma.pendingMemory.findMany.mockResolvedValue(pending);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        undefined
      );

      const stats = await processor.getStats();

      expect(stats).toEqual({
        total: 4,
        byAttempts: {
          0: 2,
          1: 1,
          2: 1,
        },
      });
    });

    it('should return empty stats when no pending memories exist', async () => {
      mockPrisma.pendingMemory.findMany.mockResolvedValue([]);

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        undefined
      );

      const stats = await processor.getStats();

      expect(stats).toEqual({
        total: 0,
        byAttempts: {},
      });
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.pendingMemory.findMany.mockRejectedValue(new Error('Database error'));

      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        undefined
      );

      const stats = await processor.getStats();

      expect(stats).toEqual({
        total: 0,
        byAttempts: {},
      });
    });
  });

  describe('disconnect', () => {
    it('should disconnect Prisma client', async () => {
      const processor = new PendingMemoryProcessor(
        mockPrisma as unknown as PrismaClient,
        undefined
      );

      await processor.disconnect();

      expect(mockPrisma.$disconnect).toHaveBeenCalled();
    });
  });
});
