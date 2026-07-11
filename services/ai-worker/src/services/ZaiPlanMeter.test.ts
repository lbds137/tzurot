import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { ZAI_PLAN_METER_SNAPSHOT_KEY } from '@tzurot/common-types/constants/redis-keys';
import { ZaiPlanMeter } from './ZaiPlanMeter.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/** Probe-verified payload shape (live plan probe): limits[] mixes entry types. */
function quotaBody(): unknown {
  return {
    code: 200,
    msg: 'Operation successful',
    success: true,
    data: {
      level: 'lite',
      limits: [
        { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 0, nextResetTime: 1_785_149_130_995 },
        {
          type: 'TOKENS_LIMIT',
          unit: 3,
          number: 5,
          percentage: 29,
          nextResetTime: 1_783_778_994_612,
        },
        {
          type: 'TOKENS_LIMIT',
          unit: 6,
          number: 1,
          percentage: 2,
          nextResetTime: 1_784_371_530_982,
        },
      ],
    },
  };
}

function okFetch(body: unknown = quotaBody()): typeof fetch {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }) as never;
}

function redisStub(): Redis {
  return { set: vi.fn().mockResolvedValue('OK') } as unknown as Redis;
}

describe('ZaiPlanMeter', () => {
  let clock: number;
  const now = (): number => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('returns null without ever fetching when no key is configured', async () => {
    const fetchImpl = okFetch();
    const meter = new ZaiPlanMeter(undefined, undefined, fetchImpl, now);

    expect(await meter.getReading()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the key as a RAW Authorization header (no Bearer prefix)', async () => {
    const fetchImpl = okFetch();
    const meter = new ZaiPlanMeter('sk-plan-key', undefined, fetchImpl, now);

    await meter.getReading();

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.z.ai/api/monitor/usage/quota/limit',
      expect.objectContaining({ headers: { Authorization: 'sk-plan-key' } })
    );
  });

  it('reports the MOST consumed TOKENS_LIMIT window (ignoring TIME_LIMIT rows)', async () => {
    const meter = new ZaiPlanMeter('key', undefined, okFetch(), now);

    const reading = await meter.getReading();

    expect(reading?.tighterWindowConsumedPct).toBe(29);
    expect(reading?.resetAt).toEqual(new Date(1_783_778_994_612));
  });

  it('caches the reading — a second call inside the TTL does not refetch', async () => {
    const fetchImpl = okFetch();
    const meter = new ZaiPlanMeter('key', undefined, fetchImpl, now);

    await meter.getReading();
    clock += 60_000;
    await meter.getReading();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache TTL elapses', async () => {
    const fetchImpl = okFetch();
    const meter = new ZaiPlanMeter('key', undefined, fetchImpl, now);

    await meter.getReading();
    clock += 6 * 60_000;
    await meter.getReading();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails soft to null on HTTP errors and retries after the failure backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(quotaBody()) });
    const meter = new ZaiPlanMeter('key', undefined, fetchImpl as never, now);

    expect(await meter.getReading()).toBeNull();
    // Inside the failure backoff: still null, no refetch storm.
    clock += 10_000;
    expect(await meter.getReading()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Past the backoff: recovers.
    clock += 60_000;
    expect((await meter.getReading())?.tighterWindowConsumedPct).toBe(29);
  });

  it('fails soft to null when the semi-stable endpoint shape drifts', async () => {
    const meter = new ZaiPlanMeter(
      'key',
      undefined,
      okFetch({ data: { totally: 'different' } }),
      now
    );

    expect(await meter.getReading()).toBeNull();
  });

  it('mirrors a successful reading to the Redis snapshot for /admin usage', async () => {
    const redis = redisStub();
    const meter = new ZaiPlanMeter('key', redis, okFetch(), now);

    await meter.getReading();

    const setMock = vi.mocked(redis.set);
    expect(setMock).toHaveBeenCalledWith(
      ZAI_PLAN_METER_SNAPSHOT_KEY,
      expect.stringContaining('"tighterWindowConsumedPct":29'),
      'EX',
      expect.any(Number)
    );
  });
});
