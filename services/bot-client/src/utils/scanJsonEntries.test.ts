import { describe, it, expect, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { scanJsonEntries, DEFAULT_SCAN_COUNT } from './scanJsonEntries.js';

/**
 * Build a fake Redis whose SCAN walks the given cursor pages. Each page is
 * `[nextCursor, keys]`, exactly the tuple ioredis returns, so the loop under
 * test sees real multi-page pagination rather than a single-shot stub.
 */
function fakeRedis(pages: Array<[string, string[]]>, store: Record<string, string | null>): Redis {
  let call = 0;
  return {
    scan: vi.fn().mockImplementation(() => Promise.resolve(pages[call++])),
    mget: vi
      .fn()
      .mockImplementation((...keys: string[]) => Promise.resolve(keys.map(k => store[k] ?? null))),
  } as unknown as Redis;
}

describe('scanJsonEntries', () => {
  it('walks every cursor page and returns each parsed value', async () => {
    // Two pages: the cursor only returns to '0' on the second, so a loop that
    // stopped after one iteration would return half the entries.
    const redis = fakeRedis(
      [
        ['42', ['p:a', 'p:b']],
        ['0', ['p:c']],
      ],
      { 'p:a': '{"n":1}', 'p:b': '{"n":2}', 'p:c': '{"n":3}' }
    );

    const found = await scanJsonEntries(redis, 'p:', (_key, raw) =>
      raw === null ? null : (JSON.parse(raw) as { n: number })
    );

    expect(found).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('skips entries the parser rejects without aborting the scan', async () => {
    // The failure this guards: one unusable entry must not block recovery of
    // every other in-flight job.
    const redis = fakeRedis([['0', ['p:good', 'p:bad', 'p:also-good']]], {
      'p:good': '{"n":1}',
      'p:bad': 'not json',
      'p:also-good': '{"n":2}',
    });

    const found = await scanJsonEntries(redis, 'p:', (_key, raw) => {
      try {
        return raw === null ? null : (JSON.parse(raw) as { n: number });
      } catch {
        return null;
      }
    });

    expect(found).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('passes the key to the parser so callers can report which entry failed', async () => {
    const redis = fakeRedis([['0', ['p:x']]], { 'p:x': 'v' });
    const parse = vi.fn().mockReturnValue(null);

    await scanJsonEntries(redis, 'p:', parse);

    expect(parse).toHaveBeenCalledWith('p:x', 'v');
  });

  it('skips the MGET entirely on an empty page', async () => {
    // An empty page is normal mid-scan (SCAN gives no per-page guarantee);
    // calling MGET with zero keys is an ioredis error, not a no-op.
    const redis = fakeRedis(
      [
        ['7', []],
        ['0', ['p:a']],
      ],
      { 'p:a': '{"n":1}' }
    );

    const found = await scanJsonEntries(redis, 'p:', (_k, raw) =>
      raw === null ? null : (JSON.parse(raw) as { n: number })
    );

    expect(found).toEqual([{ n: 1 }]);
    expect(redis.mget).toHaveBeenCalledTimes(1);
  });

  it('scans the caller prefix with a wildcard and the default COUNT', async () => {
    const redis = fakeRedis([['0', []]], {});

    await scanJsonEntries(redis, 'singlejob:context:', () => null);

    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'singlejob:context:*',
      'COUNT',
      DEFAULT_SCAN_COUNT
    );
  });

  it('honors an explicit scan count', async () => {
    const redis = fakeRedis([['0', []]], {});

    await scanJsonEntries(redis, 'p:', () => null, 500);

    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'p:*', 'COUNT', 500);
  });
});
