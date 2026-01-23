/**
 * Tests for Cleanup Diagnostic Logs
 *
 * Tests the scheduled cleanup of LLM diagnostic logs:
 * - 24 hour retention by default
 * - Custom retention period support
 * - Error propagation
 * - Timing calculation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupDiagnosticLogs, type DiagnosticCleanupResult } from './CleanupDiagnosticLogs.js';
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

describe('CleanupDiagnosticLogs', () => {
  let mockPrisma: {
    llmDiagnosticLog: {
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      llmDiagnosticLog: {
        deleteMany: vi.fn(),
      },
    };
    vi.clearAllMocks();
  });

  describe('cleanupDiagnosticLogs', () => {
    it('should delete logs older than 24 hours by default', async () => {
      mockPrisma.llmDiagnosticLog.deleteMany.mockResolvedValue({ count: 5 });

      const before = Date.now();
      const result = await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient);
      const after = Date.now();

      expect(mockPrisma.llmDiagnosticLog.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: {
            lt: expect.any(Date),
          },
        },
      });

      // Cutoff should be ~24 hours ago
      const deleteCall = mockPrisma.llmDiagnosticLog.deleteMany.mock.calls[0][0];
      const cutoffTime = deleteCall.where.createdAt.lt.getTime();

      const expectedCutoffMin = before - 24 * 60 * 60 * 1000;
      const expectedCutoffMax = after - 24 * 60 * 60 * 1000;

      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffTime).toBeLessThanOrEqual(expectedCutoffMax);
    });

    it('should respect custom retention period', async () => {
      mockPrisma.llmDiagnosticLog.deleteMany.mockResolvedValue({ count: 10 });

      const customHours = 48;
      const before = Date.now();
      await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient, customHours);
      const after = Date.now();

      const deleteCall = mockPrisma.llmDiagnosticLog.deleteMany.mock.calls[0][0];
      const cutoffTime = deleteCall.where.createdAt.lt.getTime();

      // Cutoff should be ~48 hours ago
      const expectedCutoffMin = before - customHours * 60 * 60 * 1000;
      const expectedCutoffMax = after - customHours * 60 * 60 * 1000;

      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffTime).toBeLessThanOrEqual(expectedCutoffMax);
    });

    it('should return correct result structure', async () => {
      mockPrisma.llmDiagnosticLog.deleteMany.mockResolvedValue({ count: 15 });

      const result = await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient);

      expect(result).toEqual({
        deletedCount: 15,
        cutoffDate: expect.any(Date),
        durationMs: expect.any(Number),
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle zero deletions', async () => {
      mockPrisma.llmDiagnosticLog.deleteMany.mockResolvedValue({ count: 0 });

      const result = await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient);

      expect(result.deletedCount).toBe(0);
      expect(mockPrisma.llmDiagnosticLog.deleteMany).toHaveBeenCalled();
    });

    it('should propagate database errors', async () => {
      const error = new Error('Database connection failed');
      mockPrisma.llmDiagnosticLog.deleteMany.mockRejectedValue(error);

      await expect(cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should calculate duration correctly', async () => {
      // Add a small delay to ensure measurable duration
      mockPrisma.llmDiagnosticLog.deleteMany.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return { count: 1 };
      });

      const result = await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient);

      expect(result.durationMs).toBeGreaterThanOrEqual(5);
    });

    it('should handle edge case: 1 hour retention', async () => {
      mockPrisma.llmDiagnosticLog.deleteMany.mockResolvedValue({ count: 100 });

      const before = Date.now();
      await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient, 1);
      const after = Date.now();

      const deleteCall = mockPrisma.llmDiagnosticLog.deleteMany.mock.calls[0][0];
      const cutoffTime = deleteCall.where.createdAt.lt.getTime();

      // Cutoff should be ~1 hour ago
      const expectedCutoffMin = before - 1 * 60 * 60 * 1000;
      const expectedCutoffMax = after - 1 * 60 * 60 * 1000;

      expect(cutoffTime).toBeGreaterThanOrEqual(expectedCutoffMin);
      expect(cutoffTime).toBeLessThanOrEqual(expectedCutoffMax);
    });

    it('should handle large deletion counts', async () => {
      mockPrisma.llmDiagnosticLog.deleteMany.mockResolvedValue({ count: 100000 });

      const result = await cleanupDiagnosticLogs(mockPrisma as unknown as PrismaClient);

      expect(result.deletedCount).toBe(100000);
    });
  });
});
