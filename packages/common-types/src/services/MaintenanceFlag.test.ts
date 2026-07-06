import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { MaintenanceFlag } from './MaintenanceFlag.js';
import { MAINTENANCE_FLAG_KEY } from '../constants/redis-keys.js';

function mockRedis(overrides: Partial<Record<'get' | 'set' | 'del', unknown>> = {}): Redis {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ...overrides,
  } as unknown as Redis;
}

describe('MaintenanceFlag', () => {
  // House idiom for TTLCache tests: fake timers drive Date.now(), which the
  // injected clock reads (see TTLCache.test.ts).
  const now = (): number => Date.now();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isActive', () => {
    it('returns false when the key is absent and true when present', async () => {
      const redisOff = mockRedis();
      expect(await new MaintenanceFlag(redisOff, { now }).isActive()).toBe(false);

      const redisOn = mockRedis({ get: vi.fn().mockResolvedValue('2026-07-06T00:00:00.000Z') });
      expect(await new MaintenanceFlag(redisOn, { now }).isActive()).toBe(true);
    });

    it('caches the result within the TTL window (one Redis GET, both values)', async () => {
      const get = vi.fn().mockResolvedValue(null);
      const flag = new MaintenanceFlag(mockRedis({ get }), { cacheTtlMs: 5_000, now });

      expect(await flag.isActive()).toBe(false);
      expect(await flag.isActive()).toBe(false);
      expect(get).toHaveBeenCalledTimes(1);

      // Past the TTL the next check re-reads Redis.
      vi.advanceTimersByTime(5_001);
      get.mockResolvedValue('2026-07-06T00:00:00.000Z');
      expect(await flag.isActive()).toBe(true);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('fails OPEN (inactive) when Redis errors, without caching the failure', async () => {
      const get = vi.fn().mockRejectedValue(new Error('redis down'));
      const flag = new MaintenanceFlag(mockRedis({ get }), { now });

      expect(await flag.isActive()).toBe(false);

      // The error result is not cached — recovery is observed on the next call.
      get.mockResolvedValue('2026-07-06T00:00:00.000Z');
      expect(await flag.isActive()).toBe(true);
    });

    it('fails OPEN when the Redis read hangs past the latency bound (uncached)', async () => {
      // A hung-not-failing GET must not eat the Discord ack budget: the read
      // is raced against a 250ms bound and a timeout counts as inactive.
      const get = vi.fn().mockReturnValue(new Promise(() => undefined)); // never settles
      const flag = new MaintenanceFlag(mockRedis({ get }), { now });

      const pending = flag.isActive();
      await vi.advanceTimersByTimeAsync(251);
      expect(await pending).toBe(false);

      // Not cached — a recovered Redis is observed on the next call.
      get.mockResolvedValue('2026-07-06T00:00:00.000Z');
      expect(await flag.isActive()).toBe(true);
    });
  });

  describe('enable / disable', () => {
    it('enable writes an ISO timestamp under the flag key', async () => {
      const set = vi.fn().mockResolvedValue('OK');
      const flag = new MaintenanceFlag(mockRedis({ set }), { now });

      await flag.enable(new Date('2026-07-06T01:02:03.000Z'));
      expect(set).toHaveBeenCalledWith(MAINTENANCE_FLAG_KEY, '2026-07-06T01:02:03.000Z');
    });

    it('disable deletes the flag key', async () => {
      const del = vi.fn().mockResolvedValue(1);
      const flag = new MaintenanceFlag(mockRedis({ del }), { now });

      await flag.disable();
      expect(del).toHaveBeenCalledWith(MAINTENANCE_FLAG_KEY);
    });

    it('toggling drops the local cache so the writer observes its own change', async () => {
      const get = vi.fn().mockResolvedValue(null);
      const redis = mockRedis({ get });
      const flag = new MaintenanceFlag(redis, { cacheTtlMs: 60_000, now });

      expect(await flag.isActive()).toBe(false); // cached false

      get.mockResolvedValue('2026-07-06T00:00:00.000Z');
      await flag.enable();
      expect(await flag.isActive()).toBe(true); // cache was dropped, fresh read

      get.mockResolvedValue(null);
      await flag.disable();
      expect(await flag.isActive()).toBe(false);
    });
  });

  describe('status', () => {
    it('reads uncached and returns the enable timestamp', async () => {
      const get = vi.fn().mockResolvedValue('2026-07-06T01:02:03.000Z');
      const flag = new MaintenanceFlag(mockRedis({ get }), { cacheTtlMs: 60_000, now });

      // Prime the read cache with a different answer to prove status bypasses it.
      get.mockResolvedValueOnce(null);
      expect(await flag.isActive()).toBe(false);

      expect(await flag.status()).toEqual({
        active: true,
        since: '2026-07-06T01:02:03.000Z',
      });
    });

    it('returns inactive with null since when the key is absent', async () => {
      const flag = new MaintenanceFlag(mockRedis(), { now });
      expect(await flag.status()).toEqual({ active: false, since: null });
    });
  });
});
