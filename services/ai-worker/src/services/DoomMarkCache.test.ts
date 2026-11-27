import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

import { DoomMarkCache, type DoomMarkCheckResult } from './DoomMarkCache.js';

const FIXED_NOW_MS = 1_777_500_000_000;

/** Minimal concrete subclass exposing the protected mark/check/clear. */
class TestCache extends DoomMarkCache {
  constructor(redis: Redis) {
    super(redis, {
      keyPrefix: 'test:prefix:',
      defaultTtlSeconds: 900,
      logNoun: 'test-doom',
      loggerLabel: 'TestCache',
      logTimestampField: 'testAtIso',
      logFailureSuffix: 'test-suffix',
    });
  }
  doMark(cacheKeyId: string, ttlSeconds?: number): Promise<void> {
    return this.mark({ cacheKeyId, ttlSeconds });
  }
  doCheck(cacheKeyId: string): Promise<DoomMarkCheckResult> {
    return this.check({ cacheKeyId });
  }
  doClear(cacheKeyId: string): Promise<void> {
    return this.clear({ cacheKeyId });
  }
}

describe('DoomMarkCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let cache: TestCache;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_MS);
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    };
    cache = new TestCache(mockRedis as unknown as Redis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('mark', () => {
    it('builds the key from keyPrefix + cacheKeyId', async () => {
      await cache.doMark('user:42');
      expect(mockRedis.setex.mock.calls[0][0]).toBe('test:prefix:user:42');
    });

    it('applies the config default TTL when the caller omits one', async () => {
      await cache.doMark('user:42');
      expect(mockRedis.setex.mock.calls[0][1]).toBe(900);
    });

    it('clamps a sub-minimum TTL up to 60s', async () => {
      await cache.doMark('user:42', 5);
      expect(mockRedis.setex.mock.calls[0][1]).toBe(60);
    });

    it('clamps an over-maximum TTL down to 24h', async () => {
      await cache.doMark('user:42', 7 * 24 * 3600);
      expect(mockRedis.setex.mock.calls[0][1]).toBe(86_400);
    });

    it('passes an in-range TTL through unchanged', async () => {
      await cache.doMark('user:42', 3600);
      expect(mockRedis.setex.mock.calls[0][1]).toBe(3600);
    });

    it('stores {ts, ttl} JSON with the post-clamp TTL', async () => {
      await cache.doMark('user:42', 5);
      expect(JSON.parse(mockRedis.setex.mock.calls[0][2])).toEqual({
        ts: FIXED_NOW_MS,
        ttl: 60,
      });
    });

    it('is a no-op for an empty cacheKeyId', async () => {
      await cache.doMark('');
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('logs the configured noun and timestamp field', async () => {
      await cache.doMark('user:42');
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          cacheKeyId: 'user:42',
          ttlSeconds: 900,
          testAtIso: new Date(FIXED_NOW_MS).toISOString(),
        },
        'Cached test-doom state'
      );
    });

    it('warns with the capitalized noun when the write fails', async () => {
      mockRedis.setex.mockRejectedValue(new Error('down'));
      await cache.doMark('user:42');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKeyId: 'user:42' }),
        'Test-doom cache write failed — test-suffix'
      );
    });
  });

  describe('check', () => {
    it('reads the prefixed key and round-trips a stored {ts, ttl} value', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: FIXED_NOW_MS - 100_000, ttl: 900 }));
      const result = await cache.doCheck('user:42');
      expect(mockRedis.get).toHaveBeenCalledWith('test:prefix:user:42');
      expect(result).toEqual({ active: true, atMs: FIXED_NOW_MS - 100_000, ttlSeconds: 800 });
    });

    it('returns inactive on a miss, malformed value, or empty id', async () => {
      expect(await cache.doCheck('user:42')).toEqual({ active: false });
      mockRedis.get.mockResolvedValue('garbage');
      expect(await cache.doCheck('user:42')).toEqual({ active: false });
      mockRedis.get.mockClear();
      expect(await cache.doCheck('')).toEqual({ active: false });
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('degrades open and warns with the noun when Redis throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('down'));
      expect(await cache.doCheck('user:42')).toEqual({ active: false });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKeyId: 'user:42' }),
        'Test-doom cache read failed — test-suffix'
      );
    });
  });

  describe('clear', () => {
    it('deletes the prefixed key and logs the noun', async () => {
      await cache.doClear('user:42');
      expect(mockRedis.del).toHaveBeenCalledWith('test:prefix:user:42');
      expect(mockLogger.info).toHaveBeenCalledWith(
        { cacheKeyId: 'user:42' },
        'Cleared test-doom state (wallet key updated)'
      );
    });

    it('does not log a clear when nothing was deleted', async () => {
      mockRedis.del.mockResolvedValue(0);
      await cache.doClear('user:42');
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('warns with the noun when Redis throws', async () => {
      mockRedis.del.mockRejectedValue(new Error('down'));
      await cache.doClear('user:42');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKeyId: 'user:42' }),
        'Test-doom cache clear failed — TTL remains the backstop'
      );
    });
  });
});
