/**
 * z.ai free-tier admission chain — WIRING / seam test.
 *
 * The unit suites around this chain each mock the next hop:
 * `guestModeOverrides.test.ts` mocks `ZaiFreeTierAdmission`,
 * `ZaiFreeTierAdmission.test.ts` mocks the quota and the meter, and
 * `FreeTierRequestQuota.test.ts` mocks Redis. That gives focused per-unit
 * coverage but means NO test ever runs the seams JOINED — the exact gap shape
 * that shipped the vision-chain seam bugs (see
 * `multimodal/visionFallbackChain.test.ts` for that history).
 *
 * This file runs the REAL chain:
 *
 *   applyGuestModeOverrides → ZaiFreeTierAdmission.admit →
 *     ZaiPlanMeter.getReading (REAL, fetch mocked) +
 *     FreeTierRequestQuota.tryConsume (REAL, fake in-memory Redis)
 *
 * External boundaries ONLY are substituted:
 *   - the z.ai quota HTTP endpoint (injected `fetchImpl`)
 *   - Redis (a minimal in-memory fake implementing the commands the chain uses)
 *
 * The AuthStep → applyGuestModeOverrides seam is a directly-guarded call
 * (`route.isGuestMode`) whose arguments AuthStep's own tests assert; it is
 * deliberately out of scope here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { AIProvider, ZAI_FREE_TIER_MODEL } from '@tzurot/common-types/constants/ai';
import {
  ZAI_FREE_TIER_KILL_SWITCH_KEY,
  ZAI_FREE_TIER_EXHAUSTED_KEY,
  ZAI_PLAN_METER_SNAPSHOT_KEY,
  CACHE_KEY_PREFIXES,
} from '@tzurot/common-types/constants/redis-keys';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import { applyGuestModeOverrides } from '../jobs/handlers/pipeline/steps/guestModeOverrides.js';
import type { GenerationContext } from '../jobs/handlers/pipeline/types.js';
import { ZaiFreeTierAdmission } from './ZaiFreeTierAdmission.js';
import { ZaiPlanMeter } from './ZaiPlanMeter.js';
import { FreeTierRequestQuota, ZAI_FREE_TIER_KEYS } from './FreeTierRequestQuota.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type EffectivePersonality = NonNullable<GenerationContext['config']>['effectivePersonality'];

/**
 * Minimal in-memory Redis fake covering exactly the commands the chain issues
 * (admission flags, quota ZSETs/counters, the meter snapshot). Anything else
 * throws so a new command reaches for a real implementation consciously.
 */
class FakeRedis {
  readonly strings = new Map<string, string>();
  readonly zsets = new Map<string, Map<string, number>>();

  async exists(key: string): Promise<number> {
    return this.strings.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: unknown[]): Promise<'OK'> {
    this.strings.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    const isNew = !zset.has(member);
    zset.set(member, score);
    this.zsets.set(key, zset);
    return isNew ? 1 : 0;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const zset = this.zsets.get(key);
    if (zset === undefined) {
      return 0;
    }
    const lo = min === '-inf' ? -Infinity : Number(min);
    const hi = max === '+inf' ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of zset) {
      if (score >= lo && score <= hi) {
        zset.delete(member);
        removed++;
      }
    }
    return removed;
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}

const NOW = 1_700_000_000_000;
const DAY = new Date(NOW).toISOString().slice(0, 10);
const GLOBAL_KEY = `${CACHE_KEY_PREFIXES.ZAI_FREE_TIER_GLOBAL}${DAY}`;
const PLAN_KEY = 'sk-coding-plan';

const PERSONAL_ZAI = {
  id: 'p1',
  name: 'Testy',
  model: 'z-ai/glm-4.5-air',
  provider: 'openrouter',
} as unknown as EffectivePersonality;

/** Probe-shaped quota response with the given tighter-window percentage. */
function quotaResponse(tokensPct: number): unknown {
  return {
    data: {
      limits: [
        { type: 'TIME_LIMIT', percentage: 0 },
        { type: 'TOKENS_LIMIT', percentage: tokensPct, nextResetTime: NOW + 60_000 },
        { type: 'TOKENS_LIMIT', percentage: Math.max(0, tokensPct - 20) },
      ],
    },
  };
}

function fetchReturning(tokensPct: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => quotaResponse(tokensPct),
  });
}

describe('z.ai admission chain (wiring: real overrides → admission → meter + quota)', () => {
  let redis: FakeRedis;
  let configResolver: LlmConfigResolver;

  beforeEach(() => {
    redis = new FakeRedis();
    configResolver = {
      getFreeDefaultConfig: vi.fn().mockResolvedValue({ model: 'gemma/fallback:free' }),
    } as unknown as LlmConfigResolver;
  });

  function buildChain(
    fetchImpl: ReturnType<typeof vi.fn>,
    quotaConfig = { globalDailyBudget: 3, windowMinutes: 60, minPerWindow: 1, maxPerWindow: 5 }
  ): ZaiFreeTierAdmission {
    const meter = new ZaiPlanMeter(
      PLAN_KEY,
      redis.asRedis(),
      fetchImpl as unknown as typeof fetch,
      () => NOW
    );
    const quota = new FreeTierRequestQuota(
      redis.asRedis(),
      quotaConfig,
      () => NOW,
      ZAI_FREE_TIER_KEYS
    );
    return new ZaiFreeTierAdmission(redis.asRedis(), quota, meter, {
      enabled: true,
      apiKey: PLAN_KEY,
      headroomPercent: 75,
    });
  }

  it('admits: upgrade lands on the coding plan and every REAL counter advances', async () => {
    const fetchImpl = fetchReturning(40);
    const admission = buildChain(fetchImpl);

    const result = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(result.personality.model).toBe(ZAI_FREE_TIER_MODEL);
    expect(result.personality.provider).toBe(AIProvider.ZaiCoding);
    expect(result.zaiSystemKey).toBe(PLAN_KEY);
    // Personal selection never consults the global default when admitted
    expect(vi.mocked(configResolver.getFreeDefaultConfig)).not.toHaveBeenCalled();

    // The meter hit the REAL endpoint seam: raw Authorization, no Bearer
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toContain('api.z.ai');
    expect(init.headers.Authorization).toBe(PLAN_KEY);

    // Quota counters advanced in Redis: daily global, per-user request, contention set
    expect(redis.strings.get(GLOBAL_KEY)).toBe('1');
    expect(
      redis.zsets.get(`${CACHE_KEY_PREFIXES.ZAI_FREE_TIER_USER_REQUESTS}guest-1`)?.has('req-1')
    ).toBe(true);
    expect(redis.zsets.get(ZAI_FREE_TIER_KEYS.activeKey)?.has('guest-1')).toBe(true);

    // The meter mirrored its reading for /admin usage
    const snapshot = JSON.parse(redis.strings.get(ZAI_PLAN_METER_SNAPSHOT_KEY) ?? '{}') as {
      tighterWindowConsumedPct?: number;
    };
    expect(snapshot.tighterWindowConsumedPct).toBe(40);
  });

  it('caches the meter reading across admissions (one fetch, both admitted)', async () => {
    const fetchImpl = fetchReturning(40);
    const admission = buildChain(fetchImpl);

    const first = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );
    const second = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-2',
      'req-2'
    );

    expect(first.personality.model).toBe(ZAI_FREE_TIER_MODEL);
    expect(second.personality.model).toBe(ZAI_FREE_TIER_MODEL);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(redis.strings.get(GLOBAL_KEY)).toBe('2');
  });

  it('headroom past the threshold closes the gate; the cascade lands on the global free default', async () => {
    const fetchImpl = fetchReturning(80); // ≥ 75% headroom
    const admission = buildChain(fetchImpl);

    const result = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(result.personality.model).toBe('gemma/fallback:free');
    expect(result.zaiSystemKey).toBeUndefined();
    // Headroom denial happens BEFORE the quota — no counter bleed
    expect(redis.strings.get(GLOBAL_KEY)).toBeUndefined();
    expect(await redis.zcard(`${CACHE_KEY_PREFIXES.ZAI_FREE_TIER_USER_REQUESTS}guest-1`)).toBe(0);
  });

  it('kill switch blocks before the meter is ever consulted', async () => {
    const fetchImpl = fetchReturning(10);
    const admission = buildChain(fetchImpl);
    await redis.set(ZAI_FREE_TIER_KILL_SWITCH_KEY, '1');

    const result = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(result.personality.model).toBe('gemma/fallback:free');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('window-exhausted cooldown blocks before the meter, same as the kill switch', async () => {
    // The two blocking flags share checkBlockingFlags today; this keeps the
    // exhausted-cooldown seam covered if a refactor ever splits them.
    const fetchImpl = fetchReturning(10);
    const admission = buildChain(fetchImpl);
    await redis.set(ZAI_FREE_TIER_EXHAUSTED_KEY, '1');

    const result = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(result.personality.model).toBe('gemma/fallback:free');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exhausted daily budget denies via the REAL quota and the counter holds', async () => {
    const fetchImpl = fetchReturning(40);
    const admission = buildChain(fetchImpl);
    await redis.set(GLOBAL_KEY, '3'); // globalDailyBudget = 3

    const result = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(result.personality.model).toBe('gemma/fallback:free');
    expect(redis.strings.get(GLOBAL_KEY)).toBe('3');
  });

  it('meter endpoint failure fails OPEN — static caps alone still admit', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('endpoint down'));
    const admission = buildChain(fetchImpl);

    const result = await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(result.personality.model).toBe(ZAI_FREE_TIER_MODEL);
    expect(result.zaiSystemKey).toBe(PLAN_KEY);
  });

  it('same-requestId retry: per-user count is idempotent; the global counter double-counts', async () => {
    // The per-user ZSET dedups by requestId (retry-safe); the global daily
    // counter is a plain INCR with no idempotency key — the over-count fails
    // SAFE (guests shut off early, the plan never overspends). Tracked in
    // backlog/cold/follow-ups.md; this pins CURRENT behavior so a fix there
    // must consciously update this expectation.
    //
    // Quota config is loosened so the retry is ALLOWED (windowCap > 1): under
    // the default tight config the per-user cap denies the retry first — the
    // double-count only occurs when a retried request passes the user check.
    const fetchImpl = fetchReturning(40);
    const admission = buildChain(fetchImpl, {
      globalDailyBudget: 100,
      windowMinutes: 1440,
      minPerWindow: 1,
      maxPerWindow: 5,
    });

    await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );
    await applyGuestModeOverrides(
      { configResolver, zaiFreeTierAdmission: admission },
      PERSONAL_ZAI,
      'guest-1',
      'req-1'
    );

    expect(await redis.zcard(`${CACHE_KEY_PREFIXES.ZAI_FREE_TIER_USER_REQUESTS}guest-1`)).toBe(1);
    expect(redis.strings.get(GLOBAL_KEY)).toBe('2');
  });
});
