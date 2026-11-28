import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { TRACKED_JOB_MAX_LIFETIME_MS } from '../JobTracker.js';
import { REROLL_BOOT_ID } from './rerollInflight.js';
import {
  REROLL_JOB_RECORD_TTL_MS,
  claimRerollGuardFor,
  deleteRerollJob,
  rerollJobHandledBy,
  markRerollJobHandled,
  acquireRerollGuard,
  releaseRerollGuard,
  rememberRerollJob,
  takeRerollJob,
} from './rerollGuard.js';

/**
 * A Redis whose MULTI runs its queued commands against one shared map with no
 * interleaving, like the real one: the shape the atomic take depends on.
 */
function statefulRedis(initial: Record<string, string>): Redis {
  const store = new Map(Object.entries(initial));
  return {
    set: vi.fn(async (key: string, value: string, ...flags: unknown[]) => {
      if (flags.includes('NX') && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    multi: vi.fn(() => {
      const queued: Array<() => unknown> = [];
      const chain = {
        get: (key: string) => {
          queued.push(() => store.get(key) ?? null);
          return chain;
        },
        del: (key: string) => {
          queued.push(() => (store.delete(key) ? 1 : 0));
          return chain;
        },
        exec: async () => queued.map(run => [null, run()]),
      };
      return chain;
    }),
  } as unknown as Redis;
}

function fakeRedis(
  overrides: Partial<Record<'set' | 'get' | 'del' | 'multi', unknown>> = {}
): Redis {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
    multi: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([
        [null, null],
        [null, 0],
      ]),
    })),
    ...overrides,
  } as unknown as Redis;
}

describe('acquireRerollGuard', () => {
  it('takes SET NX on the row key with the attempt id and the tracked-job lifetime', async () => {
    const redis = fakeRedis();

    await expect(acquireRerollGuard(redis, 'row-1', 'attempt-1')).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'reroll:lock:row-1',
      'attempt-1',
      'PX',
      TRACKED_JOB_MAX_LIFETIME_MS,
      'NX'
    );
  });

  it('refuses when the lock is already held', async () => {
    const redis = fakeRedis({ set: vi.fn().mockResolvedValue(null) });

    await expect(acquireRerollGuard(redis, 'row-1', 'attempt-2')).resolves.toBe(false);
  });
});

describe('releaseRerollGuard', () => {
  it('deletes the lock when it is still ours', async () => {
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue('attempt-1') });

    await releaseRerollGuard(redis, 'row-1', 'attempt-1');

    expect(redis.del).toHaveBeenCalledWith('reroll:lock:row-1');
  });

  it("leaves a newer attempt's lock alone", async () => {
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue('attempt-2') });

    await releaseRerollGuard(redis, 'row-1', 'attempt-1');

    expect(redis.del).not.toHaveBeenCalled();
  });

  it('never throws when Redis fails', async () => {
    const redis = fakeRedis({ get: vi.fn().mockRejectedValue(new Error('down')) });

    await expect(releaseRerollGuard(redis, 'row-1', 'attempt-1')).resolves.toBeUndefined();
  });
});

describe('handled marker', () => {
  it('marks a job handled for the record lifetime with this boot id and the time, and reads both back', async () => {
    const redis = statefulRedis({});
    const before = Date.now();

    await expect(rerollJobHandledBy(redis, 'job-1')).resolves.toBeNull();
    await markRerollJobHandled(redis, 'job-1');

    expect(redis.set).toHaveBeenCalledWith(
      'reroll:handled:job-1',
      expect.stringContaining(`"bootId":"${REROLL_BOOT_ID}"`),
      'PX',
      REROLL_JOB_RECORD_TTL_MS
    );
    const read = await rerollJobHandledBy(redis, 'job-1');
    expect(read?.bootId).toBe(REROLL_BOOT_ID);
    expect(read?.markedAt).toBeGreaterThanOrEqual(before);
    expect(read?.markedAt).toBeLessThanOrEqual(Date.now());
    await expect(rerollJobHandledBy(redis, 'job-2')).resolves.toBeNull();
  });

  it('reads another process marker back as it is written', async () => {
    const redis = statefulRedis({
      'reroll:handled:job-1': JSON.stringify({ bootId: 'boot-other', markedAt: 1234 }),
    });

    await expect(rerollJobHandledBy(redis, 'job-1')).resolves.toEqual({
      bootId: 'boot-other',
      markedAt: 1234,
    });
  });

  it('reads a value that is not a marker as an unreadable boot from long ago, never as absent', async () => {
    const redis = statefulRedis({ 'reroll:handled:job-1': 'boot-plain-string' });

    await expect(rerollJobHandledBy(redis, 'job-1')).resolves.toEqual({
      bootId: 'unreadable',
      markedAt: 0,
    });
  });

  it('never throws when Redis fails', async () => {
    const down = fakeRedis({
      set: vi.fn().mockRejectedValue(new Error('down')),
      get: vi.fn().mockRejectedValue(new Error('down')),
    });

    await expect(markRerollJobHandled(down, 'j')).resolves.toBeUndefined();
    await expect(rerollJobHandledBy(down, 'j')).resolves.toBeNull();
  });
});

describe('claimRerollGuardFor', () => {
  it('takes a free lock for the attempt and says it acquired it', async () => {
    const redis = statefulRedis({});

    await expect(claimRerollGuardFor(redis, 'row-1', 'attempt-1')).resolves.toBe('acquired');
    await expect(redis.get('reroll:lock:row-1')).resolves.toBe('attempt-1');
  });

  it('counts a lock the attempt already holds as taken, but says it was already ours', async () => {
    const redis = statefulRedis({ 'reroll:lock:row-1': 'attempt-1' });

    await expect(claimRerollGuardFor(redis, 'row-1', 'attempt-1')).resolves.toBe('alreadyOurs');
  });

  it('refuses a lock another attempt holds, leaving it alone', async () => {
    const redis = statefulRedis({ 'reroll:lock:row-1': 'attempt-2' });

    await expect(claimRerollGuardFor(redis, 'row-1', 'attempt-1')).resolves.toBe('held');
    await expect(redis.get('reroll:lock:row-1')).resolves.toBe('attempt-2');
  });
});

describe('deleteRerollJob', () => {
  it('deletes the job record without reading it', async () => {
    const redis = statefulRedis({ 'reroll:job:job-1': '{}' });

    await deleteRerollJob(redis, 'job-1');

    await expect(redis.get('reroll:job:job-1')).resolves.toBeNull();
  });

  it('never throws when Redis fails', async () => {
    const down = fakeRedis({ del: vi.fn().mockRejectedValue(new Error('down')) });

    await expect(deleteRerollJob(down, 'job-1')).resolves.toBeUndefined();
  });
});

describe('reroll job record', () => {
  const record = {
    rowId: 'row-1',
    attemptId: 'attempt-1',
    routeKey: '222',
    actorId: 'clicker',
    keepMemoryIds: ['m1'],
  };

  it('outlives the orphan sweep so a late result still finds its record', () => {
    expect(REROLL_JOB_RECORD_TTL_MS).toBeGreaterThan(TRACKED_JOB_MAX_LIFETIME_MS);
  });

  it('stores the record under the job id with the record lifetime', async () => {
    const redis = fakeRedis();

    await rememberRerollJob(redis, 'job-1', record);

    expect(redis.set).toHaveBeenCalledWith(
      'reroll:job:job-1',
      JSON.stringify(record),
      'PX',
      REROLL_JOB_RECORD_TTL_MS
    );
  });

  it('takes the record back out and deletes it in one MULTI', async () => {
    const redis = statefulRedis({ 'reroll:job:job-1': JSON.stringify(record) });

    await expect(takeRerollJob(redis, 'job-1')).resolves.toEqual(record);
    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    await expect(takeRerollJob(redis, 'job-1')).resolves.toBeNull();
  });

  it('hands the record to exactly one of two concurrent takers', async () => {
    const redis = statefulRedis({ 'reroll:job:job-1': JSON.stringify(record) });

    const taken = await Promise.all([takeRerollJob(redis, 'job-1'), takeRerollJob(redis, 'job-1')]);

    expect(taken.filter(value => value !== null)).toEqual([record]);
  });

  it('returns null for a missing, malformed or wrong-shaped record', async () => {
    await expect(takeRerollJob(fakeRedis(), 'job-1')).resolves.toBeNull();
    await expect(
      takeRerollJob(statefulRedis({ 'reroll:job:job-1': '{not json' }), 'job-1')
    ).resolves.toBeNull();
    await expect(
      takeRerollJob(statefulRedis({ 'reroll:job:job-1': '{"rowId":1}' }), 'job-1')
    ).resolves.toBeNull();
  });

  it('never throws when Redis fails', async () => {
    const down = fakeRedis({
      set: vi.fn().mockRejectedValue(new Error('down')),
      get: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
      multi: vi.fn(() => {
        throw new Error('down');
      }),
    });

    await expect(rememberRerollJob(down, 'j', record)).resolves.toBeUndefined();
    await expect(takeRerollJob(down, 'j')).resolves.toBeNull();
  });
});
