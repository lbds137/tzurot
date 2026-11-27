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

import { KeyInvalidCache } from './KeyInvalidCache.js';

// Frozen "now" for deterministic TTL math
const FIXED_NOW_MS = 1_777_500_000_000;

describe('KeyInvalidCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
  let cache: KeyInvalidCache;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW_MS);
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
      del: vi.fn().mockResolvedValue(1),
    };
    cache = new KeyInvalidCache(mockRedis as unknown as Redis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('markKeyInvalid', () => {
    it('writes to Redis with account-scoped key + default 10-minute TTL + JSON value', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'user:278863839632818186' });

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, value] = mockRedis.setex.mock.calls[0];
      expect(key).toBe('invalidkey:openrouter:user:278863839632818186');
      expect(ttl).toBe(600); // default 10min — the fix/rotation staleness bound
      expect(JSON.parse(value)).toEqual({ ts: FIXED_NOW_MS, ttl: 600 });
    });

    it('logs the mark time under the markedAtIso field', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'user:1' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ markedAtIso: new Date(FIXED_NOW_MS).toISOString() }),
        'Cached invalid-key state'
      );
    });

    it('names the fail-open-to-user-key degradation when the write or read fails', async () => {
      mockRedis.setex.mockRejectedValue(new Error('down'));
      mockRedis.get.mockRejectedValue(new Error('down'));
      await cache.markKeyInvalid({ cacheKeyId: 'user:1' });
      await cache.isKeyInvalid({ cacheKeyId: 'user:1' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKeyId: 'user:1' }),
        'Invalid-key cache write failed — failing open to the user key'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ cacheKeyId: 'user:1' }),
        'Invalid-key cache read failed — failing open to the user key'
      );
    });

    it('persists the post-clamp TTL in the JSON value, not the raw caller value', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'system', ttlSeconds: 30 });
      const [, , value] = mockRedis.setex.mock.calls[0];
      expect(JSON.parse(value)).toEqual({ ts: FIXED_NOW_MS, ttl: 60 });
    });

    it('uses literal "system" for guest-mode bucket', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'system' });
      const [key] = mockRedis.setex.mock.calls[0];
      expect(key).toBe('invalidkey:openrouter:system');
    });

    it('clamps TTL to minimum 60s when caller passes lower', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'system', ttlSeconds: 30 });
      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(60);
    });

    it('clamps TTL to maximum 24h when caller passes higher', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'system', ttlSeconds: 30 * 24 * 3600 });
      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(24 * 60 * 60);
    });

    it('skips write when cacheKeyId is empty (opt-out sentinel)', async () => {
      await cache.markKeyInvalid({ cacheKeyId: '' });
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('does not throw when Redis setex throws (degraded write)', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Connection refused'));
      await expect(cache.markKeyInvalid({ cacheKeyId: 'system' })).resolves.toBeUndefined();
    });
  });

  describe('isKeyInvalid', () => {
    it('returns false for missing key', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({ invalid: false });
    });

    it('returns invalid result with accurate ttl computed from stored write TTL', async () => {
      const invalidAtMs = FIXED_NOW_MS - 600 * 1000;
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: invalidAtMs, ttl: 3600 }));
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({
        invalid: true,
        invalidAtMs,
        ttlSeconds: 3000,
      });
    });

    it('uses the stored write TTL even when caller used a custom value', async () => {
      const invalidAtMs = FIXED_NOW_MS - 2 * 3600 * 1000;
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: invalidAtMs, ttl: 12 * 3600 }));
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toMatchObject({ invalid: true, ttlSeconds: 10 * 3600 });
    });

    it('returns false for non-JSON cache value', async () => {
      mockRedis.get.mockResolvedValue('garbage');
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({ invalid: false });
    });

    it('returns false for legacy plain-numeric string (pre-JSON schema)', async () => {
      mockRedis.get.mockResolvedValue(String(FIXED_NOW_MS));
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({ invalid: false });
    });

    it('returns false for JSON missing required fields', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: FIXED_NOW_MS })); // no ttl
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({ invalid: false });
    });

    it('returns false for JSON with wrong field types', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: 'now', ttl: 3600 }));
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({ invalid: false });
    });

    it('returns false when Redis get throws (degraded read)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toEqual({ invalid: false });
    });

    it('returns false for empty cacheKeyId without hitting Redis (opt-out fast-path)', async () => {
      const result = await cache.isKeyInvalid({ cacheKeyId: '' });
      expect(result).toEqual({ invalid: false });
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('returns ttlSeconds capped at 0 when elapsed exceeds the stored write TTL', async () => {
      const longAgoMs = FIXED_NOW_MS - 2 * 60 * 60 * 1000;
      mockRedis.get.mockResolvedValue(JSON.stringify({ ts: longAgoMs, ttl: 3600 }));
      const result = await cache.isKeyInvalid({ cacheKeyId: 'system' });
      expect(result).toMatchObject({ invalid: true, ttlSeconds: 0 });
    });
  });

  describe('clearKeyInvalid', () => {
    it('deletes the account-scoped key (the wallet-key-update recovery edge)', async () => {
      await cache.clearKeyInvalid({ cacheKeyId: 'user:278863839632818186' });

      expect(mockRedis.del).toHaveBeenCalledWith('invalidkey:openrouter:user:278863839632818186');
    });

    it('no-ops on an empty cacheKeyId (cache opt-out)', async () => {
      await cache.clearKeyInvalid({ cacheKeyId: '' });

      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('swallows Redis errors — the TTL remains the backstop', async () => {
      mockRedis.del.mockRejectedValue(new Error('redis down'));

      await expect(cache.clearKeyInvalid({ cacheKeyId: 'user:1' })).resolves.toBeUndefined();
    });
  });

  describe('cache key isolation', () => {
    it('uses different keys for different users (BYOK isolation)', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'user:111111111111111111' });
      await cache.markKeyInvalid({ cacheKeyId: 'user:222222222222222222' });
      const keyA = mockRedis.setex.mock.calls[0][0];
      const keyB = mockRedis.setex.mock.calls[1][0];
      expect(keyA).not.toBe(keyB);
    });

    it('isolates user buckets from the system bucket', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'user:111111111111111111' });
      await cache.markKeyInvalid({ cacheKeyId: 'system' });
      const keyUser = mockRedis.setex.mock.calls[0][0];
      const keySystem = mockRedis.setex.mock.calls[1][0];
      expect(keyUser).not.toBe(keySystem);
    });

    it('does NOT include model dimension (key validity is account-wide)', async () => {
      await cache.markKeyInvalid({ cacheKeyId: 'user:111111111111111111' });
      const [key] = mockRedis.setex.mock.calls[0];
      expect(key).toBe('invalidkey:openrouter:user:111111111111111111');
      expect(key).not.toContain('glm');
      expect(key).not.toContain(':free');
    });
  });
});
