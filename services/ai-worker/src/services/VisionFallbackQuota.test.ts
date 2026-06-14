import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { VisionFallbackQuota, VISION_SYSTEM_FALLBACK_DAILY_LIMIT } from './VisionFallbackQuota.js';

function createMockRedis(incrImpl: () => Promise<number>): {
  redis: Redis;
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
} {
  const incr = vi.fn(incrImpl);
  const expire = vi.fn().mockResolvedValue(1);
  return { redis: { incr, expire } as unknown as Redis, incr, expire };
}

describe('VisionFallbackQuota', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows and counts a call under the cap, setting expiry', async () => {
    const { redis, incr, expire } = createMockRedis(() => Promise.resolve(1));
    const quota = new VisionFallbackQuota(redis, 20);

    expect(await quota.tryConsume('123')).toBe(true);
    expect(incr).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledTimes(1);
    // Key is per-user and per-UTC-day.
    const key = incr.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^visionfallback:system:123:\d{4}-\d{2}-\d{2}$/);
    // Expiry uses the same key with a positive TTL.
    expect(expire.mock.calls[0]?.[0]).toBe(key);
    expect(expire.mock.calls[0]?.[1]).toBeGreaterThan(0);
  });

  it('allows the call exactly at the cap (inclusive)', async () => {
    const { redis } = createMockRedis(() => Promise.resolve(20));
    const quota = new VisionFallbackQuota(redis, 20);
    expect(await quota.tryConsume('123')).toBe(true);
  });

  it('rejects the call once the count exceeds the cap', async () => {
    const { redis } = createMockRedis(() => Promise.resolve(21));
    const quota = new VisionFallbackQuota(redis, 20);
    expect(await quota.tryConsume('123')).toBe(false);
  });

  it('fails open (allows) when Redis INCR throws', async () => {
    const { redis, expire } = createMockRedis(() => Promise.reject(new Error('redis down')));
    const quota = new VisionFallbackQuota(redis, 20);
    expect(await quota.tryConsume('123')).toBe(true);
    // INCR threw before EXPIRE, so EXPIRE is never reached.
    expect(expire).not.toHaveBeenCalled();
  });

  it('defaults to the council-suggested daily limit', async () => {
    const { redis } = createMockRedis(() =>
      Promise.resolve(VISION_SYSTEM_FALLBACK_DAILY_LIMIT + 1)
    );
    const quota = new VisionFallbackQuota(redis); // no explicit limit
    expect(await quota.tryConsume('123')).toBe(false);
    expect(VISION_SYSTEM_FALLBACK_DAILY_LIMIT).toBe(20);
  });
});
