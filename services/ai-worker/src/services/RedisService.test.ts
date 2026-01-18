/**
 * Tests for RedisService
 *
 * Tests Redis operations for job result publishing and caching:
 * - Stream publishing with xadd
 * - Job result storage with TTL
 * - Job result retrieval
 * - Error handling
 * - Graceful shutdown
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedisService } from './RedisService.js';
import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('RedisService', () => {
  let mockRedis: {
    xadd: ReturnType<typeof vi.fn>;
    xtrim: ReturnType<typeof vi.fn>;
    setex: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  };

  let redisService: RedisService;

  beforeEach(() => {
    mockRedis = {
      xadd: vi.fn(),
      xtrim: vi.fn(),
      setex: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      quit: vi.fn(),
    };

    redisService = new RedisService(mockRedis as unknown as Redis);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('publishJobResult', () => {
    it('should publish job result to Redis stream', async () => {
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      mockRedis.xtrim.mockResolvedValue(0);

      const result = { success: true, data: 'test' };

      await redisService.publishJobResult('job-123', 'request-456', result);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'job-results',
        '*',
        'jobId',
        'job-123',
        'requestId',
        'request-456',
        'result',
        JSON.stringify(result),
        'completedAt',
        expect.any(String)
      );
    });

    it('should trim stream after publishing', async () => {
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      mockRedis.xtrim.mockResolvedValue(100);

      await redisService.publishJobResult('job-123', 'request-456', {});

      expect(mockRedis.xtrim).toHaveBeenCalledWith('job-results', 'MAXLEN', '~', 10000);
    });

    it('should throw error when xadd fails', async () => {
      const testError = new Error('Redis connection error');
      mockRedis.xadd.mockRejectedValue(testError);

      await expect(redisService.publishJobResult('job-123', 'request-456', {})).rejects.toThrow(
        'Redis connection error'
      );
    });

    it('should throw error when xtrim fails', async () => {
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      mockRedis.xtrim.mockRejectedValue(new Error('Trim failed'));

      await expect(redisService.publishJobResult('job-123', 'request-456', {})).rejects.toThrow(
        'Trim failed'
      );
    });

    it('should handle complex result payloads', async () => {
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      mockRedis.xtrim.mockResolvedValue(0);

      const complexResult = {
        response: 'Hello world',
        metadata: {
          tokens: 100,
          model: 'gpt-4',
          nested: { deep: true },
        },
        array: [1, 2, 3],
      };

      await redisService.publishJobResult('job-123', 'request-456', complexResult);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'job-results',
        '*',
        'jobId',
        'job-123',
        'requestId',
        'request-456',
        'result',
        JSON.stringify(complexResult),
        'completedAt',
        expect.any(String)
      );
    });
  });

  describe('storeJobResult', () => {
    it('should store job result with 1 hour TTL', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      const result = { success: true };

      await redisService.storeJobResult('job-123', result);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.JOB_RESULT}job-123`,
        3600,
        JSON.stringify(result)
      );
    });

    it('should throw error when setex fails', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Storage failed'));

      await expect(redisService.storeJobResult('job-123', {})).rejects.toThrow('Storage failed');
    });

    it('should handle null values', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await redisService.storeJobResult('job-123', null);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.JOB_RESULT}job-123`,
        3600,
        'null'
      );
    });
  });

  describe('getJobResult', () => {
    it('should return parsed result when found', async () => {
      const storedResult = { success: true, data: 'test' };
      mockRedis.get.mockResolvedValue(JSON.stringify(storedResult));

      const result = await redisService.getJobResult<typeof storedResult>('job-123');

      expect(result).toEqual(storedResult);
      expect(mockRedis.get).toHaveBeenCalledWith(`${REDIS_KEY_PREFIXES.JOB_RESULT}job-123`);
    });

    it('should return null when key not found', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await redisService.getJobResult('job-123');

      expect(result).toBeNull();
    });

    it('should return null when value is empty string', async () => {
      mockRedis.get.mockResolvedValue('');

      const result = await redisService.getJobResult('job-123');

      expect(result).toBeNull();
    });

    it('should return null on parse error', async () => {
      mockRedis.get.mockResolvedValue('invalid json {{{');

      const result = await redisService.getJobResult('job-123');

      expect(result).toBeNull();
    });

    it('should return null on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection lost'));

      const result = await redisService.getJobResult('job-123');

      expect(result).toBeNull();
    });

    it('should handle complex typed results', async () => {
      interface CustomResult {
        status: 'success' | 'error';
        tokens: number;
        response: string;
      }

      const storedResult: CustomResult = {
        status: 'success',
        tokens: 150,
        response: 'Hello!',
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(storedResult));

      const result = await redisService.getJobResult<CustomResult>('job-123');

      expect(result).toEqual(storedResult);
      expect(result?.status).toBe('success');
      expect(result?.tokens).toBe(150);
    });
  });

  describe('isIncognitoActive', () => {
    const validSession = JSON.stringify({
      userId: 'user-123',
      personalityId: 'personality-456',
      enabledAt: '2026-01-15T12:00:00.000Z',
      expiresAt: '2026-01-15T13:00:00.000Z',
      duration: '1h',
    });

    const validGlobalSession = JSON.stringify({
      userId: 'user-123',
      personalityId: 'all',
      enabledAt: '2026-01-15T12:00:00.000Z',
      expiresAt: null,
      duration: 'forever',
    });

    it('should return true when specific personality session exists', async () => {
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.endsWith(':personality-456')) return validSession;
        return null;
      });

      const result = await redisService.isIncognitoActive('user-123', 'personality-456');

      expect(result).toBe(true);
    });

    it('should return true when global "all" session exists', async () => {
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key.endsWith(':all')) return validGlobalSession;
        return null;
      });

      const result = await redisService.isIncognitoActive('user-123', 'any-personality');

      expect(result).toBe(true);
    });

    it('should return false when no sessions exist', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await redisService.isIncognitoActive('user-123', 'personality-456');

      expect(result).toBe(false);
    });

    it('should clean up invalid session data and return false', async () => {
      mockRedis.get.mockResolvedValue('invalid json');
      mockRedis.del.mockResolvedValue(1);

      const result = await redisService.isIncognitoActive('user-123', 'personality-456');

      expect(result).toBe(false);
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should clean up session with wrong schema and return false', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
      mockRedis.del.mockResolvedValue(1);

      const result = await redisService.isIncognitoActive('user-123', 'personality-456');

      expect(result).toBe(false);
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should check both specific and global keys in parallel', async () => {
      mockRedis.get.mockResolvedValue(null);

      await redisService.isIncognitoActive('user-123', 'personality-456');

      expect(mockRedis.get).toHaveBeenCalledTimes(2);
      expect(mockRedis.get).toHaveBeenCalledWith(
        `${REDIS_KEY_PREFIXES.INCOGNITO}user-123:personality-456`
      );
      expect(mockRedis.get).toHaveBeenCalledWith(`${REDIS_KEY_PREFIXES.INCOGNITO}user-123:all`);
    });

    it('should return false on Redis error (fail open)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection lost'));

      const result = await redisService.isIncognitoActive('user-123', 'personality-456');

      // Should not throw, should return false to allow normal operation
      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should call redis.quit on close', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await redisService.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });

    it('should handle quit errors gracefully', async () => {
      mockRedis.quit.mockRejectedValue(new Error('Already disconnected'));

      // Should not throw - just propagate
      await expect(redisService.close()).rejects.toThrow('Already disconnected');
    });
  });
});
