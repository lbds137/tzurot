import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { ArchiveSummaryBudget } from './ArchiveSummaryBudget.js';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';

function makeRedis(incrResult: number | Error, expireResult: unknown | Error = 1): Redis {
  return {
    incr:
      incrResult instanceof Error
        ? vi.fn().mockRejectedValue(incrResult)
        : vi.fn().mockResolvedValue(incrResult),
    expire:
      expireResult instanceof Error
        ? vi.fn().mockRejectedValue(expireResult)
        : vi.fn().mockResolvedValue(expireResult),
  } as unknown as Redis;
}

describe('ArchiveSummaryBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T22:30:00.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('allows a call under the cap and counts it with INCR + EXPIRE', async () => {
    const redis = makeRedis(1);
    const budget = new ArchiveSummaryBudget(redis, () => 10);

    const { allowed } = await budget.tryConsume();
    expect(allowed).toBe(true);

    const key = `${CACHE_KEY_PREFIXES.ARCHIVE_SUMMARY_BUDGET}2026-07-06`;
    expect(redis.incr).toHaveBeenCalledWith(key);
    expect(redis.expire).toHaveBeenCalledWith(key, 25 * 60 * 60);
  });

  it('allows the exact cap value (inclusive) and denies past it', async () => {
    const atCap = new ArchiveSummaryBudget(makeRedis(10), () => 10);
    await expect(atCap.tryConsume()).resolves.toMatchObject({ allowed: true });

    const overCap = new ArchiveSummaryBudget(makeRedis(11), () => 10);
    await expect(overCap.tryConsume()).resolves.toMatchObject({ allowed: false });
  });

  it('reads the limit live per call (a supplier, not a captured value)', async () => {
    let limit = 5;
    const budget = new ArchiveSummaryBudget(makeRedis(6), () => limit);
    await expect(budget.tryConsume()).resolves.toMatchObject({ allowed: false });

    limit = 100;
    await expect(budget.tryConsume()).resolves.toMatchObject({ allowed: true });
  });

  it('fails open on Redis errors', async () => {
    const budget = new ArchiveSummaryBudget(makeRedis(new Error('redis down')), () => 10);
    await expect(budget.tryConsume()).resolves.toMatchObject({ allowed: true });
  });

  it('scopes the key by UTC day (global, no personality segment)', async () => {
    const redis = makeRedis(1);
    const budget = new ArchiveSummaryBudget(redis, () => 100);

    await budget.tryConsume();
    vi.setSystemTime(new Date('2026-07-07T00:00:01.000Z'));
    await budget.tryConsume();

    const keys = vi.mocked(redis.incr).mock.calls.map(c => c[0]);
    expect(keys[0]).toBe(`${CACHE_KEY_PREFIXES.ARCHIVE_SUMMARY_BUDGET}2026-07-06`);
    expect(keys[1]).toBe(`${CACHE_KEY_PREFIXES.ARCHIVE_SUMMARY_BUDGET}2026-07-07`);
  });

  it('an EXPIRE failure never overrides a verdict the INCR already decided', async () => {
    const redis = makeRedis(11, new Error('expire down'));
    const budget = new ArchiveSummaryBudget(redis, () => 10);

    const { allowed } = await budget.tryConsume();
    expect(allowed).toBe(false);
  });

  describe('refund', () => {
    it('DECRs the same UTC-day-scoped key tryConsume charged, even across a UTC-day rollover', async () => {
      vi.setSystemTime(new Date('2026-07-06T23:59:59.000Z'));
      const decr = vi.fn().mockResolvedValue(0);
      const redis = { ...makeRedis(1), decr } as unknown as Redis;
      const budget = new ArchiveSummaryBudget(redis, () => 10);

      const { refund } = await budget.tryConsume();

      vi.setSystemTime(new Date('2026-07-07T00:00:30.000Z'));
      await refund();

      expect(decr).toHaveBeenCalledWith(`${CACHE_KEY_PREFIXES.ARCHIVE_SUMMARY_BUDGET}2026-07-06`);
    });

    it('swallows a Redis error (never throws)', async () => {
      const decr = vi.fn().mockRejectedValue(new Error('redis down'));
      const redis = { ...makeRedis(1), decr } as unknown as Redis;
      const budget = new ArchiveSummaryBudget(redis, () => 10);

      const { refund } = await budget.tryConsume();

      await expect(refund()).resolves.toBeUndefined();
    });

    it('is a no-op on the fail-open path — nothing was charged, so nothing should be decremented', async () => {
      const decr = vi.fn().mockResolvedValue(0);
      const redis = { ...makeRedis(new Error('redis down')), decr } as unknown as Redis;
      const budget = new ArchiveSummaryBudget(redis, () => 10);

      const { refund } = await budget.tryConsume();
      await refund();

      expect(decr).not.toHaveBeenCalled();
    });
  });
});
