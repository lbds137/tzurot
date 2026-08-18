import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getRailwayRedisUrl, createInspectorRedis } from './bullmqConnection.js';
import { formatTtl, probeRedisKey, inspectRedisKey, type RedisKeyReport } from './redis-key.js';

vi.mock('./bullmqConnection.js', () => ({
  getRailwayRedisUrl: vi.fn(),
  createInspectorRedis: vi.fn(),
  describeRedisTarget: (url: string) => new URL(url).host,
}));
import type { Environment } from '../utils/env-runner.js';

type RedisLike = ReturnType<typeof createInspectorRedis>;

/**
 * A stub standing in for ioredis. Only the commands the probe issues are
 * defined; anything else surfaces as an undefined-is-not-a-function failure
 * rather than a silently wrong report.
 */
function stubRedis(overrides: Record<string, unknown>): RedisLike {
  return overrides as unknown as RedisLike;
}

const TARGET = {
  env: 'prod',
  host: 'crossover.proxy.rlwy.net:46994',
  key: 'openrouter:models',
} satisfies { env: Environment; host: string; key: string };

describe('formatTtl', () => {
  it('distinguishes the two negative sentinels, which mean opposite things', () => {
    // -2 is "no such key"; -1 is "the key exists and never expires". They
    // differ by one character and are trivially misread as each other.
    expect(formatTtl(-2)).toBe('absent');
    expect(formatTtl(-1)).toBe('no expiry');
  });

  it('renders a live TTL with an hours hint', () => {
    expect(formatTtl(85205)).toBe('85205s (~23.7h)');
  });
});

describe('probeRedisKey', () => {
  it('reports an absent key without attempting to read a value', async () => {
    const get = vi.fn();
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(0),
        type: vi.fn().mockResolvedValue('none'),
        ttl: vi.fn().mockResolvedValue(-2),
        get,
      }),
      TARGET
    );

    expect(report.exists).toBe(false);
    expect(report.ttl).toBe(-2);
    expect(report.size).toBeUndefined();
    // A missing key has no value to fetch; issuing the read anyway would be a
    // wasted round trip against a remote proxy.
    expect(get).not.toHaveBeenCalled();
  });

  it('carries the resolved host into the report', async () => {
    // The host is the whole point of the command: an absent-key result is
    // uninterpretable without knowing which instance answered.
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(0),
        type: vi.fn().mockResolvedValue('none'),
        ttl: vi.fn().mockResolvedValue(-2),
      }),
      TARGET
    );

    expect(report.host).toBe('crossover.proxy.rlwy.net:46994');
    expect(report.env).toBe('prod');
  });

  it('measures a string value and counts its elements when it parses as a JSON array', async () => {
    const models = JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('string'),
        ttl: vi.fn().mockResolvedValue(85205),
        get: vi.fn().mockResolvedValue(models),
      }),
      TARGET
    );

    expect(report.size).toBe(models.length);
    expect(report.sizeUnit).toBe('bytes');
    expect(report.jsonArrayLength).toBe(3);
  });

  it('reports BYTES, not UTF-16 code units, for a multi-byte value', async () => {
    // 'é' is 2 bytes in UTF-8 but 1 JS code unit; the emoji is 4 bytes and a
    // surrogate PAIR, so `value.length` would report 5 where Redis stores 8.
    // Pins the distinction that makes the 'bytes' label truthful.
    const multibyte = 'café🎉';
    expect(multibyte.length).toBe(6);

    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('string'),
        ttl: vi.fn().mockResolvedValue(-1),
        get: vi.fn().mockResolvedValue(multibyte),
      }),
      TARGET
    );

    expect(report.size).toBe(Buffer.byteLength(multibyte, 'utf8'));
    expect(report.size).toBeGreaterThan(multibyte.length);
    expect(report.sizeUnit).toBe('bytes');
  });

  it('truncates the sample so a hundreds-of-KB blob cannot flood the terminal', async () => {
    const huge = 'x'.repeat(5000);
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('string'),
        ttl: vi.fn().mockResolvedValue(10),
        get: vi.fn().mockResolvedValue(huge),
      }),
      TARGET
    );

    expect(report.size).toBe(5000);
    expect(report.sample?.[0]).toHaveLength(200);
  });

  it('leaves jsonArrayLength unset for a non-JSON string', async () => {
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('string'),
        ttl: vi.fn().mockResolvedValue(-1),
        get: vi.fn().mockResolvedValue('maintenance-on'),
      }),
      TARGET
    );

    expect(report.jsonArrayLength).toBeUndefined();
    expect(report.sample).toEqual(['maintenance-on']);
  });

  it('leaves jsonArrayLength unset for JSON that is an object rather than an array', async () => {
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('string'),
        ttl: vi.fn().mockResolvedValue(-1),
        get: vi.fn().mockResolvedValue('{"a":1}'),
      }),
      TARGET
    );

    expect(report.jsonArrayLength).toBeUndefined();
  });

  it('counts members for a list', async () => {
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('list'),
        ttl: vi.fn().mockResolvedValue(-1),
        llen: vi.fn().mockResolvedValue(42),
        lrange: vi.fn().mockResolvedValue(['one', 'two']),
      }),
      TARGET
    );

    expect(report.size).toBe(42);
    expect(report.sizeUnit).toBe('members');
    expect(report.sample).toEqual(['one', 'two']);
  });

  it('counts members for a set via scard/sscan', async () => {
    const scard = vi.fn().mockResolvedValue(3);
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('set'),
        ttl: vi.fn().mockResolvedValue(-1),
        scard,
        sscan: vi.fn().mockResolvedValue(['0', ['alpha', 'beta']]),
      }),
      TARGET
    );

    expect(report.size).toBe(3);
    expect(report.sizeUnit).toBe('members');
    expect(report.sample).toEqual(['alpha', 'beta']);
    // Pins the cardinality command: zcard here would report the wrong count.
    expect(scard).toHaveBeenCalledWith(TARGET.key);
  });

  it('counts members for a zset via zcard/zrange', async () => {
    const zrange = vi.fn().mockResolvedValue(['first', 'second']);
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('zset'),
        ttl: vi.fn().mockResolvedValue(-1),
        zcard: vi.fn().mockResolvedValue(9),
        zrange,
      }),
      TARGET
    );

    expect(report.size).toBe(9);
    expect(report.sizeUnit).toBe('members');
    expect(report.sample).toEqual(['first', 'second']);
    // zrange's end index is INCLUSIVE, so the bound is SAMPLE_MEMBERS - 1.
    // Dropping the -1 would silently return one extra member.
    expect(zrange).toHaveBeenCalledWith(TARGET.key, 0, 4);
  });

  it('counts members for a hash via hscan', async () => {
    const report = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('hash'),
        ttl: vi.fn().mockResolvedValue(-1),
        hlen: vi.fn().mockResolvedValue(7),
        hscan: vi.fn().mockResolvedValue(['0', ['field', 'value']]),
      }),
      TARGET
    );

    expect(report.size).toBe(7);
    expect(report.sizeUnit).toBe('members');
    expect(report.sample).toEqual(['field', 'value']);
  });

  it('reports an unknown type without a size rather than throwing', async () => {
    const report: RedisKeyReport = await probeRedisKey(
      stubRedis({
        exists: vi.fn().mockResolvedValue(1),
        type: vi.fn().mockResolvedValue('stream'),
        ttl: vi.fn().mockResolvedValue(-1),
      }),
      TARGET
    );

    expect(report.exists).toBe(true);
    expect(report.type).toBe('stream');
    expect(report.size).toBeUndefined();
  });
});

/**
 * The CLI entry point, which the helper-level tests structurally cannot reach:
 * they take an already-constructed client, so the wiring
 * (resolve → connect → probe → render → quit) is exactly what they miss —
 * including whether a failure anywhere in it produces a readable line instead
 * of an unhandled rejection.
 */
describe('inspectRedisKey', () => {
  const quit = vi.fn().mockResolvedValue('OK');

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getRailwayRedisUrl).mockReset();
    vi.mocked(createInspectorRedis).mockReset();
    quit.mockClear();
    process.exitCode = undefined;
  });

  it('reports a readable failure and exits nonzero when Redis is unreachable', async () => {
    // The whole point of the catch: an unreachable Redis is a routine outcome
    // for a diagnostic tool, and the CLI's top-level handler would otherwise
    // rethrow this as a raw stack trace.
    vi.mocked(getRailwayRedisUrl).mockResolvedValue('redis://proxy.example:1234');
    vi.mocked(createInspectorRedis).mockReturnValue(
      stubRedis({
        exists: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        type: vi.fn().mockResolvedValue('none'),
        ttl: vi.fn().mockResolvedValue(-2),
        quit,
      })
    );

    await inspectRedisKey({ env: 'prod', key: 'openrouter:models' });

    expect(process.exitCode).toBe(1);
    const printed = vi.mocked(console.error).mock.calls.flat().join('\n');
    expect(printed).toContain('Failed to inspect key');
    expect(printed).toContain('ECONNREFUSED');
  });

  it('closes the connection even when the probe throws', async () => {
    vi.mocked(getRailwayRedisUrl).mockResolvedValue('redis://proxy.example:1234');
    vi.mocked(createInspectorRedis).mockReturnValue(
      stubRedis({
        exists: vi.fn().mockRejectedValue(new Error('boom')),
        type: vi.fn().mockResolvedValue('none'),
        ttl: vi.fn().mockResolvedValue(-2),
        quit,
      })
    );

    await inspectRedisKey({ env: 'dev', key: 'k' });

    expect(quit).toHaveBeenCalled();
  });

  it('exits nonzero without connecting when the URL cannot be resolved', async () => {
    vi.mocked(getRailwayRedisUrl).mockResolvedValue(null);

    await inspectRedisKey({ env: 'prod', key: 'k' });

    expect(process.exitCode).toBe(1);
    expect(createInspectorRedis).not.toHaveBeenCalled();
  });

  it('emits parseable JSON carrying the host under --json', async () => {
    vi.mocked(getRailwayRedisUrl).mockResolvedValue('redis://proxy.example:1234');
    vi.mocked(createInspectorRedis).mockReturnValue(
      stubRedis({
        exists: vi.fn().mockResolvedValue(0),
        type: vi.fn().mockResolvedValue('none'),
        ttl: vi.fn().mockResolvedValue(-2),
        quit,
      })
    );

    await inspectRedisKey({ env: 'prod', key: 'missing', json: true });

    const stdout = vi.mocked(console.log).mock.calls.flat().join('\n');
    // Must parse: the fingerprint goes to stderr precisely so this stays clean.
    const parsed = JSON.parse(stdout) as RedisKeyReport;
    expect(parsed.exists).toBe(false);
    expect(parsed.host).toBe('proxy.example:1234');
  });
});
