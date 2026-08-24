/**
 * Tests for Cleanup Command Events
 *
 * Tests the scheduled cleanup of command-event telemetry rows:
 * - 365-day (12-month) retention by default
 * - Custom retention period support
 * - Error propagation
 * - Timing calculation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupCommandEvents } from './CleanupCommandEvents.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('CleanupCommandEvents', () => {
  let mockPrisma: {
    commandEvent: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      commandEvent: {
        deleteMany: vi.fn(),
      },
    };
    vi.clearAllMocks();
  });

  describe('cleanupCommandEvents', () => {
    it('deletes rows older than 365 days by default', async () => {
      mockPrisma.commandEvent.deleteMany.mockResolvedValue({ count: 5 });

      const before = Date.now();
      await cleanupCommandEvents(mockPrisma as unknown as PrismaClient);
      const after = Date.now();

      expect(mockPrisma.commandEvent.deleteMany).toHaveBeenCalledWith({
        where: {
          occurredAt: {
            lt: expect.any(Date),
          },
        },
      });

      const deleteCall = mockPrisma.commandEvent.deleteMany.mock.calls[0][0];
      const cutoffTime = deleteCall.where.occurredAt.lt.getTime();

      const retentionMs = 365 * 24 * 60 * 60 * 1000;
      const expectedCutoffMin = before - retentionMs;
      const expectedCutoffMax = after - retentionMs;

      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffTime).toBeLessThanOrEqual(expectedCutoffMax);
    });

    it('respects a custom retention period', async () => {
      mockPrisma.commandEvent.deleteMany.mockResolvedValue({ count: 10 });

      const customDays = 30;
      const before = Date.now();
      await cleanupCommandEvents(mockPrisma as unknown as PrismaClient, customDays);
      const after = Date.now();

      const deleteCall = mockPrisma.commandEvent.deleteMany.mock.calls[0][0];
      const cutoffTime = deleteCall.where.occurredAt.lt.getTime();

      const retentionMs = customDays * 24 * 60 * 60 * 1000;
      const expectedCutoffMin = before - retentionMs;
      const expectedCutoffMax = after - retentionMs;

      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffTime).toBeLessThanOrEqual(expectedCutoffMax);
    });

    it('returns correct result structure', async () => {
      mockPrisma.commandEvent.deleteMany.mockResolvedValue({ count: 15 });

      const result = await cleanupCommandEvents(mockPrisma as unknown as PrismaClient);

      expect(result).toEqual({
        deletedCount: 15,
        cutoffDate: expect.any(Date),
        durationMs: expect.any(Number),
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('handles zero deletions', async () => {
      mockPrisma.commandEvent.deleteMany.mockResolvedValue({ count: 0 });

      const result = await cleanupCommandEvents(mockPrisma as unknown as PrismaClient);

      expect(result.deletedCount).toBe(0);
      expect(mockPrisma.commandEvent.deleteMany).toHaveBeenCalled();
    });

    it('propagates database errors', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.commandEvent.deleteMany.mockRejectedValue(error);

      await expect(cleanupCommandEvents(mockPrisma as unknown as PrismaClient)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });
});
