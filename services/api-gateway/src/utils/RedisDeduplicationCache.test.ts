/**
 * Tests for RedisDeduplicationCache
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { GenerateRequest } from '../types.js';

/**
 * Minimal Redis client interface for deduplication
 * Only includes methods actually used by RedisDeduplicationCache
 */
interface MockRedisClient {
  get: Mock<(key: string) => Promise<string | null>>;
  set: Mock<
    (
      key: string,
      value: string,
      exToken: 'EX',
      seconds: number,
      nxToken: 'NX'
    ) => Promise<'OK' | null>
  >;
  del: Mock<(key: string) => Promise<number>>;
  // Compare-and-delete on release. Typed to the ioredis eval shape the cache
  // calls (script, numKeys, key, jobId) so a signature change breaks here.
  eval: Mock<(script: string, numKeys: number, key: string, jobId: string) => Promise<number>>;
  scan: Mock<(cursor: string, ...args: string[]) => Promise<[string, string[]]>>;
}

// Mock ioredis with proper typing
const mockRedis: MockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  eval: vi.fn(),
  scan: vi.fn(), // SCAN for getCacheSize (replaced KEYS)
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedis),
}));

// Mock common-types
vi.mock('@tzurot/common-types/constants/queue', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/queue')>(
    '@tzurot/common-types/constants/queue'
  );
  return {
    ...actual,
    REDIS_KEY_PREFIXES: {
      REQUEST_DEDUP: 'dedup:',
    },
  };
});

vi.mock('@tzurot/common-types/constants/timing', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/timing')>(
    '@tzurot/common-types/constants/timing'
  );
  return {
    ...actual,
    INTERVALS: {
      REQUEST_DEDUP_WINDOW: 5000,
    },
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

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
      ownerId: 'owner-uuid-test',
      systemPrompt: 'Test system prompt',
      model: 'gpt-4',
      provider: 'openrouter',
      visionModel: undefined,
      temperature: 0.7,
      maxTokens: 1000,
      contextWindowTokens: 8000,
      characterInfo: 'Test character info',
      personalityTraits: 'Test personality traits',
      voiceEnabled: false,
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
    cache = new RedisDeduplicationCache(mockRedis as unknown as import('ioredis').Redis);
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const newCache = new RedisDeduplicationCache(mockRedis as unknown as import('ioredis').Redis);
      expect(newCache).toBeDefined();
    });

    it('should create cache with custom window', () => {
      const newCache = new RedisDeduplicationCache(
        mockRedis as unknown as import('ioredis').Redis,
        {
          duplicateWindowSeconds: 10,
        }
      );
      expect(newCache).toBeDefined();
    });
  });

  describe('reserve', () => {
    it('should claim the window with SET NX EX when the key is free', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const request = createMockRequest('Hello world');
      const result = await cache.reserve(request, 'req-123', 'job-456');

      expect(result).toEqual({ kind: 'reserved' });
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('dedup:'),
        expect.stringContaining('"requestId":"req-123"'),
        'EX',
        5,
        'NX'
      );
      // A reservation that succeeded must not need a follow-up read
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it('should use the configured window as the TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const customCache = new RedisDeduplicationCache(
        mockRedis as unknown as import('ioredis').Redis,
        {
          duplicateWindowSeconds: 30,
        }
      );

      await customCache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456');

      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'EX',
        30,
        'NX'
      );
    });

    it('should report the existing entry when the key is already reserved', async () => {
      const cachedData = {
        requestId: 'req-existing',
        jobId: 'job-existing',
        timestamp: Date.now() - 1000,
        expiresAt: Date.now() + 4000,
      };
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await cache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456');

      expect(result).toEqual({ kind: 'duplicate', cached: cachedData });
    });

    it('should retry once when the existing reservation expires between SET and GET', async () => {
      // First round: SET loses the race, GET finds the key already gone.
      // Second round: the key is free, so the reservation succeeds.
      mockRedis.set.mockResolvedValueOnce(null).mockResolvedValueOnce('OK');
      mockRedis.get.mockResolvedValue(null);

      const result = await cache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456');

      expect(result).toEqual({ kind: 'reserved' });
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });

    it('should throw when neither SET nor GET resolves across both attempts', async () => {
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue(null);

      await expect(
        cache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456')
      ).rejects.toThrow(/did not resolve/);
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });

    it('should propagate Redis errors instead of failing open', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis connection lost'));

      await expect(
        cache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456')
      ).rejects.toThrow('Redis connection lost');
    });

    it('should propagate a GET error on the duplicate path', async () => {
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockRejectedValue(new Error('Redis read failed'));

      await expect(
        cache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456')
      ).rejects.toThrow('Redis read failed');
    });

    it('propagates a malformed stored entry rather than enqueueing past it', async () => {
      // The predecessor (checkDuplicate) swallowed this and returned null,
      // which under the new ordering would mean "no reservation, go enqueue" —
      // the double-bill this method exists to prevent. An unreadable entry
      // still means someone holds the window, so refusing is the fail-closed
      // reading and this pins it as deliberate rather than incidental.
      mockRedis.set.mockResolvedValue(null);
      mockRedis.get.mockResolvedValue('{not valid json');

      await expect(
        cache.reserve(createMockRequest('Hello world'), 'req-123', 'job-456')
      ).rejects.toThrow();
      // And it must NOT have quietly reserved the window on the way out.
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('release', () => {
    /**
     * Runs the real compare-and-delete script against a one-key fake store, so
     * these tests exercise the SCRIPT's decision rather than a mock that always
     * agrees. Mirrors Redis: returns 1 only when the stored jobId matches.
     */
    const evalAgainst = (stored: string | null) => {
      mockRedis.eval.mockImplementation((_script, _numKeys, _key, jobId) => {
        if (stored === null) {
          return Promise.resolve(0);
        }
        try {
          return Promise.resolve(
            (JSON.parse(stored) as { jobId?: string }).jobId === jobId ? 1 : 0
          );
        } catch {
          return Promise.resolve(0);
        }
      });
    };

    const entryFor = (jobId: string): string =>
      JSON.stringify({ requestId: 'r', jobId, timestamp: 1, expiresAt: 2 });

    it('deletes the reservation when the stored jobId is ours', async () => {
      evalAgainst(entryFor('job-456'));

      await cache.release(createMockRequest('Hello world'), 'job-456');

      const [, numKeys, key, jobId] = mockRedis.eval.mock.calls[0] as [
        string,
        number,
        string,
        string,
      ];
      expect(numKeys).toBe(1);
      expect(key).toContain('dedup:');
      expect(jobId).toBe('job-456');
    });

    it('does not delete a reservation belonging to another request', async () => {
      // The load-bearing case. An enqueue that fails by TIMEOUT takes
      // COMMAND_TIMEOUT (30s) while the reservation lives REQUEST_DEDUP_WINDOW
      // (5s), so by the time release runs the key has often been re-reserved by
      // a different in-flight request. A bare DEL would free the window and let
      // a third request enqueue a duplicate — the double-bill this class exists
      // to prevent, reached from the other side.
      evalAgainst(entryFor('someone-elses-job'));

      await cache.release(createMockRequest('Hello world'), 'job-456');

      await expect(mockRedis.eval.mock.results[0]?.value).resolves.toBe(0);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('is a no-op when the reservation already expired', async () => {
      evalAgainst(null);

      await expect(
        cache.release(createMockRequest('Hello world'), 'job-456')
      ).resolves.toBeUndefined();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('leaves a corrupt entry alone rather than erroring', async () => {
      evalAgainst('{not valid json');

      await expect(
        cache.release(createMockRequest('Hello world'), 'job-456')
      ).resolves.toBeUndefined();
    });

    it('should swallow Redis errors', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis delete failed'));

      await expect(
        cache.release(createMockRequest('Hello world'), 'job-456')
      ).resolves.toBeUndefined();
    });

    it('should target the same key reserve claimed', async () => {
      mockRedis.set.mockResolvedValue('OK');
      evalAgainst(entryFor('job-456'));

      const request = createMockRequest('Hello world');
      await cache.reserve(request, 'req-123', 'job-456');
      await cache.release(request, 'job-456');

      expect(mockRedis.eval.mock.calls[0]?.[2]).toBe(mockRedis.set.mock.calls[0]?.[0]);
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
    /** Keys the cache derived, in call order, across a pair of reservations. */
    const reserveKeys = async (
      requestA: GenerateRequest,
      requestB: GenerateRequest
    ): Promise<[string | undefined, string | undefined]> => {
      mockRedis.set.mockResolvedValue('OK');

      await cache.reserve(requestA, 'req-a', 'job-a');
      await cache.reserve(requestB, 'req-b', 'job-b');

      return [mockRedis.set.mock.calls[0]?.[0], mockRedis.set.mock.calls[1]?.[0]];
    };

    it('should produce different hashes for different messages', async () => {
      const [keyA, keyB] = await reserveKeys(
        createMockRequest('Hello world'),
        createMockRequest('Goodbye world')
      );

      expect(keyA).not.toBe(keyB);
    });

    it('should produce different hashes for different users', async () => {
      const [keyA, keyB] = await reserveKeys(
        createMockRequest('Hello', 'user-123'),
        createMockRequest('Hello', 'user-456')
      );

      expect(keyA).not.toBe(keyB);
    });

    it('should produce different hashes for different personalities', async () => {
      const [keyA, keyB] = await reserveKeys(createMockRequest('Hello'), {
        ...createMockRequest('Hello'),
        personality: {
          ...createMockRequest('Hello').personality,
          name: 'DifferentBot',
        },
      });

      expect(keyA).not.toBe(keyB);
    });

    it('should produce same hash for identical requests', async () => {
      const request = createMockRequest('Hello world');
      const [keyA, keyB] = await reserveKeys(request, request);

      expect(keyA).toBe(keyB);
    });
  });
});
