import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  ZAI_FREE_TIER_KILL_SWITCH_KEY,
  ZAI_FREE_TIER_EXHAUSTED_KEY,
} from '@tzurot/common-types/constants/redis-keys';
import { ZaiFreeTierAdmission, logZaiFreeTierBootCoherence } from './ZaiFreeTierAdmission.js';
import type { FreeTierRequestQuota } from './FreeTierRequestQuota.js';
import type { ZaiPlanMeter, ZaiPlanReading } from './ZaiPlanMeter.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function redisWithFlags(flags: Partial<Record<string, boolean>> = {}): Redis {
  return {
    exists: vi.fn((key: string) => Promise.resolve(flags[key] === true ? 1 : 0)),
  } as unknown as Redis;
}

function quotaAllowing(allowed: boolean): FreeTierRequestQuota {
  return {
    tryConsume: vi.fn().mockResolvedValue({ allowed, reason: allowed ? 'ok' : 'user' }),
  } as unknown as FreeTierRequestQuota;
}

function meterAt(reading: ZaiPlanReading | null): ZaiPlanMeter {
  return { getReading: vi.fn().mockResolvedValue(reading) } as unknown as ZaiPlanMeter;
}

function reading(pct: number): ZaiPlanReading {
  return { tighterWindowConsumedPct: pct, resetAt: null, fetchedAt: new Date(0) };
}

const HEALTHY = { enabled: () => true, apiKey: 'sk-plan', headroomPercent: () => 75 };

describe('ZaiFreeTierAdmission', () => {
  it('admits when every gate passes, consuming the fair share', async () => {
    const quota = quotaAllowing(true);
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quota,
      meterAt(reading(29)),
      HEALTHY
    );

    const verdict = await admission.admit('user-1', 'req-1');

    expect(verdict).toEqual({ admitted: true, reason: 'ok' });
    expect(vi.mocked(quota.tryConsume)).toHaveBeenCalledWith('user-1', 'req-1');
  });

  it('denies as disabled when the flag is off — no gate work at all', async () => {
    const redis = redisWithFlags();
    const admission = new ZaiFreeTierAdmission(redis, quotaAllowing(true), meterAt(reading(0)), {
      ...HEALTHY,
      enabled: () => false,
    });

    expect(await admission.admit('u', 'r')).toEqual({ admitted: false, reason: 'disabled' });
    expect(vi.mocked(redis.exists)).not.toHaveBeenCalled();
  });

  it('denies as disabled when the key is missing even with the flag on', async () => {
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quotaAllowing(true),
      meterAt(null),
      {
        ...HEALTHY,
        apiKey: undefined,
      }
    );

    expect(await admission.admit('u', 'r')).toEqual({ admitted: false, reason: 'disabled' });
    expect(admission.systemKey()).toBeUndefined();
  });

  it('denies on the kill switch (account-problem codes set it; manual DEL resets)', async () => {
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags({ [ZAI_FREE_TIER_KILL_SWITCH_KEY]: true }),
      quotaAllowing(true),
      meterAt(reading(0)),
      HEALTHY
    );

    expect(await admission.admit('u', 'r')).toEqual({ admitted: false, reason: 'kill-switch' });
  });

  it('denies while the window-exhausted cooldown is live', async () => {
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags({ [ZAI_FREE_TIER_EXHAUSTED_KEY]: true }),
      quotaAllowing(true),
      meterAt(reading(0)),
      HEALTHY
    );

    expect(await admission.admit('u', 'r')).toEqual({
      admitted: false,
      reason: 'window-exhausted',
    });
  });

  it('denies on headroom when the plan window is at/past the threshold — quota never charged', async () => {
    const quota = quotaAllowing(true);
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quota,
      meterAt(reading(75)),
      HEALTHY
    );

    expect(await admission.admit('u', 'r')).toEqual({ admitted: false, reason: 'headroom' });
    expect(vi.mocked(quota.tryConsume)).not.toHaveBeenCalled();
  });

  it('a NULL meter reading leaves the headroom gate OPEN (static caps still bound volume)', async () => {
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quotaAllowing(true),
      meterAt(null),
      HEALTHY
    );

    expect(await admission.admit('u', 'r')).toEqual({ admitted: true, reason: 'ok' });
  });

  it('denies on the fair-share quota verdict', async () => {
    const admission = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quotaAllowing(false),
      meterAt(reading(10)),
      HEALTHY
    );

    expect(await admission.admit('u', 'r')).toEqual({ admitted: false, reason: 'quota' });
  });

  it('a Redis flag-check failure fails OPEN (not blocked)', async () => {
    const redis = {
      exists: vi.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Redis;
    const admission = new ZaiFreeTierAdmission(
      redis,
      quotaAllowing(true),
      meterAt(reading(10)),
      HEALTHY
    );

    expect(await admission.admit('u', 'r')).toEqual({ admitted: true, reason: 'ok' });
  });

  it('systemKey returns the coding-plan key only when enabled', () => {
    const enabled = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quotaAllowing(true),
      meterAt(null),
      HEALTHY
    );
    const disabled = new ZaiFreeTierAdmission(
      redisWithFlags(),
      quotaAllowing(true),
      meterAt(null),
      {
        ...HEALTHY,
        enabled: () => false,
      }
    );

    expect(enabled.systemKey()).toBe('sk-plan');
    expect(disabled.systemKey()).toBeUndefined();
  });
});

describe('logZaiFreeTierBootCoherence', () => {
  it('runs without throwing for every key state (flag now reads the runtime setting)', () => {
    expect(() => {
      logZaiFreeTierBootCoherence({ ZAI_CODING_API_KEY: undefined });
      logZaiFreeTierBootCoherence({ ZAI_CODING_API_KEY: 'k' });
      logZaiFreeTierBootCoherence({});
    }).not.toThrow();
  });
});
