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
  workerOnHandlers,
  getConfigMock,
  systemSettingsFixture,
  processBatchMock,
  loggerErrorMock,
  loggerWarnMock,
  MockDelayedError,
} = vi.hoisted(() => ({
  addMock: vi.fn(),
  queueCloseMock: vi.fn(),
  workerCloseMock: vi.fn(),
  /** Event handlers the worker registers via .on(), keyed by event name. */
  workerOnHandlers: new Map<string, (...args: never[]) => unknown>(),
  getConfigMock: vi.fn(),
  /** Per-test overrides for getSystemSetting reads (fallbacks otherwise). */
  systemSettingsFixture: new Map<string, unknown>(),
  processBatchMock: vi.fn().mockResolvedValue(2),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  MockDelayedError: class MockDelayedError extends Error {},
}));
let capturedProcessor:
  ((job: { id: string; data: unknown }, token?: string) => Promise<unknown>) | undefined;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: addMock, close: queueCloseMock };
  }),
  Worker: vi.fn().mockImplementation(function (_name: string, processor: typeof capturedProcessor) {
    capturedProcessor = processor;
    return {
      on: vi.fn((event: string, cb: (...args: never[]) => unknown) => {
        workerOnHandlers.set(event, cb);
      }),
      close: workerCloseMock,
    };
  }),
  // The worker throws `new DelayedError()` after job.moveToDelayed — BullMQ's
  // documented per-job manual-delay pattern (no retry attempt consumed).
  DelayedError: MockDelayedError,
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

vi.mock('@tzurot/common-types/services/SystemSettingsService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@tzurot/common-types/services/SystemSettingsService')>();
  return {
    ...actual,
    getSystemSetting: (key: string): unknown =>
      systemSettingsFixture.has(key)
        ? systemSettingsFixture.get(key)
        : actual.getSystemSetting(key as never),
  };
});

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: loggerWarnMock,
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
    workerOnHandlers.clear();
    systemSettingsFixture.clear();
    getConfigMock.mockReturnValue({ EXTRACTION_DAILY_LIMIT: 100, ZAI_CODING_API_KEY: undefined });
  });

  it('constructs the assembly even with the runtime kill switch off (flip needs no restart)', () => {
    systemSettingsFixture.set('extractionEnabled', false);
    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    expect(assembly).toBeDefined();
    expect(assembly?.trigger).toBeDefined();
  });

  it('returns undefined when the embedding service is unavailable (infra precondition)', () => {
    expect(setupFactExtraction(prisma, redis, bullmqConnection, undefined)).toBeUndefined();
  });

  it('constructs the full assembly', () => {
    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    expect(assembly).toBeDefined();
    expect(assembly?.trigger).toBeDefined();
    expect(capturedProcessor).toBeDefined();
  });

  it('logs a stalled event at warn with the jobId — the deploy-orphan recovery trail', () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    const stalled = workerOnHandlers.get('stalled');
    expect(stalled).toBeDefined();
    (stalled as (jobId: string) => void)('job-42');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { jobId: 'job-42' },
      expect.stringContaining('stalled')
    );
  });

  it('logs a failed event at warn with the jobId and error', () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    const failed = workerOnHandlers.get('failed');
    expect(failed).toBeDefined();
    const err = new Error('boom');
    (failed as (job: { id: string } | undefined, err: Error) => void)({ id: 'job-7' }, err);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { jobId: 'job-7', err },
      expect.stringContaining('failed')
    );
  });

  it('logs loudly (but still boots) when zai-coding is configured without the system key', () => {
    systemSettingsFixture.set('extractionProvider', 'zai-coding');
    getConfigMock.mockReturnValue({ ZAI_CODING_API_KEY: undefined });

    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    expect(assembly).toBeDefined(); // fail-loud-but-SOFT: misconfig must not kill worker boot
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('falls back to OpenRouter')
    );
  });

  it('logs loudly when zai-coding is keyed but the extraction model is not a coding-plan model', () => {
    systemSettingsFixture.set('extractionProvider', 'zai-coding');
    systemSettingsFixture.set('extractionModel', 'anthropic/claude-haiku-4.5'); // not servable by z.ai — would 4xx every call
    getConfigMock.mockReturnValue({ ZAI_CODING_API_KEY: 'zai-key' });

    const assembly = setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    expect(assembly).toBeDefined();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5' }),
      expect.stringContaining('not on the z.ai coding-plan catalog')
    );
  });

  it('stays quiet when zai-coding is keyed with a plan model (prefixed form accepted)', () => {
    systemSettingsFixture.set('extractionProvider', 'zai-coding');
    systemSettingsFixture.set('extractionModel', 'z-ai/glm-5.2');
    getConfigMock.mockReturnValue({ ZAI_CODING_API_KEY: 'zai-key' });

    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('worker handler fail-to-skips a malformed payload without calling the service', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);

    const result = await capturedProcessor?.({ id: 'j1', data: { nonsense: true } });

    expect(result).toEqual({ written: 0 });
    expect(processBatchMock).not.toHaveBeenCalled();
  });

  it('worker handler processes a valid payload through the service', async () => {
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
    workerOnHandlers.clear();
    systemSettingsFixture.clear();
    getConfigMock.mockReturnValue({ EXTRACTION_DAILY_LIMIT: 100, ZAI_CODING_API_KEY: undefined });
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

  it('busy error → shrinks payload, tracks busyCycles, moves THIS job to delayed (no attempt consumed)', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    const remaining = ['4f9b0f66-0000-4000-8000-000000000002'];
    processBatchMock.mockRejectedValueOnce(
      new ExtractionProviderBusyError('rate_limit', new Error('429'), remaining)
    );
    const updateData = vi.fn().mockResolvedValue(undefined);
    const moveToDelayed = vi.fn().mockResolvedValue(undefined);
    const before = Date.now();

    await expect(
      capturedProcessor?.(
        { id: 'j-busy', data: busyJob, updateData, moveToDelayed } as never,
        'tok-1'
      )
    ).rejects.toBeInstanceOf(MockDelayedError);

    // Completed groups never re-run: the requeued job carries ONLY the
    // unfinished episode ids, plus the busy-cycle count for the poison cap.
    expect(updateData).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMemoryIds: remaining, busyCycles: 1 })
    );
    // Per-job delay ~30 min out, with the worker's lock token — the whole-queue
    // rateLimit pause is deprecated and was a runtime no-op.
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok-1');
    const delayedUntil = moveToDelayed.mock.calls[0][0] as number;
    expect(delayedUntil).toBeGreaterThanOrEqual(before + 30 * 60 * 1000 - 1000);
  });

  it('past the busy-cycle cap the batch is SKIPPED, not delayed again (poison-batch ejection)', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    processBatchMock.mockRejectedValueOnce(
      new ExtractionProviderBusyError('timeout', new Error('timeout'), [])
    );
    const updateData = vi.fn();
    const moveToDelayed = vi.fn();

    const result = await capturedProcessor?.(
      { id: 'j-poison', data: { ...busyJob, busyCycles: 48 }, updateData, moveToDelayed } as never,
      'tok-p'
    );

    expect(result).toEqual({ written: 0 }); // fail-to-skip: episodes stay uncovered for a re-run
    expect(moveToDelayed).not.toHaveBeenCalled();
    expect(updateData).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ busyCycles: 49 }),
      expect.stringContaining('busy-cycle cap')
    );
  });

  it('a sustained busy loop escalates to logger.error past the threshold (stuck-key visibility)', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    processBatchMock.mockRejectedValue(
      new ExtractionProviderBusyError('quota_exceeded', new Error('402'), [])
    );
    const updateData = vi.fn();

    const moveToDelayed = vi.fn().mockResolvedValue(undefined);
    for (let cycle = 1; cycle <= 12; cycle++) {
      await expect(
        capturedProcessor?.({ id: `j-${cycle}`, data: busyJob, updateData, moveToDelayed } as never)
      ).rejects.toBeInstanceOf(MockDelayedError);
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
    const moveToDelayed = vi.fn().mockResolvedValue(undefined);
    const busyOnce = (): void => {
      processBatchMock.mockRejectedValueOnce(
        new ExtractionProviderBusyError('rate_limit', new Error('429'), [])
      );
    };

    for (let i = 0; i < 11; i++) {
      busyOnce();
      await expect(
        capturedProcessor?.({ id: `j-${i}`, data: busyJob, updateData, moveToDelayed } as never)
      ).rejects.toBeInstanceOf(MockDelayedError);
    }
    processBatchMock.mockResolvedValueOnce(1); // success resets the streak
    await capturedProcessor?.({ id: 'j-ok', data: busyJob, updateData, moveToDelayed } as never);
    busyOnce();
    await expect(
      capturedProcessor?.({ id: 'j-after', data: busyJob, updateData, moveToDelayed } as never)
    ).rejects.toBeInstanceOf(MockDelayedError);

    expect(loggerErrorMock).not.toHaveBeenCalled(); // streak never reached 12 consecutively
  });

  it('non-busy errors propagate untouched (BullMQ attempt-based retry applies)', async () => {
    setupFactExtraction(prisma, redis, bullmqConnection, embeddings);
    processBatchMock.mockRejectedValueOnce(new Error('db exploded'));
    const updateData = vi.fn();

    const moveToDelayed = vi.fn();
    await expect(
      capturedProcessor?.({ id: 'j-err', data: busyJob, updateData, moveToDelayed } as never)
    ).rejects.toThrow('db exploded');

    expect(moveToDelayed).not.toHaveBeenCalled();
    expect(updateData).not.toHaveBeenCalled();
  });
});
