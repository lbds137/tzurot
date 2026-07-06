import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { MAINTENANCE_FLAG_KEY } from '@tzurot/common-types/constants/redis-keys';
import { SCHEDULED_QUEUE_NAME } from '@tzurot/common-types/constants/queue';
import { runMaintenance, type MaintenanceDeps } from './maintenance.js';

interface MockQueue {
  getActiveCount: ReturnType<typeof vi.fn>;
  getWaitingCount: ReturnType<typeof vi.fn>;
  getDelayedCount: ReturnType<typeof vi.fn>;
  isPaused: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface Harness {
  deps: MaintenanceDeps;
  redis: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  /** Queues keyed by name — the command opens ai-requests AND scheduled-jobs. */
  queues: Map<string, MockQueue>;
}

function makeQueue(): MockQueue {
  return {
    getActiveCount: vi.fn().mockResolvedValue(0),
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getDelayedCount: vi.fn().mockResolvedValue(0),
    isPaused: vi.fn().mockResolvedValue(false),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeHarness(): Harness {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    disconnect: vi.fn(),
  };
  const queues = new Map<string, MockQueue>();
  const deps: MaintenanceDeps = {
    getRedisUrl: vi.fn().mockResolvedValue('redis://localhost:6379'),
    createRedis: vi.fn().mockReturnValue(redis as unknown as Redis),
    createQueue: vi.fn().mockImplementation((_url: string, name: string) => {
      const queue = makeQueue();
      queues.set(name, queue);
      return queue as unknown as Queue;
    }),
    // No real delays in tests: the sleep seam resolves immediately.
    sleep: vi.fn().mockResolvedValue(undefined),
  };
  return { deps, redis, queues };
}

function aiQueue(h: Harness): MockQueue {
  const q = h.queues.get('ai-requests');
  if (q === undefined) {
    throw new Error('ai-requests queue was not created');
  }
  return q;
}

function scheduledQueue(h: Harness): MockQueue {
  const q = h.queues.get(SCHEDULED_QUEUE_NAME);
  if (q === undefined) {
    throw new Error('scheduled-jobs queue was not created');
  }
  return q;
}

describe('runMaintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns exit 1 when the Redis URL cannot be resolved', async () => {
    const { deps } = makeHarness();
    (deps.getRedisUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    expect(await runMaintenance('status', { env: 'prod' }, deps)).toBe(1);
  });

  it('opens BOTH the ai-requests and scheduled-jobs queues', async () => {
    const h = makeHarness();

    await runMaintenance('status', { env: 'prod' }, h.deps);

    expect([...h.queues.keys()].sort()).toEqual(['ai-requests', SCHEDULED_QUEUE_NAME].sort());
  });

  describe('on', () => {
    it('sets the flag, pauses BOTH queues, and waits for active jobs to finish', async () => {
      const h = makeHarness();

      const exit = await runMaintenance('on', { env: 'prod' }, h.deps);

      expect(exit).toBe(0);
      expect(h.redis.set).toHaveBeenCalledWith(MAINTENANCE_FLAG_KEY, expect.any(String));
      // Both queues paused — scheduled-jobs' cron ticks hit Prisma with no
      // flag check, so pausing is what keeps them out of the migration window.
      expect(aiQueue(h).pause).toHaveBeenCalled();
      expect(scheduledQueue(h).pause).toHaveBeenCalled();
    });

    it('waits out the flag-cache convergence window BEFORE pausing and draining', async () => {
      const h = makeHarness();
      const sleep = h.deps.sleep as ReturnType<typeof vi.fn>;

      await runMaintenance('on', { env: 'prod' }, h.deps);

      expect(sleep).toHaveBeenCalledWith(5_000);
      const convergenceOrder = sleep.mock.invocationCallOrder[0];
      expect(convergenceOrder).toBeLessThan(aiQueue(h).pause.mock.invocationCallOrder[0]);
      expect(convergenceOrder).toBeLessThan(aiQueue(h).getActiveCount.mock.invocationCallOrder[0]);
    });

    it('drains ACTIVE jobs across both queues (polls until zero)', async () => {
      const h = makeHarness();
      // First poll: work in flight on both queues; then done.
      let call = 0;
      h.deps.createQueue = vi.fn().mockImplementation((_u: string, name: string) => {
        const queue = makeQueue();
        queue.getActiveCount.mockImplementation(() => {
          call += 1;
          return Promise.resolve(call <= 2 ? 1 : 0);
        });
        h.queues.set(name, queue);
        return queue as unknown as Queue;
      });

      const exit = await runMaintenance('on', { env: 'prod' }, h.deps);

      expect(exit).toBe(0);
      expect(call).toBeGreaterThanOrEqual(4); // ≥2 polls × 2 queues
    });

    it('treats waiting/delayed jobs as PARKED — they do not gate the drain', async () => {
      const h = makeHarness();
      h.deps.createQueue = vi.fn().mockImplementation((_u: string, name: string) => {
        const queue = makeQueue();
        queue.getActiveCount.mockResolvedValue(0);
        queue.getWaitingCount.mockResolvedValue(7); // parked in the paused queue
        queue.getDelayedCount.mockResolvedValue(3); // backing-off retries, cron ticks
        h.queues.set(name, queue);
        return queue as unknown as Queue;
      });
      const sleep = h.deps.sleep as ReturnType<typeof vi.fn>;

      const exit = await runMaintenance('on', { env: 'prod' }, h.deps);

      expect(exit).toBe(0);
      // Only the convergence sleep — no drain polling loop for parked jobs.
      expect(sleep).toHaveBeenCalledTimes(1);
    });

    it('still pauses the queues with skipDrain (pause is the protection; drain is the wait)', async () => {
      const h = makeHarness();

      const exit = await runMaintenance('on', { env: 'prod', skipDrain: true }, h.deps);

      expect(exit).toBe(0);
      expect(aiQueue(h).pause).toHaveBeenCalled();
      expect(scheduledQueue(h).pause).toHaveBeenCalled();
      expect(aiQueue(h).getActiveCount).not.toHaveBeenCalled();
    });

    it('times out the drain with exit 0 (operator judgment, not a failure)', async () => {
      const h = makeHarness();
      h.deps.createQueue = vi.fn().mockImplementation((_u: string, name: string) => {
        const queue = makeQueue();
        queue.getActiveCount.mockResolvedValue(3); // never drains
        h.queues.set(name, queue);
        return queue as unknown as Queue;
      });

      const exit = await runMaintenance('on', { env: 'prod', drainTimeoutSec: 4 }, h.deps);

      expect(exit).toBe(0);
      // 1 convergence wait + (4s deadline at 2s poll interval → 2 poll waits).
      expect(h.deps.sleep).toHaveBeenCalledTimes(3);
    });
  });

  describe('off', () => {
    it('resumes BOTH queues and deletes the flag', async () => {
      const h = makeHarness();

      const exit = await runMaintenance('off', { env: 'dev' }, h.deps);

      expect(exit).toBe(0);
      expect(aiQueue(h).resume).toHaveBeenCalled();
      expect(scheduledQueue(h).resume).toHaveBeenCalled();
      expect(h.redis.del).toHaveBeenCalledWith(MAINTENANCE_FLAG_KEY);
    });
  });

  describe('status', () => {
    it('reads the flag and per-queue counts (incl. paused state) without writing', async () => {
      const h = makeHarness();
      h.redis.get.mockResolvedValue('2026-07-06T00:00:00.000Z');

      const exit = await runMaintenance('status', { env: 'prod' }, h.deps);

      expect(exit).toBe(0);
      expect(h.redis.get).toHaveBeenCalledWith(MAINTENANCE_FLAG_KEY);
      expect(aiQueue(h).isPaused).toHaveBeenCalled();
      expect(scheduledQueue(h).getDelayedCount).toHaveBeenCalled();
      expect(h.redis.set).not.toHaveBeenCalled();
      expect(h.redis.del).not.toHaveBeenCalled();
    });
  });

  it('always closes the queues and disconnects Redis (no hanging CLI)', async () => {
    const h = makeHarness();

    await runMaintenance('status', { env: 'dev' }, h.deps);

    expect(aiQueue(h).close).toHaveBeenCalled();
    expect(scheduledQueue(h).close).toHaveBeenCalled();
    expect(h.redis.disconnect).toHaveBeenCalled();
  });

  it('returns exit 1 with a friendly message when the action throws (Redis unreachable)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = makeHarness();
    h.redis.set.mockRejectedValue(new Error('ECONNREFUSED'));

    const exit = await runMaintenance('on', { env: 'prod', skipDrain: true }, h.deps);

    expect(exit).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    // Cleanup still runs on the error path.
    expect(aiQueue(h).close).toHaveBeenCalled();
    expect(h.redis.disconnect).toHaveBeenCalled();
  });
});
