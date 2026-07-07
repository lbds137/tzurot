import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { JobType } from '@tzurot/common-types/constants/queue';

const { addMock, queueCloseMock, workerCloseMock, getConfigMock, processBatchMock } = vi.hoisted(
  () => ({
    addMock: vi.fn(),
    queueCloseMock: vi.fn(),
    workerCloseMock: vi.fn(),
    getConfigMock: vi.fn(),
    processBatchMock: vi.fn().mockResolvedValue(2),
  })
);
let capturedProcessor: ((job: { id: string; data: unknown }) => Promise<unknown>) | undefined;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: addMock, close: queueCloseMock };
  }),
  Worker: vi.fn().mockImplementation(function (_name: string, processor: typeof capturedProcessor) {
    capturedProcessor = processor;
    return { on: vi.fn(), close: workerCloseMock };
  }),
}));

vi.mock('../services/extraction/FactExtractionService.js', () => ({
  FactExtractionService: vi.fn().mockImplementation(function () {
    return { processBatch: processBatchMock };
  }),
}));

vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return { ...actual, getConfig: (): unknown => getConfigMock() };
});

import { setupFactExtraction } from './factExtractionSetup.js';

const prisma = {} as PrismaClient;
const redis = {} as Redis;
const bullmqConnection = { host: 'localhost', port: 6379 } as never;
const embeddings = {} as LocalEmbeddingService;

describe('setupFactExtraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = undefined;
  });

  it('returns undefined when the kill switch is off (default)', () => {
    getConfigMock.mockReturnValue({ EXTRACTION_ENABLED: undefined, EXTRACTION_BATCH_THRESHOLD: 6 });
    expect(setupFactExtraction(prisma, redis, bullmqConnection, embeddings)).toBeUndefined();
  });

  it('returns undefined when enabled but the embedding service is unavailable', () => {
    getConfigMock.mockReturnValue({ EXTRACTION_ENABLED: 'true', EXTRACTION_BATCH_THRESHOLD: 6 });
    expect(setupFactExtraction(prisma, redis, bullmqConnection, undefined)).toBeUndefined();
  });

  it('constructs the full assembly when enabled', () => {
    getConfigMock.mockReturnValue({ EXTRACTION_ENABLED: 'true', EXTRACTION_BATCH_THRESHOLD: 6 });
    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    expect(assembly).toBeDefined();
    expect(assembly?.trigger).toBeDefined();
    expect(capturedProcessor).toBeDefined();
  });

  it('worker handler fail-to-skips a malformed payload without calling the service', async () => {
    getConfigMock.mockReturnValue({ EXTRACTION_ENABLED: 'true', EXTRACTION_BATCH_THRESHOLD: 6 });
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    const result = await capturedProcessor?.({ id: 'j1', data: { nonsense: true } });

    expect(result).toEqual({ written: 0 });
    expect(processBatchMock).not.toHaveBeenCalled();
  });

  it('worker handler processes a valid payload through the service', async () => {
    getConfigMock.mockReturnValue({ EXTRACTION_ENABLED: 'true', EXTRACTION_BATCH_THRESHOLD: 6 });
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    const validJob = {
      requestId: 'req-1',
      jobType: JobType.FactExtraction,
      responseDestination: { type: 'api' },
      version: 1,
      channelId: 'chan-1',
      personalityId: '4f9b0f66-0000-4000-8000-0000000000aa',
      sourceMemoryIds: ['4f9b0f66-0000-4000-8000-000000000001'],
      windowStart: '4f9b0f66-0000-4000-8000-000000000001',
    };

    const result = await capturedProcessor?.({ id: 'j2', data: validJob });

    expect(processBatchMock).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'chan-1' }));
    expect(result).toEqual({ written: 2 });
  });
});
