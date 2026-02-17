/**
 * Tests for createStuckJobCleanup factory
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStuckJobCleanup } from './cleanupStuckJobs.js';

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

function createMockConfig() {
  return {
    loggerName: 'test-cleanup',
    logPrefix: '[TestCleanup]',
    jobIdLogField: 'testJobId',
    errorMessage: 'Test error message',
    findStuckJobs: vi.fn().mockResolvedValue([]),
    markJobsFailed: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

describe('createStuckJobCleanup', () => {
  let mockConfig: ReturnType<typeof createMockConfig>;
  let cleanup: ReturnType<typeof createStuckJobCleanup>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = createMockConfig();
    mockConfig.findStuckJobs.mockResolvedValue([]);
    mockConfig.markJobsFailed.mockResolvedValue({ count: 0 });
    cleanup = createStuckJobCleanup(mockConfig);
  });

  it('should return zero when no stuck jobs exist', async () => {
    const result = await cleanup({} as never);

    expect(result.cleanedCount).toBe(0);
    expect(mockConfig.markJobsFailed).not.toHaveBeenCalled();
  });

  it('should find and mark stuck jobs as failed', async () => {
    const stuckJob = { id: 'job-1', sourceSlug: 'test-shape', startedAt: new Date() };
    mockConfig.findStuckJobs.mockResolvedValue([stuckJob]);
    mockConfig.markJobsFailed.mockResolvedValue({ count: 1 });

    const result = await cleanup({} as never);

    expect(result.cleanedCount).toBe(1);
    expect(mockConfig.markJobsFailed).toHaveBeenCalledWith(
      expect.anything(),
      ['job-1'],
      'Test error message'
    );
  });

  it('should pass cutoff date based on threshold', async () => {
    const customThreshold = 30 * 60 * 1000; // 30 minutes
    await cleanup({} as never, customThreshold);

    const cutoff = mockConfig.findStuckJobs.mock.calls[0][1] as Date;
    expect(cutoff).toBeInstanceOf(Date);
    const expectedCutoff = Date.now() - customThreshold;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(1000);
  });

  it('should handle multiple stuck jobs in one batch', async () => {
    const jobs = [
      { id: 'a', sourceSlug: 'shape-a', startedAt: new Date() },
      { id: 'b', sourceSlug: 'shape-b', startedAt: new Date() },
      { id: 'c', sourceSlug: 'shape-c', startedAt: null },
    ];
    mockConfig.findStuckJobs.mockResolvedValue(jobs);
    mockConfig.markJobsFailed.mockResolvedValue({ count: 3 });

    const result = await cleanup({} as never);

    expect(result.cleanedCount).toBe(3);
    expect(mockConfig.markJobsFailed).toHaveBeenCalledWith(
      expect.anything(),
      ['a', 'b', 'c'],
      'Test error message'
    );
  });

  it('should propagate errors from findStuckJobs', async () => {
    mockConfig.findStuckJobs.mockRejectedValue(new Error('DB connection lost'));

    await expect(cleanup({} as never)).rejects.toThrow('DB connection lost');
  });

  it('should propagate errors from markJobsFailed', async () => {
    mockConfig.findStuckJobs.mockResolvedValue([{ id: 'j', sourceSlug: 's', startedAt: null }]);
    mockConfig.markJobsFailed.mockRejectedValue(new Error('Update failed'));

    await expect(cleanup({} as never)).rejects.toThrow('Update failed');
  });

  it('should include durationMs in result', async () => {
    const result = await cleanup({} as never);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe('number');
  });
});
