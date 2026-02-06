/**
 * Unit Tests for VisionDescriptionCache
 *
 * Tests the failure caching (negative cache) functionality
 * using mocked Redis and PersistentVisionCache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { VisionDescriptionCache } from './VisionDescriptionCache.js';
import type { PersistentVisionCache } from './PersistentVisionCache.js';
import { INTERVALS, REDIS_KEY_PREFIXES } from '../constants/index.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('VisionDescriptionCache', () => {
  let mockRedis: {
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  let mockL2Cache: {
    setFailure: ReturnType<typeof vi.fn>;
    getFailure: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let cache: VisionDescriptionCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = {
      setex: vi.fn().mockResolvedValue('OK'),
      get: vi.fn().mockResolvedValue(null),
    };
    mockL2Cache = {
      setFailure: vi.fn().mockResolvedValue(undefined),
      getFailure: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
    cache = new VisionDescriptionCache(mockRedis as unknown as Redis);
    cache.setL2Cache(mockL2Cache as unknown as PersistentVisionCache);
  });

  describe('storeFailure', () => {
    it('should store transient failure in L1 only with short TTL', async () => {
      await cache.storeFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
        category: 'timeout',
        permanent: false,
      });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.VISION_FAILURE}id:123`,
        INTERVALS.VISION_FAILURE_TTL,
        JSON.stringify({ category: 'timeout', permanent: false })
      );
      // Should NOT write to L2 for transient failures
      expect(mockL2Cache.setFailure).not.toHaveBeenCalled();
    });

    it('should store permanent failure in L1 and L2', async () => {
      await cache.storeFailure({
        attachmentId: '456',
        url: 'https://example.com/image.png',
        category: 'authentication',
        permanent: true,
      });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.VISION_FAILURE}id:456`,
        INTERVALS.VISION_FAILURE_PERMANENT_TTL,
        JSON.stringify({ category: 'authentication', permanent: true })
      );
      expect(mockL2Cache.setFailure).toHaveBeenCalledWith('456', 'authentication');
    });

    it('should skip L2 write when attachmentId is empty', async () => {
      await cache.storeFailure({
        url: 'https://example.com/image.png',
        category: 'content_policy',
        permanent: true,
      });

      expect(mockRedis.setex).toHaveBeenCalledTimes(1);
      expect(mockL2Cache.setFailure).not.toHaveBeenCalled();
    });

    it('should not throw on Redis errors', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis down'));

      await expect(
        cache.storeFailure({
          attachmentId: '123',
          url: 'https://example.com/image.png',
          category: 'timeout',
          permanent: false,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('getFailure', () => {
    it('should return failure entry from L1 cache', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ category: 'rate_limit', permanent: false }));

      const result = await cache.getFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });

      expect(result).toEqual({ category: 'rate_limit', permanent: false });
      expect(mockRedis.get).toHaveBeenCalledWith(`${REDIS_KEY_PREFIXES.VISION_FAILURE}id:123`);
    });

    it('should fall through to L2 when L1 misses', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockL2Cache.getFailure.mockResolvedValue({ category: 'authentication' });

      const result = await cache.getFailure({
        attachmentId: '789',
        url: 'https://example.com/image.png',
      });

      expect(result).toEqual({ category: 'authentication', permanent: true });
      // Should repopulate L1 from L2
      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.VISION_FAILURE}id:789`,
        INTERVALS.VISION_FAILURE_PERMANENT_TTL,
        JSON.stringify({ category: 'authentication', permanent: true })
      );
    });

    it('should return null when both L1 and L2 miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockL2Cache.getFailure.mockResolvedValue(null);

      const result = await cache.getFailure({
        attachmentId: '999',
        url: 'https://example.com/image.png',
      });

      expect(result).toBeNull();
    });

    it('should skip L2 check when no attachmentId', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cache.getFailure({
        url: 'https://example.com/image.png',
      });

      expect(result).toBeNull();
      expect(mockL2Cache.getFailure).not.toHaveBeenCalled();
    });

    it('should not throw on Redis errors', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis down'));

      const result = await cache.getFailure({
        attachmentId: '123',
        url: 'https://example.com/image.png',
      });

      expect(result).toBeNull();
    });

    it('should use URL hash key when no attachmentId', async () => {
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ category: 'server_error', permanent: false })
      );

      const result = await cache.getFailure({
        url: 'https://example.com/image.png?token=abc',
      });

      expect(result).toEqual({ category: 'server_error', permanent: false });
      // Key should use vision:fail: prefix with url: subprefix
      const calledKey = mockRedis.get.mock.calls[0][0] as string;
      expect(calledKey).toMatch(/^vision:fail:url:/);
    });
  });
});
