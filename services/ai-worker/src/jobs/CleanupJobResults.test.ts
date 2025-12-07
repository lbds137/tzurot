/**
 * Tests for Cleanup Job Results
 *
 * Tests the opportunistic cleanup of old delivered job results:
 * - Probabilistic cleanup triggering (5% chance)
 * - Force cleanup via parameter
 * - Threshold-based forced cleanup (>10k rows)
 * - Retention period (24 hours)
 * - Error handling (never throws)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanupOldJobResults } from './CleanupJobResults.js';
import type { PrismaClient } from '@tzurot/common-types';

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

describe('CleanupJobResults', () => {
  let mockPrisma: {
    jobResult: {
      count: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  const originalMathRandom = Math.random;

  beforeEach(() => {
    mockPrisma = {
      jobResult: {
        count: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    Math.random = originalMathRandom;
    vi.restoreAllMocks();
  });

  describe('cleanupOldJobResults', () => {
    it('should skip cleanup when random > 0.05 and below threshold', async () => {
      // Random returns 0.1 - above 5% probability
      Math.random = vi.fn().mockReturnValue(0.1);
      mockPrisma.jobResult.count.mockResolvedValue(100); // Below 10k threshold

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.count).toHaveBeenCalled();
      expect(mockPrisma.jobResult.deleteMany).not.toHaveBeenCalled();
    });

    it('should run cleanup when random <= 0.05', async () => {
      // Random returns 0.03 - within 5% probability
      Math.random = vi.fn().mockReturnValue(0.03);
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 5 });

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.count).not.toHaveBeenCalled(); // Skip threshold check
      expect(mockPrisma.jobResult.deleteMany).toHaveBeenCalledWith({
        where: {
          status: 'DELIVERED',
          deliveredAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('should force cleanup when force=true', async () => {
      // Random returns high value but force overrides
      Math.random = vi.fn().mockReturnValue(0.99);
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 3 });

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient, true);

      expect(mockPrisma.jobResult.count).not.toHaveBeenCalled();
      expect(mockPrisma.jobResult.deleteMany).toHaveBeenCalled();
    });

    it('should force cleanup when threshold exceeded (>10k)', async () => {
      Math.random = vi.fn().mockReturnValue(0.99); // High random
      mockPrisma.jobResult.count.mockResolvedValue(15000); // Above 10k threshold
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 15000 });

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.count).toHaveBeenCalled();
      expect(mockPrisma.jobResult.deleteMany).toHaveBeenCalled();
    });

    it('should not force cleanup when exactly at threshold (10k)', async () => {
      Math.random = vi.fn().mockReturnValue(0.99);
      mockPrisma.jobResult.count.mockResolvedValue(10000); // At threshold, not above

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.count).toHaveBeenCalled();
      expect(mockPrisma.jobResult.deleteMany).not.toHaveBeenCalled();
    });

    it('should use 24 hour cutoff time', async () => {
      Math.random = vi.fn().mockReturnValue(0.01);
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);
      const after = Date.now();

      const deleteCall = mockPrisma.jobResult.deleteMany.mock.calls[0][0];
      const cutoffTime = deleteCall.where.deliveredAt.lt.getTime();

      // Cutoff should be ~24 hours ago (within test execution window)
      const expectedCutoffMin = before - 24 * 60 * 60 * 1000;
      const expectedCutoffMax = after - 24 * 60 * 60 * 1000;

      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffTime).toBeLessThanOrEqual(expectedCutoffMax);
    });

    it('should handle deleteMany returning 0 results', async () => {
      Math.random = vi.fn().mockReturnValue(0.01);
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 0 });

      // Should not throw
      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.deleteMany).toHaveBeenCalled();
    });

    it('should not throw on count error', async () => {
      Math.random = vi.fn().mockReturnValue(0.99);
      mockPrisma.jobResult.count.mockRejectedValue(new Error('Database error'));

      // Should not throw - best effort cleanup
      await expect(cleanupOldJobResults(mockPrisma as unknown as PrismaClient)).resolves.toBeUndefined();
    });

    it('should not throw on deleteMany error', async () => {
      Math.random = vi.fn().mockReturnValue(0.01);
      mockPrisma.jobResult.deleteMany.mockRejectedValue(new Error('Delete failed'));

      // Should not throw - best effort cleanup
      await expect(cleanupOldJobResults(mockPrisma as unknown as PrismaClient)).resolves.toBeUndefined();
    });

    it('should only delete DELIVERED status results', async () => {
      Math.random = vi.fn().mockReturnValue(0.01);
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 10 });

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'DELIVERED',
          }),
        })
      );
    });

    it('should handle edge case: random exactly 0.05', async () => {
      // Edge case: random returns exactly 0.05 (should trigger cleanup)
      Math.random = vi.fn().mockReturnValue(0.05);
      mockPrisma.jobResult.deleteMany.mockResolvedValue({ count: 1 });

      await cleanupOldJobResults(mockPrisma as unknown as PrismaClient);

      expect(mockPrisma.jobResult.deleteMany).toHaveBeenCalled();
    });
  });
});
