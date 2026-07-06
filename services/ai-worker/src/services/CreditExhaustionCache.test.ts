import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { CreditExhaustionCache } from './CreditExhaustionCache.js';

// Frozen "now" for deterministic TTL math
const FIXED_NOW_MS = 1_777_500_000_000;

describe('CreditExhaustionCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let cache: CreditExhaustionCache;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_MS);
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    };
    cache = new CreditExhaustionCache(mockRedis as unknown as Redis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('markCreditExhausted', () => {
    it('writes to Redis with account-scoped key + default 1h TTL + JSON value', async () => {
      await cache.markCreditExhausted({ cacheKeyId: 'user:278863839632818186' });

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      // No model dimension in the key — credits are account-wide.
      expect(key).toBe('nocredits:openrouter:user:278863839632818186');
      expect(ttl).toBe(3600); // default 1h
      // JSON value carries timestamp AND original write TTL so reads can
      // compute accurate remaining-time without a second redis.ttl() call.
      expect(JSON.parse(value)).toEqual({ ts: FIXED_NOW_MS, ttl: 3600 });
    });

    it('persists the post-clamp TTL in the JSON value, not the raw caller value', async () => {
      // Caller passes a sub-MIN value; cache clamps to 60s and persists 60.
      // This is the value reads will use to compute remaining-time, so it
      // must reflect the actual Redis TTL the SETEX command applied.
      await cache.markCreditExhausted({ cacheKeyId: 'system', ttlSeconds: 30 });
      const [, , value] = mockRedis.setex.mock.calls[0];
      expect(JSON.parse(value)).toEqual({ ts: FIXED_NOW_MS, ttl: 60 });
    });

    it('uses literal "system" for guest-mode bucket', async () => {
      await cache.markCreditExhausted({ cacheKeyId: 'system' });
      const [key] = mockRedis.setex.mock.calls[0];
      expect(key).toBe('nocredits:openrouter:system');
    });

    it('clamps TTL to minimum 60s when caller passes lower', async () => {
      await cache.markCreditExhausted({ cacheKeyId: 'system', ttlSeconds: 30 });
      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(60);
    });

    it('clamps TTL to maximum 24h when caller passes higher', async () => {
      await cache.markCreditExhausted({ cacheKeyId: 'system', ttlSeconds: 30 * 24 * 3600 });
      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(24 * 60 * 60);
    });

    it('skips write when cacheKeyId is empty (opt-out sentinel)', async () => {
      await cache.markCreditExhausted({ cacheKeyId: '' });
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('does not throw when Redis setex throws (degraded write)', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Connection refused'));
      await expect(cache.markCreditExhausted({ cacheKeyId: 'system' })).resolves.toBeUndefined();
    });
  });

  describe('isCreditExhausted', () => {
    it('returns false for missing key', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({ exhausted: false });
    });

    it('returns exhausted result with accurate ttl computed from stored write TTL', async () => {
      // Written 10 minutes ago with default 1h TTL. Remaining = 3600 - 600 = 3000s.
      const exhaustedAtMs = FIXED_NOW_MS - 600 * 1000;
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: exhaustedAtMs, ttl: 3600 }));
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({
        exhausted: true,
        exhaustedAtMs,
        ttlSeconds: 3000,
      });
    });

    it('uses the stored write TTL even when caller used a custom value', async () => {
      // Custom 12h write 2h ago → remaining = 12h - 2h = 10h = 36000s.
      // Pre-fix, this would have returned 24h - 2h = 22h, off by 12 hours.
      const exhaustedAtMs = FIXED_NOW_MS - 2 * 3600 * 1000;
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: exhaustedAtMs, ttl: 12 * 3600 }));
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toMatchObject({ exhausted: true, ttlSeconds: 10 * 3600 });
    });

    it('returns false for non-JSON cache value', async () => {
      mockRedis.get.mockResolvedValue('garbage');
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({ exhausted: false });
    });

    it('returns false for legacy plain-numeric string (pre-JSON schema)', async () => {
      // Defensive against any pre-fix entries lingering in Redis: a key
      // written with the old `String(timestamp)` shape would parse as a
      // valid JSON number, but lack the {ts, ttl} object shape. Treat it
      // as malformed so callers fall through to a real OpenRouter call.
      mockRedis.get.mockResolvedValue(String(FIXED_NOW_MS));
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({ exhausted: false });
    });

    it('returns false for JSON missing required fields', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: FIXED_NOW_MS })); // no ttl
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({ exhausted: false });
    });

    it('returns false for JSON with wrong field types', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: 'now', ttl: 3600 }));
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({ exhausted: false });
    });

    it('returns false when Redis get throws (degraded read)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toEqual({ exhausted: false });
    });

    it('returns false for empty cacheKeyId without hitting Redis (opt-out fast-path)', async () => {
      const result = await cache.isCreditExhausted({ cacheKeyId: '' });
      expect(result).toEqual({ exhausted: false });
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('returns ttlSeconds capped at 0 when elapsed exceeds the stored write TTL', async () => {
      // exhaustedAtMs from 2 hours ago, but the original write TTL was only
      // 1 hour. This shouldn't happen in practice (Redis would have expired
      // the key first), but guards against any TTL-drift / clock-skew window
      // where the read fires after the logical TTL but before Redis evicts.
      const longAgoMs = FIXED_NOW_MS - 2 * 60 * 60 * 1000;
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: longAgoMs, ttl: 3600 }));
      const result = await cache.isCreditExhausted({ cacheKeyId: 'system' });
      expect(result).toMatchObject({ exhausted: true, ttlSeconds: 0 });
    });
  });

  describe('clearCreditExhausted', () => {
    it('deletes the account-scoped key (the wallet-top-up recovery edge)', async () => {
      await cache.clearCreditExhausted({ cacheKeyId: 'user:278863839632818186' });

      expect(mockRedis.del).toHaveBeenCalledWith('nocredits:openrouter:user:278863839632818186');
    });

    it('no-ops on an empty cacheKeyId (cache opt-out)', async () => {
      await cache.clearCreditExhausted({ cacheKeyId: '' });

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('swallows Redis errors — the TTL remains the backstop', async () => {
      mockRedis.del.mockRejectedValue(new Error('redis down'));

      await expect(cache.clearCreditExhausted({ cacheKeyId: 'user:1' })).resolves.toBeUndefined();
    });
  });

  describe('cache key isolation', () => {
    it('uses different keys for different users (BYOK isolation)', async () => {
      await cache.markCreditExhausted({ cacheKeyId: 'user:111111111111111111' });
      await cache.markCreditExhausted({ cacheKeyId: 'user:222222222222222222' });
      const keyA = mockRedis.setex.mock.calls[0][0];
      const keyB = mockRedis.setex.mock.calls[1][0];
      expect(keyA).not.toBe(keyB);
    });

    it('isolates user buckets from the system bucket', async () => {
      await cache.markCreditExhausted({ cacheKeyId: 'user:111111111111111111' });
      await cache.markCreditExhausted({ cacheKeyId: 'system' });
      const keyUser = mockRedis.setex.mock.calls[0][0];
      const keySystem = mockRedis.setex.mock.calls[1][0];
      expect(keyUser).not.toBe(keySystem);
    });

    it('does NOT include model dimension (credits are account-wide)', async () => {
      // A 402 on glm-4.7 means the OpenRouter account has no credits for ANY
      // model. The cache key intentionally omits model so the same entry
      // blocks subsequent calls regardless of which model the user invokes.
      await cache.markCreditExhausted({ cacheKeyId: 'user:111111111111111111' });
      const [key] = mockRedis.setex.mock.calls[0];
      expect(key).toBe('nocredits:openrouter:user:111111111111111111');
      expect(key).not.toContain('glm');
      expect(key).not.toContain(':free');
    });
  });
});
