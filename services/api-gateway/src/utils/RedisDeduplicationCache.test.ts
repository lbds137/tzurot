/**
 * Tests for RedisDeduplicationCache
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GenerateRequest } from '../types.js';

// Mock ioredis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  scan: vi.fn(), // SCAN for getCacheSize (replaced KEYS)
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis),
}));

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  INTERVALS: {
    REQUEST_DEDUP_WINDOW: 5000,
  },
  REDIS_KEY_PREFIXES: {
    REQUEST_DEDUP: 'dedup:',
  },
}));

import { RedisDeduplicationCache } from './RedisDeduplicationCache.js';

describe('RedisDeduplicationCache', () => {
  let cache: RedisDeduplicationCache;

  // Mock request for testing
  const createMockRequest = (message: string, userId = 'user-123'): GenerateRequest => ({
    personality: {
      id: 'test-personality-id',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'testbot',
      systemPrompt: 'Test system prompt',
      model: 'gpt-4',
      visionModel: undefined,
      temperature: 0.7,
      maxTokens: 1000,
      contextWindowTokens: 8000,
      characterInfo: 'Test character info',
      personalityTraits: 'Test personality traits',
    },
    message,
    context: {
      userId,
      channelId: 'channel-123',
      serverId: 'guild-123',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cache = new RedisDeduplicationCache(mockRedis as never);
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const newCache = new RedisDeduplicationCache(mockRedis as never);
      expect(newCache).toBeDefined();
    });

    it('should create cache with custom window', () => {
      const newCache = new RedisDeduplicationCache(mockRedis as never, {
        duplicateWindowSeconds: 10,
      });
      expect(newCache).toBeDefined();
    });
  });

  describe('checkDuplicate', () => {
    it('should return null when no cached entry exists', async () => {
      mockRedis.get.mockResolvedValue(null);

      const request = createMockRequest('Hello world');
      const result = await cache.checkDuplicate(request);

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith(expect.stringContaining('dedup:'));
    });

    it('should return cached entry when duplicate found', async () => {
      const cachedData = {
        requestId: 'req-123',
        jobId: 'job-456',
        timestamp: Date.now() - 1000,
        expiresAt: Date.now() + 4000,
      };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const request = createMockRequest('Hello world');
      const result = await cache.checkDuplicate(request);

      expect(result).not.toBeNull();
      expect(result?.requestId).toBe('req-123');
      expect(result?.jobId).toBe('job-456');
    });

    it('should return null and proceed on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection lost'));

      const request = createMockRequest('Hello world');
      const result = await cache.checkDuplicate(request);

      expect(result).toBeNull();
    });

    it('should handle malformed JSON in Redis', async () => {
      mockRedis.get.mockResolvedValue('not valid json');

      const request = createMockRequest('Hello world');
      const result = await cache.checkDuplicate(request);

      // Should gracefully handle parse error
      expect(result).toBeNull();
    });
  });

  describe('cacheRequest', () => {
    it('should cache request with SETEX', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      const request = createMockRequest('Hello world');
      await cache.cacheRequest(request, 'req-123', 'job-456');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('dedup:'),
        expect.any(Number),
        expect.stringContaining('"requestId":"req-123"')
      );
    });

    it('should not throw on Redis error', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis write failed'));

      const request = createMockRequest('Hello world');

      // Should not throw
      await expect(cache.cacheRequest(request, 'req-123', 'job-456')).resolves.toBeUndefined();
    });

    it('should use correct TTL from options', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      const customCache = new RedisDeduplicationCache(mockRedis as never, {
        duplicateWindowSeconds: 30,
      });

      const request = createMockRequest('Hello world');
      await customCache.cacheRequest(request, 'req-123', 'job-456');

      expect(mockRedis.setex).toHaveBeenCalledWith(expect.any(String), 30, expect.any(String));
    });
  });

  describe('getCacheSize', () => {
    it('should return count of matching keys using SCAN', async () => {
      // SCAN returns [cursor, keys] - mock single iteration completing
      mockRedis.scan.mockResolvedValue(['0', ['dedup:key1', 'dedup:key2', 'dedup:key3']]);

      const size = await cache.getCacheSize();

      expect(size).toBe(3);
      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'dedup:*', 'COUNT', 100);
    });

    it('should handle multiple SCAN iterations', async () => {
      // First call returns cursor '42' (more to scan), second returns '0' (done)
      mockRedis.scan
        .mockResolvedValueOnce(['42', ['dedup:key1', 'dedup:key2']])
        .mockResolvedValueOnce(['0', ['dedup:key3']]);

      const size = await cache.getCacheSize();

      expect(size).toBe(3);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when no keys found', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);

      const size = await cache.getCacheSize();

      expect(size).toBe(0);
    });

    it('should return 0 on Redis error', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Redis scan failed'));

      const size = await cache.getCacheSize();

      expect(size).toBe(0);
    });
  });

  describe('hash consistency', () => {
    it('should produce different hashes for different messages', async () => {
      const calls: string[] = [];
      mockRedis.get.mockImplementation((key: string) => {
        calls.push(key);
        return Promise.resolve(null);
      });

      const request1 = createMockRequest('Hello world');
      const request2 = createMockRequest('Goodbye world');

      await cache.checkDuplicate(request1);
      await cache.checkDuplicate(request2);

      expect(calls[0]).not.toBe(calls[1]);
    });

    it('should produce different hashes for different users', async () => {
      const calls: string[] = [];
      mockRedis.get.mockImplementation((key: string) => {
        calls.push(key);
        return Promise.resolve(null);
      });

      const request1 = createMockRequest('Hello', 'user-123');
      const request2 = createMockRequest('Hello', 'user-456');

      await cache.checkDuplicate(request1);
      await cache.checkDuplicate(request2);

      expect(calls[0]).not.toBe(calls[1]);
    });

    it('should produce different hashes for different personalities', async () => {
      const calls: string[] = [];
      mockRedis.get.mockImplementation((key: string) => {
        calls.push(key);
        return Promise.resolve(null);
      });

      const request1 = createMockRequest('Hello');
      const request2 = {
        ...createMockRequest('Hello'),
        personality: {
          ...createMockRequest('Hello').personality,
          name: 'DifferentBot',
        },
      };

      await cache.checkDuplicate(request1);
      await cache.checkDuplicate(request2);

      expect(calls[0]).not.toBe(calls[1]);
    });

    it('should produce same hash for identical requests', async () => {
      const calls: string[] = [];
      mockRedis.get.mockImplementation((key: string) => {
        calls.push(key);
        return Promise.resolve(null);
      });

      const request = createMockRequest('Hello world');

      await cache.checkDuplicate(request);
      await cache.checkDuplicate(request);

      expect(calls[0]).toBe(calls[1]);
    });
  });
});
