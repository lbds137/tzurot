/**
 * Unit Tests for VisionDescriptionCache
 *
 * Covers Redis L1 cache for vision descriptions and per-category negative cache.
 * (L2 PostgreSQL was removed in beta.110 — see VisionDescriptionCache.ts header.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { VisionDescriptionCache } from './VisionDescriptionCache.js';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { INTERVALS } from '@tzurot/common-types/constants/timing';

// Silence the real pino logger; nothing here asserts on log output.
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('VisionDescriptionCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let cache: VisionDescriptionCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
    };
    cache = new VisionDescriptionCache(mockRedis as unknown as Redis);
  });

  describe('storeFailure (per-category cache policy)', () => {
    it('should cache AUTHENTICATION failures with SHORT TTL (5min)', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: ApiErrorCategory.AUTHENTICATION,
      });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.VISION_FAILURE}id:123`,
        INTERVALS.VISION_FAILURE_TTL_SHORT,
        expect.stringContaining(`"category":"${ApiErrorCategory.AUTHENTICATION}"`)
      );
    });

    it('should cache QUOTA_EXCEEDED failures with SHORT TTL (5min)', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: ApiErrorCategory.QUOTA_EXCEEDED,
      });

      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(INTERVALS.VISION_FAILURE_TTL_SHORT);
    });

    it('should cache CONTENT_POLICY failures with LONG TTL (60min)', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: ApiErrorCategory.CONTENT_POLICY,
      });

      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(INTERVALS.VISION_FAILURE_TTL_LONG);
    });

    it('should cache MEDIA_NOT_FOUND failures with LONG TTL', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: ApiErrorCategory.MEDIA_NOT_FOUND,
      });

      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(INTERVALS.VISION_FAILURE_TTL_LONG);
    });

    it('should cache RATE_LIMIT (transient retryable) with default TTL (10min)', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: ApiErrorCategory.RATE_LIMIT,
      });

      const [, ttl] = mockRedis.setex.mock.calls[0];
      expect(ttl).toBe(INTERVALS.VISION_FAILURE_TTL);
    });

    it('should embed cachedAt timestamp in the stored value', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: ApiErrorCategory.AUTHENTICATION,
      });

      const [, , value] = mockRedis.setex.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed.cachedAt).toBeDefined();
      expect(typeof parsed.cachedAt).toBe('string');
      // Should parse as a valid ISO date
      expect(() => new Date(parsed.cachedAt).toISOString()).not.toThrow();
    });

    it('should use URL-hash fallback key when attachmentId is missing', async () => {
      await cache.storeFailure({
        url: 'https://example.com/image.png?ex=abc',
        category: ApiErrorCategory.AUTHENTICATION,
      });

      const [key] = mockRedis.setex.mock.calls[0];
      expect(key).toMatch(new RegExp(`^${REDIS_KEY_PREFIXES.VISION_FAILURE}url:[a-f0-9]+$`));
    });

    it('should not throw on Redis errors', async () => {
      mockRedis.setex.mockRejectedValueOnce(new Error('Redis down'));
      await expect(
        cache.storeFailure({
          attachmentId: '123',
          url: 'https://example.com/image.png',
          category: ApiErrorCategory.AUTHENTICATION,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('getFailure', () => {
    it('should return null when no entry cached', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const result = await cache.getFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });
      expect(result).toBeNull();
    });

    it('should return entry with category + cachedAt on hit', async () => {
      const cachedAt = '2026-04-28T18:22:42.000Z';
      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({ category: ApiErrorCategory.AUTHENTICATION, cachedAt })
      );
      const result = await cache.getFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });
      expect(result).toEqual({ category: ApiErrorCategory.AUTHENTICATION, cachedAt });
    });

    it('should return null on Redis errors (fail open)', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('Redis down'));
      const result = await cache.getFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });
      expect(result).toBeNull();
    });

    it('should use URL-hash fallback key when attachmentId is missing', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      await cache.getFailure({ url: 'https://example.com/image.png' });
      const [key] = mockRedis.get.mock.calls[0];
      expect(key).toMatch(new RegExp(`^${REDIS_KEY_PREFIXES.VISION_FAILURE}url:[a-f0-9]+$`));
    });
  });

  describe('store / get (success cache)', () => {
    it('should store description with default TTL', async () => {
      await cache.store({ attachmentId: '123', url: 'https://example.com/image.png' }, 'a cat');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}id:123`,
        INTERVALS.VISION_DESCRIPTION_TTL,
        'a cat'
      );
    });

    it('should return cached description on hit', async () => {
      mockRedis.get.mockResolvedValueOnce('a cat');
      const result = await cache.get({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });
      expect(result).toBe('a cat');
    });

    it('should return null on miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const result = await cache.get({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });
      expect(result).toBeNull();
    });
  });

  describe('model namespacing (cache key includes the resolved vision model)', () => {
    it('produces different keys for different models on the same attachment', async () => {
      await cache.store({ attachmentId: '123', url: 'u', model: 'qwen/qwen3.7-plus' }, 'desc-a');
      await cache.store({ attachmentId: '123', url: 'u', model: 'openai/gpt-4o' }, 'desc-b');

      const keyA = mockRedis.setex.mock.calls[0][0] as string;
      const keyB = mockRedis.setex.mock.calls[1][0] as string;
      // Different models → different keys, so a model swap re-attempts instead of
      // replaying the old model's cached entry.
      expect(keyA).not.toBe(keyB);
      // ...but both still key off the same attachment id.
      expect(keyA).toContain('id:123');
      expect(keyB).toContain('id:123');
    });

    it('sanitizes the model segment so it cannot inject the key delimiter', async () => {
      await cache.store({ attachmentId: '123', url: 'u', model: 'qwen/qwen3.7-plus' }, 'desc');
      const key = mockRedis.setex.mock.calls[0][0] as string;
      expect(key).toContain('qwen_qwen3.7-plus'); // '/' → '_'
    });

    it('falls back to the un-namespaced legacy key when no model is given', async () => {
      await cache.store({ attachmentId: '123', url: 'u' }, 'desc');
      const key = mockRedis.setex.mock.calls[0][0] as string;
      expect(key).toBe(`${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}id:123`);
    });

    it('also namespaces the failure-cache key by model', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'u',
        model: 'qwen/qwen3.7-plus',
        category: ApiErrorCategory.AUTHENTICATION,
      });
      const key = mockRedis.setex.mock.calls[0][0] as string;
      expect(key).toContain('qwen_qwen3.7-plus');
    });
  });
});
