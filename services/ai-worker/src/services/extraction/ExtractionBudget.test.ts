import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { ExtractionBudget, FACT_EXTRACTION_DAILY_LIMIT } from './ExtractionBudget.js';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';

function makeRedis(evalResult: number | Error): Redis {
  return {
    eval:
      evalResult instanceof Error
        ? vi.fn().mockRejectedValue(evalResult)
        : vi.fn().mockResolvedValue(evalResult),
  } as unknown as Redis;
}

describe('ExtractionBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T22:30:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('allows a call under the cap and counts it atomically via Lua', async () => {
    const redis = makeRedis(1);
    const budget = new ExtractionBudget(redis, 10);

    await expect(budget.tryConsume('personality-1')).resolves.toBe(true);

    // Assert what crosses the seam: the Lua eval with the UTC-day-scoped key.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      1,
      `${CACHE_KEY_PREFIXES.FACT_EXTRACTION_BUDGET}personality-1:2026-07-06`,
      String(25 * 60 * 60)
    );
  });

  it('allows the exact cap value (inclusive) and denies past it', async () => {
    const atCap = new ExtractionBudget(makeRedis(10), 10);
    await expect(atCap.tryConsume('p')).resolves.toBe(true);

    const overCap = new ExtractionBudget(makeRedis(11), 10);
    await expect(overCap.tryConsume('p')).resolves.toBe(false);
  });

  it('fails open on Redis errors', async () => {
    const budget = new ExtractionBudget(makeRedis(new Error('redis down')), 10);
    await expect(budget.tryConsume('p')).resolves.toBe(true);
  });

  it('scopes keys by UTC day so the count resets at midnight', async () => {
    const redis = makeRedis(1);
    const budget = new ExtractionBudget(redis);

    await budget.tryConsume('p');
    vi.setSystemTime(new Date('2026-07-07T00:00:01.000Z'));
    await budget.tryConsume('p');

    const keys = vi.mocked(redis.eval).mock.calls.map(c => c[2]);
    expect(keys[0]).toContain('2026-07-06');
    expect(keys[1]).toContain('2026-07-07');
  });

  it('exposes a generous default limit', () => {
    expect(FACT_EXTRACTION_DAILY_LIMIT).toBeGreaterThanOrEqual(50);
  });
});
