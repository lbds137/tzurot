import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { RateLimitCache, deriveCacheKeyId, assertValidCacheKeyId } from './RateLimitCache.js';

// Frozen "now" for deterministic TTL math in clamping tests
const FIXED_NOW_MS = 1_777_500_000_000;

describe('RateLimitCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    ttl: ReturnType<typeof vi.fn>;
  };
  let cache: RateLimitCache;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_MS);
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      ttl: vi.fn().mockResolvedValue(-1),
    };
    cache = new RateLimitCache(mockRedis as unknown as Redis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('markRateLimited', () => {
    it('writes to Redis with plain-concatenation key + TTL', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000; // 1 hour from now
      await cache.markRateLimited({
        cacheKeyId: 'user:278863839632818186',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      // Cache key is opaque scope ID + model, no hashing layer.
      expect(key).toBe('ratelimit:openrouter:user:278863839632818186:z-ai/glm-4.5-air:free');
      expect(ttl).toBe(3600);
      expect(value).toBe(String(resetMs));
    });

    it('uses literal "system" for guest-mode / system-key fallback bucket', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      const [key] = mockRedis.setex.mock.calls[0];
      expect(key).toBe('ratelimit:openrouter:system:z-ai/glm-4.5-air:free');
    });

    it('skips write when reset is in the past', async () => {
      const resetMs = FIXED_NOW_MS - 1000;
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('clamps TTL to minimum 60s when reset is < 60s in the future', async () => {
      const resetMs = FIXED_NOW_MS + 30 * 1000; // 30s from now
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(60);
    });

    it('clamps TTL to maximum 24h when reset is far in the future', async () => {
      const resetMs = FIXED_NOW_MS + 30 * 24 * 3600 * 1000; // 30 days from now
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(86400);
    });

    it('does not throw when Redis setex throws (degraded write)', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Connection refused'));
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      await expect(
        cache.markRateLimited({
          cacheKeyId: 'system',
          model: 'z-ai/glm-4.5-air:free',
          resetTimestampMs: resetMs,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('isRateLimited', () => {
    it('returns false for missing key', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });

    it('returns rateLimited result with reset + inferred ttl for present key', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      mockRedis.get.mockResolvedValue(String(resetMs));
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      // ttlSeconds is computed from (resetMs - now), not queried from Redis —
      // saves a round-trip on every cache hit and avoids a GET/TTL race window.
      expect(result).toEqual({
        rateLimited: true,
        resetMs,
        ttlSeconds: 3600,
      });
      expect(mockRedis.ttl).not.toHaveBeenCalled();
    });

    it('returns false for malformed cache value (non-numeric)', async () => {
      mockRedis.get.mockResolvedValue('garbage');
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });

    it('returns false when Redis get throws (degraded read)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });

    it('returns false when cached resetMs has already passed (canonical-truth guard)', async () => {
      // The cached resetMs is the canonical truth. If GET succeeds but
      // resetMs is already in the past (e.g., a clock-skew window made the
      // cache linger past its real expiry), short-circuiting would block a
      // request the real provider would now accept.
      const expiredResetMs = FIXED_NOW_MS - 1000;
      mockRedis.get.mockResolvedValue(String(expiredResetMs));
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });
  });

  describe('cache key isolation', () => {
    it('uses different keys for different users (BYOK isolation)', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      await cache.markRateLimited({
        cacheKeyId: 'user:111111111111111111',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      await cache.markRateLimited({
        cacheKeyId: 'user:222222222222222222',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      const keyA = mockRedis.setex.mock.calls[0][0];
      const keyB = mockRedis.setex.mock.calls[1][0];
      expect(keyA).not.toBe(keyB);
    });

    it('isolates user buckets from the system bucket', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      await cache.markRateLimited({
        cacheKeyId: 'user:111111111111111111',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      const keyUser = mockRedis.setex.mock.calls[0][0];
      const keySystem = mockRedis.setex.mock.calls[1][0];
      expect(keyUser).not.toBe(keySystem);
    });

    it('uses different keys for different models', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
      });
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'google/gemma-4-31b-it:free',
        resetTimestampMs: resetMs,
      });
      const key1 = mockRedis.setex.mock.calls[0][0];
      const key2 = mockRedis.setex.mock.calls[1][0];
      expect(key1).not.toBe(key2);
    });
  });
});

describe('deriveCacheKeyId', () => {
  it('returns user:<userId> when BYOK key + userId both present', () => {
    expect(deriveCacheKeyId('any-byok-key-value', '278863839632818186')).toBe(
      'user:278863839632818186'
    );
  });

  it('returns "system" when userApiKey is undefined (guest mode)', () => {
    expect(deriveCacheKeyId(undefined, '278863839632818186')).toBe('system');
  });

  it('returns "system" when userApiKey is empty string (guest fallback)', () => {
    expect(deriveCacheKeyId('', '278863839632818186')).toBe('system');
  });

  it('returns "" (skip-cache) when BYOK key present but userId is empty (defensive)', () => {
    // Pooling an unknown BYOK caller into the 'system' bucket would cross
    // account boundaries. Empty-string is the cache-skip sentinel, recognized
    // by LLMInvoker.invokeWithRetry's `cacheKeyId.length > 0` guard.
    expect(deriveCacheKeyId('any-byok-key', '')).toBe('');
  });

  it('returns "system" when userApiKey is undefined and userId is empty', () => {
    // Guest mode + missing userId is still safe to pool into the system
    // bucket — the system key is shared across all guest-mode callers
    // anyway, so there's no cross-account leakage.
    expect(deriveCacheKeyId(undefined, '')).toBe('system');
  });
});

describe('assertValidCacheKeyId', () => {
  // The assertion is a runtime sentinel against future scope-extensions silently
  // breaking the `<prefix>:<id>:<model>` key shape via colon-collision in the
  // dynamic segment. It logs `warn` rather than throwing (cache is never a
  // correctness gate), so the contract being tested here is "never throws"
  // for either valid or invalid shapes — a future regression that escalates
  // to a throw would surface immediately in the bad-shape cases below.

  it('passes for the literal "system" scope', () => {
    expect(() => assertValidCacheKeyId('system')).not.toThrow();
  });

  it('passes for "user:<digits>" with a Discord snowflake', () => {
    expect(() => assertValidCacheKeyId('user:278863839632818186')).not.toThrow();
  });

  it('passes for the empty-string skip-cache sentinel', () => {
    expect(() => assertValidCacheKeyId('')).not.toThrow();
  });

  it('does not throw on a non-numeric user ID (warn-only contract — signals grammar drift)', () => {
    // A future contributor expanding the grammar to alphanumeric IDs without
    // updating VALID_CACHE_KEY_ID lands here.
    expect(() => assertValidCacheKeyId('user:alice')).not.toThrow();
  });

  it('does not throw on a colon in the dynamic segment (warn-only contract — the collision case this guards against)', () => {
    // `org:my-team:special` would corrupt the `<prefix>:<id>:<model>` key
    // shape — operator queries on `<prefix>:org:my-team:*` would clash with
    // legitimate `<prefix>:org:my-team:<model>` writes.
    expect(() => assertValidCacheKeyId('org:my-team:special')).not.toThrow();
  });

  it('does not throw on an unknown scope prefix entirely (warn-only contract)', () => {
    expect(() => assertValidCacheKeyId('account:12345')).not.toThrow();
  });
});
