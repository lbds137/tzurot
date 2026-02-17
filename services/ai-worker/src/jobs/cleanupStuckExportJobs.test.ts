/**
 * Tests for cleanupStuckExportJobs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupStuckExportJobs } from './cleanupStuckExportJobs.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

function createMockPrisma() {
  return {
    exportJob: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('cleanupStuckExportJobs', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
  });

  it('should return zero when no stuck jobs exist', async () => {
    mockPrisma.exportJob.findMany.mockResolvedValue([]);

    const result = await cleanupStuckExportJobs(mockPrisma as never);

    expect(result.cleanedCount).toBe(0);
    expect(mockPrisma.exportJob.updateMany).not.toHaveBeenCalled();
  });

  it('should mark stuck in_progress jobs as failed', async () => {
    const stuckJob = {
      id: 'stuck-export-1',
      sourceSlug: 'test-shape',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    };
    mockPrisma.exportJob.findMany.mockResolvedValue([stuckJob]);
    mockPrisma.exportJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupStuckExportJobs(mockPrisma as never);

    expect(result.cleanedCount).toBe(1);
    expect(mockPrisma.exportJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['stuck-export-1'] } },
      data: {
        status: 'failed',
        completedAt: expect.any(Date),
        errorMessage: 'Job timed out — worker may have restarted. You can retry the export.',
      },
    });
  });

  it('should query with correct threshold cutoff', async () => {
    mockPrisma.exportJob.findMany.mockResolvedValue([]);

    // Use a custom threshold of 30 minutes
    await cleanupStuckExportJobs(mockPrisma as never, 30 * 60 * 1000);

    const findManyCall = mockPrisma.exportJob.findMany.mock.calls[0][0];
    expect(findManyCall.where.status).toBe('in_progress');
    expect(findManyCall.where.startedAt.lt).toBeInstanceOf(Date);
  });

  it('should handle multiple stuck jobs in one batch', async () => {
    const stuckJobs = [
      { id: 'stuck-1', sourceSlug: 'shape-a', startedAt: new Date(Date.now() - 3600_000) },
      { id: 'stuck-2', sourceSlug: 'shape-b', startedAt: new Date(Date.now() - 7200_000) },
      { id: 'stuck-3', sourceSlug: 'shape-c', startedAt: new Date(Date.now() - 5400_000) },
    ];
    mockPrisma.exportJob.findMany.mockResolvedValue(stuckJobs);
    mockPrisma.exportJob.updateMany.mockResolvedValue({ count: 3 });

    const result = await cleanupStuckExportJobs(mockPrisma as never);

    expect(result.cleanedCount).toBe(3);
    expect(mockPrisma.exportJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['stuck-1', 'stuck-2', 'stuck-3'] } },
      })
    );
  });

  it('should propagate database errors', async () => {
    mockPrisma.exportJob.findMany.mockRejectedValue(new Error('DB connection lost'));

    await expect(cleanupStuckExportJobs(mockPrisma as never)).rejects.toThrow('DB connection lost');
  });
});
