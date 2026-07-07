import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { ExtractionTrigger } from './ExtractionTrigger.js';
import { JobType } from '@tzurot/common-types/constants/queue';
import { generateFactExtractionJobUuid } from '@tzurot/common-types/utils/deterministicUuid';

const CHANNEL = 'chan-1';
const PERSONALITY = '4f9b0f66-0000-4000-8000-0000000000aa';
const MEM = (n: number): string =>
  `4f9b0f66-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

interface Mocks {
  redis: Redis;
  queue: Queue;
  evalMock: ReturnType<typeof vi.fn>;
  lrangeMock: ReturnType<typeof vi.fn>;
  delMock: ReturnType<typeof vi.fn>;
  addMock: ReturnType<typeof vi.fn>;
}

function makeMocks(evalResult: number, pendingIds: string[]): Mocks {
  const evalMock = vi.fn().mockResolvedValue(evalResult);
  const lrangeMock = vi.fn().mockResolvedValue(pendingIds);
  const delMock = vi.fn().mockResolvedValue(1);
  const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });
  return {
    redis: { eval: evalMock, lrange: lrangeMock, del: delMock } as unknown as Redis,
    queue: { add: addMock } as unknown as Queue,
    evalMock,
    lrangeMock,
    delMock,
    addMock,
  };
}

describe('ExtractionTrigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('accumulates below threshold without enqueueing', async () => {
    const m = makeMocks(2, []);
    const trigger = new ExtractionTrigger(m.redis, m.queue, 6);

    await trigger.recordEpisode(CHANNEL, PERSONALITY, MEM(1));

    expect(m.evalMock).toHaveBeenCalledTimes(1);
    expect(m.addMock).not.toHaveBeenCalled();
    expect(m.delMock).not.toHaveBeenCalled();
  });

  it('enqueues the batch at threshold with a deterministic jobId and clears the list', async () => {
    const ids = [MEM(1), MEM(2), MEM(3), MEM(4), MEM(5), MEM(6)];
    const m = makeMocks(6, ids);
    const trigger = new ExtractionTrigger(m.redis, m.queue, 6);

    await trigger.recordEpisode(CHANNEL, PERSONALITY, MEM(6));

    const expectedJobId = generateFactExtractionJobUuid(CHANNEL, PERSONALITY, MEM(1));
    // Assert what crosses the queue seam: full payload + idempotent jobId.
    expect(m.addMock).toHaveBeenCalledWith(
      JobType.FactExtraction,
      expect.objectContaining({
        jobType: JobType.FactExtraction,
        channelId: CHANNEL,
        personalityId: PERSONALITY,
        sourceMemoryIds: ids,
        windowStart: MEM(1),
      }),
      expect.objectContaining({ jobId: expectedJobId })
    );
    expect(m.delMock).toHaveBeenCalledTimes(1);
  });

  it('re-enqueue after a crash produces the SAME jobId (idempotency anchor)', async () => {
    const ids = [MEM(1), MEM(2), MEM(3), MEM(4), MEM(5), MEM(6)];
    const first = makeMocks(6, ids);
    const t1 = new ExtractionTrigger(first.redis, first.queue, 6);
    await t1.recordEpisode(CHANNEL, PERSONALITY, MEM(6));

    // Crash before DEL: next episode sees count 7, list head unchanged.
    const second = makeMocks(7, [...ids, MEM(7)]);
    const t2 = new ExtractionTrigger(second.redis, second.queue, 6);
    await t2.recordEpisode(CHANNEL, PERSONALITY, MEM(7));

    const jobId1 = first.addMock.mock.calls[0][2].jobId as string;
    const jobId2 = second.addMock.mock.calls[0][2].jobId as string;
    expect(jobId1).toBe(jobId2);
  });

  it('skips cleanly when another process already flushed the batch', async () => {
    const m = makeMocks(6, []);
    const trigger = new ExtractionTrigger(m.redis, m.queue, 6);

    await trigger.recordEpisode(CHANNEL, PERSONALITY, MEM(6));

    expect(m.addMock).not.toHaveBeenCalled();
    expect(m.delMock).not.toHaveBeenCalled();
  });

  it('never throws — Redis failure degrades to a warn', async () => {
    const evalMock = vi.fn().mockRejectedValue(new Error('redis down'));
    const redis = { eval: evalMock, lrange: vi.fn(), del: vi.fn() } as unknown as Redis;
    const queue = { add: vi.fn() } as unknown as Queue;
    const trigger = new ExtractionTrigger(redis, queue, 6);

    await expect(trigger.recordEpisode(CHANNEL, PERSONALITY, MEM(1))).resolves.toBeUndefined();
  });

  it('never throws — queue failure after threshold degrades to a warn (no DEL, batch retries)', async () => {
    const ids = [MEM(1), MEM(2), MEM(3), MEM(4), MEM(5), MEM(6)];
    const m = makeMocks(6, ids);
    vi.mocked(m.queue.add).mockRejectedValue(new Error('queue down'));
    const trigger = new ExtractionTrigger(m.redis, m.queue, 6);

    await expect(trigger.recordEpisode(CHANNEL, PERSONALITY, MEM(6))).resolves.toBeUndefined();
    // The list must NOT be cleared when the enqueue failed — the next episode retries.
    expect(m.delMock).not.toHaveBeenCalled();
  });
});
