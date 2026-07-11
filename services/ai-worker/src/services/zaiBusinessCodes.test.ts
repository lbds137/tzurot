import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import {
  ZAI_FREE_TIER_KILL_SWITCH_KEY,
  ZAI_FREE_TIER_EXHAUSTED_KEY,
} from '@tzurot/common-types/constants/redis-keys';
import { classifyZaiBusinessError, reactToZaiFreeTierFailure } from './zaiBusinessCodes.js';
import type { ZaiPlanMeter } from './ZaiPlanMeter.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function zaiError(code: number): Error {
  // The OpenAI client folds the JSON body into the error message.
  return new Error(`429 {"error":{"code":"${code}","message":"limit"}}`);
}

function redisStub(): Redis {
  return { set: vi.fn().mockResolvedValue('OK') } as unknown as Redis;
}

function meterWithReset(resetAt: Date | null): ZaiPlanMeter {
  return {
    getReading: vi
      .fn()
      .mockResolvedValue(
        resetAt === null ? null : { tighterWindowConsumedPct: 100, resetAt, fetchedAt: new Date() }
      ),
  } as unknown as ZaiPlanMeter;
}

describe('classifyZaiBusinessError', () => {
  it.each([1302, 1305, 1313])('classifies %i as busy', code => {
    expect(classifyZaiBusinessError(zaiError(code))).toBe('busy');
  });

  it.each([1308, 1310, 1316, 1317, 1318, 1319, 1320, 1321])(
    'classifies %i as window-exhausted',
    code => {
      expect(classifyZaiBusinessError(zaiError(code))).toBe('window-exhausted');
    }
  );

  it.each([1113, 1309])('classifies %i as account-problem', code => {
    expect(classifyZaiBusinessError(zaiError(code))).toBe('account-problem');
  });

  it('handles an unquoted numeric code field', () => {
    expect(classifyZaiBusinessError(new Error('{"code": 1308, "msg": "x"}'))).toBe(
      'window-exhausted'
    );
  });

  it('returns null for unknown codes and codeless errors', () => {
    expect(classifyZaiBusinessError(zaiError(9999))).toBeNull();
    expect(classifyZaiBusinessError(new Error('plain 429 too many requests'))).toBeNull();
    expect(classifyZaiBusinessError('not even an error')).toBeNull();
  });

  it('does not false-match bare numbers outside a code field', () => {
    expect(classifyZaiBusinessError(new Error('took 1308 ms and failed'))).toBeNull();
  });

  it('ignores a longer code rather than misreading its 4-digit prefix', () => {
    expect(classifyZaiBusinessError(zaiError(13080))).toBeNull();
  });
});

describe('reactToZaiFreeTierFailure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('busy and unclassified errors are no-ops', async () => {
    const redis = redisStub();

    await reactToZaiFreeTierFailure(redis, meterWithReset(null), zaiError(1302));
    await reactToZaiFreeTierFailure(redis, meterWithReset(null), new Error('boring'));

    expect(vi.mocked(redis.set)).not.toHaveBeenCalled();
  });

  it('account-problem trips the kill switch with NO TTL (manual reset only)', async () => {
    const redis = redisStub();

    await reactToZaiFreeTierFailure(redis, meterWithReset(null), zaiError(1113));

    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      ZAI_FREE_TIER_KILL_SWITCH_KEY,
      expect.any(String)
    );
  });

  it('window exhaustion sets the cooldown until the plan window resets', async () => {
    const redis = redisStub();
    const resetAt = new Date('2026-07-11T13:00:00Z'); // one hour out

    await reactToZaiFreeTierFailure(redis, meterWithReset(resetAt), zaiError(1310));

    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      ZAI_FREE_TIER_EXHAUSTED_KEY,
      expect.any(String),
      'EX',
      3600
    );
  });

  it('window exhaustion falls back to the default cooldown without a reset time', async () => {
    const redis = redisStub();

    await reactToZaiFreeTierFailure(redis, meterWithReset(null), zaiError(1316));

    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      ZAI_FREE_TIER_EXHAUSTED_KEY,
      expect.any(String),
      'EX',
      30 * 60
    );
  });

  it('caps a bogus far-future reset so the tier cannot be wedged for days', async () => {
    const redis = redisStub();
    const farFuture = new Date('2026-07-20T12:00:00Z');

    await reactToZaiFreeTierFailure(redis, meterWithReset(farFuture), zaiError(1308));

    expect(vi.mocked(redis.set)).toHaveBeenCalledWith(
      ZAI_FREE_TIER_EXHAUSTED_KEY,
      expect.any(String),
      'EX',
      8 * 60 * 60
    );
  });

  it('fails soft when Redis is down (the degrade path is not disturbed)', async () => {
    const redis = { set: vi.fn().mockRejectedValue(new Error('down')) } as unknown as Redis;

    await expect(
      reactToZaiFreeTierFailure(redis, meterWithReset(null), zaiError(1113))
    ).resolves.toBeUndefined();
  });
});
