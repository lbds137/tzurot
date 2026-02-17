/**
 * Tests for ShapesExportJob
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ShapesExportJobData, ShapesDataFetchResult } from '@tzurot/common-types';
import { processShapesExportJob } from './ShapesExportJob.js';

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
    decryptApiKey: vi.fn().mockReturnValue('appSession.0=abc'),
    encryptApiKey: vi
      .fn()
      .mockReturnValue({ iv: 'new-iv', content: 'new-content', tag: 'new-tag' }),
  };
});

// Mock ShapesDataFetcher
const { mockFetchShapeData, mockGetUpdatedCookie } = vi.hoisted(() => ({
  mockFetchShapeData: vi.fn(),
  mockGetUpdatedCookie: vi.fn().mockReturnValue('updated-cookie'),
}));
vi.mock('../services/shapes/ShapesDataFetcher.js', () => ({
  ShapesDataFetcher: vi.fn().mockImplementation(function () {
    return { fetchShapeData: mockFetchShapeData, getUpdatedCookie: mockGetUpdatedCookie };
  }),
  ShapesAuthError: class ShapesAuthError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ShapesAuthError';
    }
  },
  ShapesNotFoundError: class ShapesNotFoundError extends Error {
    constructor(slug: string) {
      super(`Shape not found: ${slug}`);
      this.name = 'ShapesNotFoundError';
    }
  },
  ShapesRateLimitError: class ShapesRateLimitError extends Error {
    constructor() {
      super('Rate limited');
      this.name = 'ShapesRateLimitError';
    }
  },
}));

// Mock formatters
vi.mock('./ShapesExportFormatters.js', () => ({
  formatExportAsMarkdown: vi.fn().mockReturnValue('# Export markdown content'),
  formatExportAsJson: vi.fn().mockReturnValue('{"exported": true}'),
}));

const mockPrisma = {
  exportJob: {
    update: vi.fn().mockResolvedValue({}),
  },
  userCredential: {
    findFirst: vi.fn().mockResolvedValue({
      iv: 'iv',
      content: 'content',
      tag: 'tag',
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
};

function createMockJob(
  overrides: Partial<ShapesExportJobData> = {},
  jobOpts: { attemptsMade?: number; attempts?: number } = {}
): Job<ShapesExportJobData> {
  return {
    id: 'test-job-id',
    attemptsMade: jobOpts.attemptsMade ?? 0,
    opts: { attempts: jobOpts.attempts ?? 3 },
    data: {
      userId: 'user-uuid-123',
      sourceSlug: 'test-shape',
      exportJobId: 'export-job-uuid-123',
      format: 'json',
      ...overrides,
    },
  } as Job<ShapesExportJobData>;
}

const mockFetchResult: ShapesDataFetchResult = {
  config: {
    id: 'shape-id',
    name: 'Test Shape',
    username: 'test-shape',
    avatar: '',
    jailbreak: 'system prompt',
    user_prompt: 'user prompt',
    personality_traits: 'traits',
    engine_model: 'gpt-4o',
    engine_temperature: 0.7,
    stm_window: 20,
    ltm_enabled: true,
    ltm_threshold: 0.3,
    ltm_max_retrieved_summaries: 5,
  },
  memories: [
    {
      id: 'mem-1',
      shape_id: 'shape-id',
      senders: ['user1'],
      result: 'A conversation summary',
      metadata: { start_ts: 1000, end_ts: 2000, created_at: 1700000000, senders: ['user1'] },
    },
  ],
  stories: [],
  userPersonalization: null,
  stats: { memoriesCount: 1, storiesCount: 0, pagesTraversed: 1 },
};

describe('ShapesExportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchShapeData.mockResolvedValue(mockFetchResult);
  });

  it('should complete a JSON export successfully', async () => {
    const job = createMockJob();
    const result = await processShapesExportJob(job, { prisma: mockPrisma as never });

    expect(result.success).toBe(true);
    expect(result.memoriesCount).toBe(1);
    expect(result.storiesCount).toBe(0);
    expect(result.fileSizeBytes).toBeGreaterThan(0);

    // Should have marked in_progress then completed
    expect(mockPrisma.exportJob.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_progress' }),
      })
    );
    expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'completed',
          fileContent: expect.any(String),
          fileName: 'test-shape-export.json',
        }),
      })
    );
  });

  it('should use markdown formatter when format is markdown', async () => {
    const job = createMockJob({ format: 'markdown' });
    const result = await processShapesExportJob(job, { prisma: mockPrisma as never });

    expect(result.success).toBe(true);

    expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: 'test-shape-export.md',
        }),
      })
    );
  });

  it('should mark job as failed when no credentials found', async () => {
    mockPrisma.userCredential.findFirst.mockResolvedValueOnce(null);

    const job = createMockJob();
    const result = await processShapesExportJob(job, { prisma: mockPrisma as never });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No shapes.inc credentials');

    expect(mockPrisma.exportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('should re-throw rate-limit errors for BullMQ retry when attempts remain', async () => {
    const { ShapesRateLimitError } = await import('../services/shapes/ShapesDataFetcher.js');
    mockFetchShapeData.mockRejectedValueOnce(new ShapesRateLimitError());

    // attemptsMade=0, attempts=3 → 2 retries remain
    const job = createMockJob({}, { attemptsMade: 0, attempts: 3 });
    await expect(processShapesExportJob(job, { prisma: mockPrisma as never })).rejects.toThrow(
      'Rate limited'
    );

    // Should mark in_progress but NOT failed (BullMQ will retry)
    const updateCalls = mockPrisma.exportJob.update.mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0].data.status).toBe('in_progress');
  });

  it('should mark as failed on final rate-limit attempt to avoid stuck in_progress', async () => {
    const { ShapesRateLimitError } = await import('../services/shapes/ShapesDataFetcher.js');
    mockFetchShapeData.mockRejectedValueOnce(new ShapesRateLimitError());

    // attemptsMade=2, attempts=3 → last attempt, no retries left
    const job = createMockJob({}, { attemptsMade: 2, attempts: 3 });
    const result = await processShapesExportJob(job, { prisma: mockPrisma as never });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Rate limited');

    // Should mark in_progress first, then failed
    const updateCalls = mockPrisma.exportJob.update.mock.calls;
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][0].data.status).toBe('in_progress');
    expect(updateCalls[1][0].data.status).toBe('failed');
  });

  it('should persist updated cookie after fetch', async () => {
    const job = createMockJob();
    await processShapesExportJob(job, { prisma: mockPrisma as never });

    expect(mockPrisma.userCredential.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          iv: 'new-iv',
          content: 'new-content',
          tag: 'new-tag',
        }),
      })
    );
  });
});
