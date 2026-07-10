import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { RateLimitCache, deriveCacheKeyId, assertValidCacheKeyId } from './RateLimitCache.js';

// Frozen "now" for deterministic TTL math in clamping tests
const FIXED_NOW_MS = 1_777_500_000_000;

/**
 * Default error context for tests that don't care about the cached
 * category/message replay path. Tests focusing on key shape, TTL math,
 * isolation, etc. can spread this into their `markRateLimited` calls
 * to avoid repeating the boilerplate. Tests that DO care about the
 * preserved category (e.g., the QUOTA_EXCEEDED replay path) override
 * these fields explicitly.
 */
const DEFAULT_ERROR_CTX = {
  category: ApiErrorCategory.RATE_LIMIT,
  userMessage: "I'm receiving too many requests right now. Please wait a moment and try again.",
  technicalMessage: 'Rate limit exceeded',
};

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
        ...DEFAULT_ERROR_CTX,
      });

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      // Cache key is opaque scope ID + model, no hashing layer.
      expect(key).toBe('ratelimit:openrouter:user:278863839632818186:z-ai/glm-4.5-air:free');
      expect(ttl).toBe(3600);
      // Value is JSON-encoded since the cache schema migration. Preserves
      // category + userMessage + technicalMessage for synthetic-error replay
      // at read time.
      expect(JSON.parse(value)).toEqual({
        resetMs,
        category: ApiErrorCategory.RATE_LIMIT,
        userMessage: DEFAULT_ERROR_CTX.userMessage,
        technicalMessage: DEFAULT_ERROR_CTX.technicalMessage,
      });
    });

    it('uses literal "system" for guest-mode / system-key fallback bucket', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
        ...DEFAULT_ERROR_CTX,
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
        ...DEFAULT_ERROR_CTX,
      });
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('clamps TTL to minimum 60s when reset is < 60s in the future', async () => {
      const resetMs = FIXED_NOW_MS + 30 * 1000; // 30s from now
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
        ...DEFAULT_ERROR_CTX,
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
        ...DEFAULT_ERROR_CTX,
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
          ...DEFAULT_ERROR_CTX,
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

    it('returns rateLimited result with full context for present JSON-shaped key', async () => {
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          resetMs,
          category: ApiErrorCategory.QUOTA_EXCEEDED,
          userMessage:
            "You've reached your API usage limit. Please add credits to your OpenRouter account or wait until your limit resets.",
          technicalMessage: 'Rate limit exceeded: free-models-per-day-high-balance',
        })
      );
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      // ttlSeconds is computed from (resetMs - now), not queried from Redis —
      // saves a round-trip on every cache hit and avoids a GET/TTL race window.
      // Category + userMessage + technicalMessage are preserved across the
      // cache so the synthetic short-circuit at read time can replay the
      // exact context from the original 429 (e.g., QUOTA_EXCEEDED's
      // credits-and-reset-window message instead of the generic
      // RATE_LIMIT "too many requests" string).
      expect(result).toEqual({
        rateLimited: true,
        resetMs,
        ttlSeconds: 3600,
        category: ApiErrorCategory.QUOTA_EXCEEDED,
        userMessage:
          "You've reached your API usage limit. Please add credits to your OpenRouter account or wait until your limit resets.",
        technicalMessage: 'Rate limit exceeded: free-models-per-day-high-balance',
      });
      expect(mockRedis.ttl).not.toHaveBeenCalled();
    });

    it('returns false for legacy numeric-only cache entries', async () => {
      // Pre-JSON-migration cache shape stored just `String(resetMs)`. Those
      // entries naturally expire within 24h via the TTL clamp, so by the time
      // this code runs there should be none in production. If a stray legacy
      // entry survives, the read fails closed (rateLimited: false) and the
      // caller falls through to a real upstream call — strictly safer than
      // synthesizing a generic-message short-circuit on an entry that's about
      // to expire anyway.
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      mockRedis.get.mockResolvedValue(String(resetMs));
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });

    it('falls back to RATE_LIMIT category when persisted category is unknown (forward-deploy + rollback safety)', async () => {
      // Guards the forward/backward deployment skew scenario: a future
      // ai-worker adds a new ApiErrorCategory, writes it into the cache,
      // then rollback reads the unknown string. Without the runtime
      // membership check, the unknown value flows unchecked through
      // ApiError and into downstream consumers that switch on category.
      // The fallback uses RATE_LIMIT since we know the entry was written
      // for a 429-class event; the persisted user/technical messages are
      // still used verbatim so the user sees the original wording.
      const resetMs = FIXED_NOW_MS + 3600 * 1000;
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          resetMs,
          category: 'category_from_the_future',
          userMessage: "Future version's user message — preserved verbatim.",
          technicalMessage: 'Future version technical detail',
        })
      );
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({
        rateLimited: true,
        resetMs,
        ttlSeconds: 3600,
        category: ApiErrorCategory.RATE_LIMIT,
        userMessage: "Future version's user message — preserved verbatim.",
        technicalMessage: 'Future version technical detail',
      });
    });

    it('returns false for malformed cache value (non-JSON)', async () => {
      mockRedis.get.mockResolvedValue('garbage');
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });

    it('returns false for invalid JSON that starts with `{`', async () => {
      // Reaches the JSON.parse catch path: input passes the startsWith('{')
      // gate but JSON.parse throws on the malformed content.
      mockRedis.get.mockResolvedValue('{ this is broken json');
      const result = await cache.isRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
      });
      expect(result).toEqual({ rateLimited: false });
    });

    it('returns false for valid JSON missing required fields', async () => {
      // Reaches the field-shape validation path: parses successfully but
      // doesn't carry the required { resetMs, category, userMessage,
      // technicalMessage } shape. Could happen if a cache write from a
      // future version persisted a different shape.
      mockRedis.get.mockResolvedValue(JSON.stringify({ resetMs: 1234567890 }));
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
      // request the real provider would now accept. Uses JSON shape so the
      // value reaches the parsed.resetMs guard rather than the
      // legacy-numeric early-return.
      const expiredResetMs = FIXED_NOW_MS - 1000;
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          resetMs: expiredResetMs,
          category: ApiErrorCategory.RATE_LIMIT,
          userMessage: 'cached message',
          technicalMessage: 'cached technical',
        })
      );
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
        ...DEFAULT_ERROR_CTX,
      });
      await cache.markRateLimited({
        cacheKeyId: 'user:222222222222222222',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
        ...DEFAULT_ERROR_CTX,
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
        ...DEFAULT_ERROR_CTX,
      });
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'z-ai/glm-4.5-air:free',
        resetTimestampMs: resetMs,
        ...DEFAULT_ERROR_CTX,
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
        ...DEFAULT_ERROR_CTX,
      });
      await cache.markRateLimited({
        cacheKeyId: 'system',
        model: 'google/gemma-4-31b-it:free',
        resetTimestampMs: resetMs,
        ...DEFAULT_ERROR_CTX,
      });
      const key1 = mockRedis.setex.mock.calls[0][0];
      const key2 = mockRedis.setex.mock.calls[1][0];
      expect(key1).not.toBe(key2);
    });
  });
});

describe('deriveCacheKeyId', () => {
  it('returns system when the route is system-key even though a key STRING is present', () => {
    // Provenance beats presence: a quota retarget passes the system key as a
    // plain string; deriving user:<id> from it re-attaches the user's doom
    // marks to a route billing a different account (prod ref mrecl8grjuc).
    expect(deriveCacheKeyId('sk-or-system-key', '278863839632818186', true)).toBe('system');
  });

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
