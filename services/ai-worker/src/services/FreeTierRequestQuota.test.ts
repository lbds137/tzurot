import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';
import {
  FreeTierRequestQuota,
  FREE_TIER_ACTIVE_KEY,
  type FreeTierQuotaConfig,
} from './FreeTierRequestQuota.js';

const CONFIG: FreeTierQuotaConfig = {
  globalDailyBudget: 1000,
  windowMinutes: 60,
  minPerWindow: 5,
  maxPerWindow: 30,
};

// Fixed clock → deterministic keys/scores (NOW and DAY are the same instant).
const NOW = Date.UTC(2026, 6, 8, 12, 0, 0);
const DAY = '2026-07-08';
const ACTIVE_KEY = FREE_TIER_ACTIVE_KEY;
const USER_KEY = `${CACHE_KEY_PREFIXES.FREE_TIER_USER_REQUESTS}user-1`;
const GLOBAL_KEY = `${CACHE_KEY_PREFIXES.FREE_TIER_GLOBAL}${DAY}`;

/**
 * Mock ioredis where the two `zcard` reads (active-set N, then per-user count)
 * and the `get` (global count) are keyed by their target so a test can set each
 * independently.
 */
function makeRedis(state: { activeN?: number; userCount?: number; globalCount?: number } = {}): {
  redis: Redis;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const zcard = vi.fn((key: string) =>
    Promise.resolve(key === ACTIVE_KEY ? (state.activeN ?? 0) : (state.userCount ?? 0))
  );
  const get = vi.fn(() => Promise.resolve(String(state.globalCount ?? 0)));
  const mocks = {
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard,
    get,
    zadd: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  return { redis: mocks as unknown as Redis, mocks };
}

function build(
  state?: Parameters<typeof makeRedis>[0],
  config: FreeTierQuotaConfig = CONFIG
): { quota: FreeTierRequestQuota; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const { redis, mocks } = makeRedis(state);
  return { quota: new FreeTierRequestQuota(redis, config, () => NOW), mocks };
}

describe('computeWindowCap', () => {
  const { quota } = build();
  it.each([
    [0, 30], // lone user → clamped to MAX (raw 41 > 30)
    [1, 30],
    [2, 20], // 41.6/2 = 20
    [3, 13], // 41.6/3 = 13
    [10, 5], // 41.6/10 = 4 → clamped to MIN
    [50, 5], // heavy contention → floor
  ])('N=%i → cap %i', (n, expected) => {
    expect(quota.computeWindowCap(n)).toBe(expected);
  });
});

describe('tryConsume — allow path', () => {
  it('allows a fresh request and advances all three counters exactly once', async () => {
    const { quota, mocks } = build({ activeN: 0, userCount: 0, globalCount: 0 });

    const v = await quota.tryConsume('user-1', 'req-1');

    expect(v).toMatchObject({ allowed: true, reason: 'ok', windowCap: 30 });
    // Counters advance only on allow, keyed correctly, scored with the clock.
    expect(mocks.zadd).toHaveBeenCalledWith(ACTIVE_KEY, NOW, 'user-1');
    expect(mocks.zadd).toHaveBeenCalledWith(USER_KEY, NOW, 'req-1');
    expect(mocks.incr).toHaveBeenCalledWith(GLOBAL_KEY);
    expect(mocks.incr).toHaveBeenCalledTimes(1);
  });
});

describe('tryConsume — deny paths (check-then-increment: no reject-bleed)', () => {
  it('denies when the user is at their rolling cap, and advances NOTHING', async () => {
    // N=0 → cap 30; userCount 30 → at cap.
    const { quota, mocks } = build({ activeN: 0, userCount: 30, globalCount: 0 });

    const v = await quota.tryConsume('user-1', 'req-1');

    expect(v).toMatchObject({ allowed: false, reason: 'user' });
    expect(mocks.incr).not.toHaveBeenCalled(); // global budget NOT bled by a denied request
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it('the global hard cap overrides the per-user floor', async () => {
    // userCount 0 would pass the user check, but the global budget is spent.
    const { quota, mocks } = build({ activeN: 3, userCount: 0, globalCount: 1000 });

    const v = await quota.tryConsume('user-1', 'req-1');

    expect(v).toMatchObject({ allowed: false, reason: 'global' });
    expect(mocks.incr).not.toHaveBeenCalled();
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it('checks global BEFORE user (a user under cap is still denied when the pie is gone)', async () => {
    const { quota } = build({ activeN: 0, userCount: 1, globalCount: 1000 });
    const v = await quota.tryConsume('user-1', 'req-1');
    expect(v.reason).toBe('global');
  });
});

describe('tryConsume — fail-open', () => {
  it('allows the request when Redis throws', async () => {
    const { quota, mocks } = build();
    mocks.zcard.mockRejectedValue(new Error('redis down'));

    const v = await quota.tryConsume('user-1', 'req-1');

    expect(v).toMatchObject({ allowed: true, reason: 'fail-open' });
  });
});

describe('tryConsume — rolling window pruning', () => {
  it('prunes both sorted sets to the window before counting', async () => {
    const { quota, mocks } = build({ activeN: 0, userCount: 0, globalCount: 0 });
    await quota.tryConsume('user-1', 'req-1');
    const windowStart = NOW - CONFIG.windowMinutes * 60_000;
    expect(mocks.zremrangebyscore).toHaveBeenCalledWith(ACTIVE_KEY, '-inf', windowStart);
    expect(mocks.zremrangebyscore).toHaveBeenCalledWith(USER_KEY, '-inf', windowStart);
  });
});
