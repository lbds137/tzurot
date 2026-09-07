import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { BullMQRedisConfig } from '@tzurot/common-types/utils/redis';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';

const { addMock, queueCloseMock, workerCloseMock, workerOnHandlers, capturedOptions } = vi.hoisted(
  () => ({
    addMock: vi.fn(),
    queueCloseMock: vi.fn(),
    workerCloseMock: vi.fn(),
    workerOnHandlers: new Map<string, (...args: never[]) => unknown>(),
    capturedOptions: { current: undefined as unknown },
  })
);
let capturedProcessor:
  ((job: { id: string; data: unknown }, token?: string) => Promise<unknown>) | undefined;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return { add: addMock, close: queueCloseMock };
  }),
  Worker: vi.fn().mockImplementation(function (
    _name: string,
    processor: typeof capturedProcessor,
    options: unknown
  ) {
    capturedProcessor = processor;
    capturedOptions.current = options;
    return {
      on: vi.fn((event: string, cb: (...args: never[]) => unknown) => {
        workerOnHandlers.set(event, cb);
      }),
      close: workerCloseMock,
    };
  }),
  DelayedError: class MockDelayedError extends Error {},
}));

const processMock = vi.fn();
vi.mock('../services/archiveSummary/ArchiveSummaryProcessor.js', () => ({
  ArchiveSummaryProcessor: vi.fn().mockImplementation(function () {
    return { process: processMock };
  }),
}));

const { setupArchiveSummary } = await import('./archiveSummarySetup.js');

function fixtures(): Record<string, unknown> {
  return {
    archiveSummaryEnqueueEnabled: true,
    archiveSummaryModelEnabled: true,
    archiveSummaryDailyCap: 2000,
  };
}

describe('setupArchiveSummary', () => {
  it('constructs the queue/worker with the documented options', () => {
    registerSystemSettings({
      get: (key: string) => fixtures()[key],
    } as unknown as SystemSettingsService);
    setupArchiveSummary({} as PrismaClient, {} as Redis, {} as BullMQRedisConfig);

    const options = capturedOptions.current as {
      concurrency: number;
      maxStalledCount: number;
      limiter: { max: number; duration: number };
    };
    expect(options.concurrency).toBe(1);
    expect(options.maxStalledCount).toBe(1);
    expect(options.limiter).toEqual({ max: 10, duration: 60_000 });
    resetSystemSettingsRegistration();
  });

  it('constructs the trigger with the enqueue-switch supplier', async () => {
    registerSystemSettings({
      get: (key: string) => fixtures()[key],
    } as unknown as SystemSettingsService);
    const assembly = setupArchiveSummary({} as PrismaClient, {} as Redis, {} as BullMQRedisConfig);

    const enabled = (assembly.trigger as any).enabled as () => boolean;
    expect(enabled()).toBe(true);
    resetSystemSettingsRegistration();
  });

  it('skips a malformed payload without calling the processor', async () => {
    registerSystemSettings({
      get: (key: string) => fixtures()[key],
    } as unknown as SystemSettingsService);
    setupArchiveSummary({} as PrismaClient, {} as Redis, {} as BullMQRedisConfig);

    const result = await capturedProcessor?.({ id: 'j1', data: { bogus: true } }, 'tok');

    expect(result).toBeUndefined();
    expect(processMock).not.toHaveBeenCalled();
    resetSystemSettingsRegistration();
  });

  it('lets a DelayedError propagate untouched from the handler', async () => {
    registerSystemSettings({
      get: (key: string) => fixtures()[key],
    } as unknown as SystemSettingsService);
    setupArchiveSummary({} as PrismaClient, {} as Redis, {} as BullMQRedisConfig);
    const { DelayedError } = await import('bullmq');
    processMock.mockRejectedValueOnce(new DelayedError());

    const validPayload = {
      requestId: 'r',
      jobType: JobType.ArchiveSummary,
      responseDestination: { type: 'api' },
      version: 1,
      memoryId: '4f9b0f66-6666-4000-8000-00000000000a',
      personalityId: '4f9b0f66-6666-4000-8000-00000000000b',
      reason: 'write',
    };

    await expect(capturedProcessor?.({ id: 'j2', data: validPayload }, 'tok')).rejects.toThrow();
    resetSystemSettingsRegistration();
  });
});
