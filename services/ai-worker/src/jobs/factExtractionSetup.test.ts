import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { JobType } from '@tzurot/common-types/constants/queue';
import { ExtractionProviderBusyError } from '../services/extraction/FactExtractionService.js';

const {
  addMock,
  queueCloseMock,
  workerCloseMock,
  getConfigMock,
  processBatchMock,
  rateLimitMock,
  rateLimitErrorSentinel,
  loggerErrorMock,
} = vi.hoisted(() => ({
  addMock: vi.fn(),
  queueCloseMock: vi.fn(),
  workerCloseMock: vi.fn(),
  getConfigMock: vi.fn(),
  processBatchMock: vi.fn().mockResolvedValue(2),
  rateLimitMock: vi.fn().mockResolvedValue(undefined),
  rateLimitErrorSentinel: new Error('bullmq-rate-limit'),
  loggerErrorMock: vi.fn(),
}));
let capturedProcessor: ((job: { id: string; data: unknown }) => Promise<unknown>) | undefined;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: addMock, close: queueCloseMock };
  }),
  Worker: Object.assign(
    vi.fn().mockImplementation(function (_name: string, processor: typeof capturedProcessor) {
      capturedProcessor = processor;
      return { on: vi.fn(), close: workerCloseMock, rateLimit: rateLimitMock };
    }),
    // BullMQ's static sentinel: throwing it after worker.rateLimit() requeues
    // the job without consuming an attempt.
    { RateLimitError: () => rateLimitErrorSentinel }
  ),
}));

vi.mock('../services/extraction/FactExtractionService.js', async importOriginal => ({
  // Keep the REAL ExtractionProviderBusyError so the worker's instanceof works.
  ...(await importOriginal<typeof import('../services/extraction/FactExtractionService.js')>()),
  FactExtractionService: vi.fn().mockImplementation(function () {
    return { processBatch: processBatchMock };
  }),
}));

vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return { ...actual, getConfig: (): unknown => getConfigMock() };
});

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
    debug: vi.fn(),
  }),
}));

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

  it('logs loudly (but still boots) when zai-coding is configured without the system key', () => {
    getConfigMock.mockReturnValue({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_BATCH_THRESHOLD: 6,
      EXTRACTION_PROVIDER: 'zai-coding',
      ZAI_CODING_API_KEY: undefined,
    });

    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    expect(assembly).toBeDefined(); // fail-loud-but-SOFT: misconfig must not kill worker boot
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('falls back to OpenRouter')
    );
  });

  it('logs loudly when zai-coding is keyed but EXTRACTION_MODEL is not a coding-plan model', () => {
    getConfigMock.mockReturnValue({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_BATCH_THRESHOLD: 6,
      EXTRACTION_PROVIDER: 'zai-coding',
      ZAI_CODING_API_KEY: 'zai-key',
      EXTRACTION_MODEL: 'anthropic/claude-haiku-4.5', // not servable by z.ai — would 4xx every call
    });

    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    expect(assembly).toBeDefined();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5' }),
      expect.stringContaining('not on the z.ai coding-plan catalog')
    );
  });

  it('stays quiet when zai-coding is keyed with a plan model (prefixed form accepted)', () => {
    getConfigMock.mockReturnValue({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_BATCH_THRESHOLD: 6,
      EXTRACTION_PROVIDER: 'zai-coding',
      ZAI_CODING_API_KEY: 'zai-key',
      EXTRACTION_MODEL: 'z-ai/glm-5.2',
    });

    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    expect(loggerErrorMock).not.toHaveBeenCalled();
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

describe('delay-not-downgrade (provider busy at the BullMQ seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedProcessor = undefined;
    getConfigMock.mockReturnValue({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_BATCH_THRESHOLD: 6,
      EXTRACTION_DAILY_LIMIT: 100,
      EXTRACTION_PROVIDER: 'openrouter',
      ZAI_CODING_API_KEY: undefined,
    });
  });

  const busyJob = {
    requestId: 'req-busy',
    jobType: JobType.FactExtraction,
    responseDestination: { type: 'api' },
    version: 1,
    channelId: 'chan-1',
    personalityId: '4f9b0f66-0000-4000-8000-0000000000aa',
    sourceMemoryIds: [
      '4f9b0f66-0000-4000-8000-000000000001',
      '4f9b0f66-0000-4000-8000-000000000002',
    ],
    windowStart: '4f9b0f66-0000-4000-8000-000000000001',
  };

  it('busy error → shrinks the requeued payload, pauses the queue, throws the no-attempt sentinel', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    const remaining = ['4f9b0f66-0000-4000-8000-000000000002'];
    processBatchMock.mockRejectedValueOnce(
      new ExtractionProviderBusyError('rate_limit', new Error('429'), remaining)
    );
    const updateData = vi.fn().mockResolvedValue(undefined);

    await expect(
      capturedProcessor?.({ id: 'j-busy', data: busyJob, updateData } as never)
    ).rejects.toBe(rateLimitErrorSentinel);

    // Completed groups never re-run: the requeued job carries ONLY the
    // unfinished episode ids.
    expect(updateData).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMemoryIds: remaining })
    );
    expect(rateLimitMock).toHaveBeenCalledWith(30 * 60 * 1000);
  });

  it('a sustained busy loop escalates to logger.error past the threshold (stuck-key visibility)', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    processBatchMock.mockRejectedValue(
      new ExtractionProviderBusyError('quota_exceeded', new Error('402'), [])
    );
    const updateData = vi.fn();

    for (let cycle = 1; cycle <= 12; cycle++) {
      await expect(
        capturedProcessor?.({ id: `j-${cycle}`, data: busyJob, updateData } as never)
      ).rejects.toBe(rateLimitErrorSentinel);
      if (cycle < 12) {
        expect(loggerErrorMock).not.toHaveBeenCalled(); // ordinary peak-window delay stays at info
      }
    }

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveBusyCycles: 12, category: 'quota_exceeded' }),
      expect.stringContaining('human attention')
    );
  });

  it('a successful batch RESETS the consecutive-busy counter', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    const updateData = vi.fn();
    const busyOnce = (): void => {
      processBatchMock.mockRejectedValueOnce(
        new ExtractionProviderBusyError('rate_limit', new Error('429'), [])
      );
    };

    for (let i = 0; i < 11; i++) {
      busyOnce();
      await expect(
        capturedProcessor?.({ id: `j-${i}`, data: busyJob, updateData } as never)
      ).rejects.toBe(rateLimitErrorSentinel);
    }
    processBatchMock.mockResolvedValueOnce(1); // success resets the streak
    await capturedProcessor?.({ id: 'j-ok', data: busyJob, updateData } as never);
    busyOnce();
    await expect(
      capturedProcessor?.({ id: 'j-after', data: busyJob, updateData } as never)
    ).rejects.toBe(rateLimitErrorSentinel);

    expect(loggerErrorMock).not.toHaveBeenCalled(); // streak never reached 12 consecutively
  });

  it('non-busy errors propagate untouched (BullMQ attempt-based retry applies)', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    processBatchMock.mockRejectedValueOnce(new Error('db exploded'));
    const updateData = vi.fn();

    await expect(
      capturedProcessor?.({ id: 'j-err', data: busyJob, updateData } as never)
    ).rejects.toThrow('db exploded');

    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(updateData).not.toHaveBeenCalled();
  });
});
