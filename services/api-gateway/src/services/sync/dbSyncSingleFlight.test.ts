/** Tests for dbSyncSingleFlight.ts. */

import { describe, it, expect, vi } from 'vitest';
import {
  DB_SYNC_SINGLE_FLIGHT_KEY,
  DB_SYNC_SINGLE_FLIGHT_TTL_MS,
  DbSyncSingleFlightUnavailableError,
  acquireDbSyncSingleFlight,
  releaseDbSyncSingleFlight,
  type DbSyncSingleFlightRedis,
} from './dbSyncSingleFlight.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

/** Minimal SET-PX-NX / GET / DEL double over one in-memory slot — no real
 *  TTL expiry (tests never wait one out). */
function makeFakeRedis(
  initial: string | null = null
): DbSyncSingleFlightRedis & { slot: () => string | null } {
  let value = initial;
  const set = vi.fn(async (_key: string, val: string, _px: string, _ttl: number, _nx: string) => {
    if (value !== null) {
      return null;
    }
    value = val;
    return 'OK';
  }) as unknown as DbSyncSingleFlightRedis['set'];
  const get = vi.fn(async () => value) as unknown as DbSyncSingleFlightRedis['get'];
  const del = vi.fn(async () => {
    const had = value !== null;
    value = null;
    return had ? 1 : 0;
  }) as unknown as DbSyncSingleFlightRedis['del'];
  return { set, get, del, slot: () => value };
}

describe('acquireDbSyncSingleFlight', () => {
  it('returns a token and sets the key when absent', async () => {
    const redis = makeFakeRedis(null);
    const token = await acquireDbSyncSingleFlight(redis);
    expect(token).not.toBeNull();
    expect(redis.set).toHaveBeenCalledWith(
      DB_SYNC_SINGLE_FLIGHT_KEY,
      token,
      'PX',
      DB_SYNC_SINGLE_FLIGHT_TTL_MS,
      'NX'
    );
    expect(redis.slot()).toBe(token);
  });

  it('returns null when the key is already held', async () => {
    const redis = makeFakeRedis('someone-elses-token');
    const token = await acquireDbSyncSingleFlight(redis);
    expect(token).toBeNull();
    expect(redis.slot()).toBe('someone-elses-token');
  });

  it('mints a different token on every call', async () => {
    const redis1 = makeFakeRedis(null);
    const redis2 = makeFakeRedis(null);
    const token1 = await acquireDbSyncSingleFlight(redis1);
    const token2 = await acquireDbSyncSingleFlight(redis2);
    expect(token1).not.toBe(token2);
  });

  it('throws DbSyncSingleFlightUnavailableError when redis.set rejects', async () => {
    const redis = {
      set: vi.fn().mockRejectedValue(new Error('connection reset')),
      get: vi.fn(),
      del: vi.fn(),
    } satisfies DbSyncSingleFlightRedis;

    await expect(acquireDbSyncSingleFlight(redis)).rejects.toBeInstanceOf(
      DbSyncSingleFlightUnavailableError
    );
  });

  it('carries the original error as `cause`', async () => {
    const original = new Error('connection reset');
    const redis = {
      set: vi.fn().mockRejectedValue(original),
      get: vi.fn(),
      del: vi.fn(),
    } satisfies DbSyncSingleFlightRedis;
    await expect(acquireDbSyncSingleFlight(redis)).rejects.toMatchObject({ cause: original });
  });
});

describe('releaseDbSyncSingleFlight', () => {
  it('deletes the key when it still holds this token', async () => {
    const redis = makeFakeRedis('my-token');
    await releaseDbSyncSingleFlight(redis, 'my-token');
    expect(redis.del).toHaveBeenCalledWith(DB_SYNC_SINGLE_FLIGHT_KEY);
    expect(redis.slot()).toBeNull();
  });

  it('does NOT delete when the stored token differs (another sync took it)', async () => {
    const redis = makeFakeRedis('someone-elses-token');
    await releaseDbSyncSingleFlight(redis, 'my-token');
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.slot()).toBe('someone-elses-token');
  });

  it('does NOT delete when the key is absent (already expired/released)', async () => {
    const redis = makeFakeRedis(null);
    await releaseDbSyncSingleFlight(redis, 'my-token');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('never throws when redis.get rejects', async () => {
    const redis = {
      set: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      del: vi.fn(),
    } satisfies DbSyncSingleFlightRedis;

    await expect(releaseDbSyncSingleFlight(redis, 'my-token')).resolves.toBeUndefined();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('never throws when redis.del rejects', async () => {
    const redis = {
      set: vi.fn(),
      get: vi.fn().mockResolvedValue('my-token'),
      del: vi.fn().mockRejectedValue(new Error('redis down')),
    } satisfies DbSyncSingleFlightRedis;

    await expect(releaseDbSyncSingleFlight(redis, 'my-token')).resolves.toBeUndefined();
  });
});
