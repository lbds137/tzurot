/**
 * Tests for cleanupStuckImportJobs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupStuckImportJobs } from './cleanupStuckImportJobs.js';

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
    importJob: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

describe('cleanupStuckImportJobs', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
  });

  it('should return zero when no stuck jobs exist', async () => {
    mockPrisma.importJob.findMany.mockResolvedValue([]);

    const result = await cleanupStuckImportJobs(mockPrisma as never);

    expect(result.cleanedCount).toBe(0);
    expect(mockPrisma.importJob.updateMany).not.toHaveBeenCalled();
  });

  it('should mark stuck in_progress jobs as failed', async () => {
    const stuckJob = {
      id: 'stuck-job-1',
      sourceSlug: 'test-shape',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    };
    mockPrisma.importJob.findMany.mockResolvedValue([stuckJob]);
    mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupStuckImportJobs(mockPrisma as never);

    expect(result.cleanedCount).toBe(1);
    expect(mockPrisma.importJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['stuck-job-1'] } },
      data: {
        status: 'failed',
        completedAt: expect.any(Date),
        errorMessage: 'Job timed out — worker may have restarted. You can retry the import.',
      },
    });
  });

  it('should query with correct threshold cutoff', async () => {
    mockPrisma.importJob.findMany.mockResolvedValue([]);

    // Use a custom threshold of 30 minutes
    await cleanupStuckImportJobs(mockPrisma as never, 30 * 60 * 1000);

    const findManyCall = mockPrisma.importJob.findMany.mock.calls[0][0];
    expect(findManyCall.where.status).toBe('in_progress');
    expect(findManyCall.where.startedAt.lt).toBeInstanceOf(Date);
  });

  it('should handle multiple stuck jobs in one batch', async () => {
    const stuckJobs = [
      { id: 'stuck-1', sourceSlug: 'shape-a', startedAt: new Date(Date.now() - 3600_000) },
      { id: 'stuck-2', sourceSlug: 'shape-b', startedAt: new Date(Date.now() - 7200_000) },
      { id: 'stuck-3', sourceSlug: 'shape-c', startedAt: new Date(Date.now() - 5400_000) },
    ];
    mockPrisma.importJob.findMany.mockResolvedValue(stuckJobs);
    mockPrisma.importJob.updateMany.mockResolvedValue({ count: 3 });

    const result = await cleanupStuckImportJobs(mockPrisma as never);

    expect(result.cleanedCount).toBe(3);
    expect(mockPrisma.importJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['stuck-1', 'stuck-2', 'stuck-3'] } },
      })
    );
  });

  it('should propagate database errors', async () => {
    mockPrisma.importJob.findMany.mockRejectedValue(new Error('DB connection lost'));

    await expect(cleanupStuckImportJobs(mockPrisma as never)).rejects.toThrow('DB connection lost');
  });
});
