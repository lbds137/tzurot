import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { BullMQRedisConfig } from '@tzurot/common-types/utils/redis';

const setupFactExtractionMock = vi.hoisted(() => vi.fn());
const setupArchiveSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('./factExtractionSetup.js', () => ({ setupFactExtraction: setupFactExtractionMock }));
vi.mock('./archiveSummarySetup.js', () => ({ setupArchiveSummary: setupArchiveSummaryMock }));

const { setupBackgroundQueues, disposeBackgroundQueues } = await import('./backgroundQueues.js');

describe('setupBackgroundQueues', () => {
  it('constructs both assemblies and returns them', () => {
    const factExtraction = { queue: {}, worker: {}, trigger: {} };
    const archiveSummary = { queue: {}, worker: {}, trigger: {} };
    setupFactExtractionMock.mockReturnValue(factExtraction);
    setupArchiveSummaryMock.mockReturnValue(archiveSummary);

    const result = setupBackgroundQueues(
      {} as PrismaClient,
      {} as Redis,
      {} as BullMQRedisConfig,
      undefined
    );

    expect(result).toEqual({ factExtraction, archiveSummary });
  });
});

describe('disposeBackgroundQueues', () => {
  it('closes both assemblies when fact extraction is present', async () => {
    const factWorkerClose = vi.fn().mockResolvedValue(undefined);
    const factQueueClose = vi.fn().mockResolvedValue(undefined);
    const archiveWorkerClose = vi.fn().mockResolvedValue(undefined);
    const archiveQueueClose = vi.fn().mockResolvedValue(undefined);

    await disposeBackgroundQueues({
      factExtraction: {
        queue: { close: factQueueClose },
        worker: { close: factWorkerClose },
        trigger: {},
      } as never,
      archiveSummary: {
        queue: { close: archiveQueueClose },
        worker: { close: archiveWorkerClose },
        trigger: {},
      } as never,
    });

    expect(factWorkerClose).toHaveBeenCalledTimes(1);
    expect(factQueueClose).toHaveBeenCalledTimes(1);
    expect(archiveWorkerClose).toHaveBeenCalledTimes(1);
    expect(archiveQueueClose).toHaveBeenCalledTimes(1);
  });

  it('skips fact-extraction close when undefined', async () => {
    const archiveWorkerClose = vi.fn().mockResolvedValue(undefined);
    const archiveQueueClose = vi.fn().mockResolvedValue(undefined);

    await expect(
      disposeBackgroundQueues({
        factExtraction: undefined,
        archiveSummary: {
          queue: { close: archiveQueueClose },
          worker: { close: archiveWorkerClose },
          trigger: {},
        } as never,
      })
    ).resolves.toBeUndefined();

    expect(archiveWorkerClose).toHaveBeenCalledTimes(1);
  });
});
