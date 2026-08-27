import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { CACHE_KEY_PREFIXES } from '@tzurot/common-types/constants/redis-keys';

// Module-scope logger (not injectable), so asserting the once-per-instance
// inverted-bounds warn requires mocking the logger module per package convention.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

import {
  FreeTierRequestQuota,
  FREE_TIER_ACTIVE_KEY,
  ZAI_FREE_TIER_KEYS,
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
 * independently. `zscore` (the same-request membership probe) answers "absent"
 * by default — a test that needs a request to already hold a slot overrides it,
 * or uses `makeStatefulRedis` below to have the first consume's ZADD show up in
 * the second consume's reads.
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
    zscore: vi.fn().mockResolvedValue(null),
    get,
    zadd: vi.fn().mockResolvedValue(1),
    // SET … NX for the global-counter dedup marker: 'OK' = first consume
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  return { redis: mocks as unknown as Redis, mocks };
}

/**
 * Redis fake whose per-user ZSET is REAL state, so a second `tryConsume` sees
 * what the first one wrote. A fixed-return `zcard`/`zscore` pair cannot
 * discriminate the same-request short-circuit from the ordinary path — which is
 * exactly how the double-consult boundary bug stayed invisible.
 *
 * `seedUserMembers` pre-fills the window (the "N slots already used" setup);
 * the active-set N and the global counter stay fixed knobs.
 */
function makeStatefulRedis(state: {
  activeN?: number;
  globalCount?: number;
  seedUserMembers?: string[];
}): {
  redis: Redis;
  mocks: Record<string, ReturnType<typeof vi.fn>>;
  userZset: Map<string, number>;
} {
  const userZset = new Map<string, number>((state.seedUserMembers ?? []).map(m => [m, NOW]));
  const mocks = {
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn((key: string) =>
      Promise.resolve(key === ACTIVE_KEY ? (state.activeN ?? 0) : userZset.size)
    ),
    zscore: vi.fn((key: string, member: string) =>
      Promise.resolve(key === USER_KEY ? (userZset.get(member)?.toString() ?? null) : null)
    ),
    get: vi.fn(() => Promise.resolve(String(state.globalCount ?? 0))),
    zadd: vi.fn((key: string, score: number, member: string) => {
      if (key === USER_KEY) {
        userZset.set(member, score);
      }
      return Promise.resolve(1);
    }),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  return { redis: mocks as unknown as Redis, mocks, userZset };
}

/** `n` distinct pre-existing window members ('seed-0' … 'seed-n-1'). */
function seed(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `seed-${i}`);
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

describe('computeWindowCap — inverted min/max guard (defense-in-depth)', () => {
  it('clamps with the swapped pair when minPerWindow > maxPerWindow, and warns once', () => {
    const invertedConfig: FreeTierQuotaConfig = { ...CONFIG, minPerWindow: 30, maxPerWindow: 5 };
    const { quota } = build(undefined, invertedConfig);

    // N=3 → raw 13, strictly between the swapped-pair bounds (floor 5, ceiling
    // 30) — the old buggy `Math.max(min, Math.min(max, raw))` form would
    // collapse this to the constant minPerWindow (30), losing the dynamic
    // scaling; the corrected clamp lets 13 through.
    expect(quota.computeWindowCap(3)).toBe(13);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { minPerWindow: 30, maxPerWindow: 5 },
      expect.stringContaining('inverted')
    );

    // A second call on the SAME instance must not warn again.
    quota.computeWindowCap(1);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('provider-fn config (runtime-tunable, re-resolved per decision)', () => {
  it('a config change applies to the NEXT decision on the same instance — no rebuild, window state untouched', async () => {
    const { redis } = makeRedis({ activeN: 1, userCount: 4, globalCount: 0 });
    let config: FreeTierQuotaConfig = { ...CONFIG, minPerWindow: 1, maxPerWindow: 4 };
    const quota = new FreeTierRequestQuota(
      redis,
      () => config,
      () => NOW
    );

    // userCount 4 >= cap 4 (lone-user clamp to maxPerWindow) → denied
    const denied = await quota.tryConsume('u1', 'req-1');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('user');

    // Admin raises the ceiling at runtime — same instance admits the retry
    config = { ...CONFIG, minPerWindow: 1, maxPerWindow: 10 };
    const allowed = await quota.tryConsume('u1', 'req-2');
    expect(allowed.allowed).toBe(true);
    expect(allowed.windowCap).toBeGreaterThan(4);
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
    // The global increment is guarded by the day-scoped NX dedup marker
    expect(mocks.set).toHaveBeenCalledWith(
      `${GLOBAL_KEY}:req:req-1`,
      '1',
      'EX',
      25 * 60 * 60,
      'NX'
    );
    expect(mocks.incr).toHaveBeenCalledWith(GLOBAL_KEY);
    expect(mocks.incr).toHaveBeenCalledTimes(1);
  });

  it('a long-delayed BullMQ retry (member pruned, NX marker alive) does NOT re-increment the global counter', async () => {
    // A retry landing more than one window later: the per-user member has been
    // pruned (zscore absent → no same-request short-circuit, so the full path
    // runs), but the day-scoped NX marker outlives the window (25h vs 60min),
    // so the global counter still refuses the second bill. Inside the window
    // the re-consult short-circuits earlier instead — see the
    // verdict-idempotent block below.
    const { quota, mocks } = build({ activeN: 0, userCount: 0, globalCount: 1 });
    // NX marker already present from the first consume
    mocks.set.mockResolvedValue(null);

    const v = await quota.tryConsume('user-1', 'req-1');

    expect(v.allowed).toBe(true);
    // The pruned member is re-added, taking a fresh window slot…
    expect(mocks.zadd).toHaveBeenCalledWith(USER_KEY, NOW, 'req-1');
    // …but the global budget is not double-billed
    expect(mocks.incr).not.toHaveBeenCalled();
  });
});

describe('tryConsume — same-request re-consult is verdict-idempotent', () => {
  // One logical request consults the quota more than once (the z.ai piggyback
  // admits a vision tier and a text slot separately). The second consult reads
  // a per-user ZCARD that already counts the first consult's own member, so
  // without the membership short-circuit the request is denied the slot it is
  // already holding. N=0 → cap 30, and 29 members are pre-seeded so the first
  // consult takes the LAST slot — the exact boundary.
  it('re-consulting with the same requestId at the cap boundary is ALLOWED', async () => {
    const { redis } = makeStatefulRedis({ activeN: 0, globalCount: 0, seedUserMembers: seed(29) });
    const quota = new FreeTierRequestQuota(redis, CONFIG, () => NOW);

    const first = await quota.tryConsume('user-1', 'req-1');
    expect(first).toMatchObject({ allowed: true, reason: 'ok', windowCap: 30, userCount: 29 });

    // The window is now full (30/30) and the 30th slot is req-1's own.
    const second = await quota.tryConsume('user-1', 'req-1');
    expect(second).toMatchObject({ allowed: true, userCount: 30, windowCap: 30 });
  });

  it('the re-consult advances NO counters (no second ZADD, no global INCR)', async () => {
    const { redis, mocks, userZset } = makeStatefulRedis({
      activeN: 0,
      globalCount: 0,
      seedUserMembers: seed(29),
    });
    const quota = new FreeTierRequestQuota(redis, CONFIG, () => NOW);

    await quota.tryConsume('user-1', 'req-1');
    mocks.zadd.mockClear();
    mocks.set.mockClear();
    mocks.incr.mockClear();

    await quota.tryConsume('user-1', 'req-1');

    expect(mocks.zadd).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.incr).not.toHaveBeenCalled();
    // The member's ORIGINAL score survives — a refreshed timestamp would push
    // the slot's expiry out and break rolling-window pruning.
    expect(userZset.get('req-1')).toBe(NOW);
    expect(userZset.size).toBe(30);
  });

  it('a DIFFERENT requestId at the same boundary is still denied (the cap still works)', async () => {
    const { redis, mocks } = makeStatefulRedis({
      activeN: 0,
      globalCount: 0,
      seedUserMembers: seed(29),
    });
    const quota = new FreeTierRequestQuota(redis, CONFIG, () => NOW);

    await quota.tryConsume('user-1', 'req-1');
    const other = await quota.tryConsume('user-1', 'req-2');

    expect(other).toMatchObject({ allowed: false, reason: 'user' });
    expect(mocks.incr).toHaveBeenCalledTimes(1); // only the first consume billed
  });

  it('a failing membership probe falls THROUGH to the cap checks (not fail-open, not allow)', async () => {
    // userCount 30 at cap 30: the probe is the only thing that could allow it,
    // so a denial proves the error path re-entered the normal logic rather
    // than short-circuiting — and reason 'user' (not 'fail-open') proves the
    // outer handler did not swallow the whole decision.
    const { quota, mocks } = build({ activeN: 0, userCount: 30, globalCount: 0 });
    mocks.zscore.mockRejectedValue(new Error('redis down'));

    const v = await quota.tryConsume('user-1', 'req-1');

    expect(v).toMatchObject({ allowed: false, reason: 'user' });
    expect(mocks.zadd).not.toHaveBeenCalled();
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

describe('key-pool parameterization (z.ai piggyback instance)', () => {
  it('operates on the zaifreeq:* keys so the two pools never share counters', async () => {
    const calls: string[] = [];
    const redis = {
      zremrangebyscore: vi.fn(async (key: string) => calls.push(key)),
      zcard: vi.fn(async (key: string) => {
        calls.push(key);
        return 0;
      }),
      zscore: vi.fn(async (key: string) => {
        calls.push(key);
        return null;
      }),
      get: vi.fn(async (key: string) => {
        calls.push(key);
        return null;
      }),
      zadd: vi.fn(async (key: string) => calls.push(key)),
      set: vi.fn(async (key: string) => {
        calls.push(key);
        return 'OK';
      }),
      incr: vi.fn(async (key: string) => {
        calls.push(key);
        return 1;
      }),
      expire: vi.fn(async (key: string) => calls.push(key)),
    } as unknown as Redis;

    const quota = new FreeTierRequestQuota(
      redis,
      { globalDailyBudget: 1000, windowMinutes: 60, minPerWindow: 5, maxPerWindow: 30 },
      () => Date.parse('2026-07-11T12:00:00Z'),
      ZAI_FREE_TIER_KEYS
    );

    const verdict = await quota.tryConsume('user-1', 'req-1');

    // 'ok' (not 'fail-open') proves the REAL allow path ran — a missing mock
    // command would throw inside tryConsume and silently convert to fail-open,
    // satisfying a bare allowed:true while exercising nothing.
    expect(verdict).toMatchObject({ allowed: true, reason: 'ok' });
    expect(calls.some(k => k.startsWith('zaifreeq:'))).toBe(true);
    expect(calls.every(k => !k.startsWith('freeq:'))).toBe(true);
  });
});
