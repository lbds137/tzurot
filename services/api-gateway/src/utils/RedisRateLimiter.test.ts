/**
 * Tests for Redis Rate Limiter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { RedisRateLimiter, createRedisWalletRateLimiter } from './RedisRateLimiter.js';

// Mock ioredis
const mockRedis = {
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
};

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  REDIS_KEY_PREFIXES: {
    RATE_LIMIT: 'ratelimit:',
  },
}));

describe('RedisRateLimiter', () => {
  let limiter: RedisRateLimiter;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    limiter = new RedisRateLimiter(mockRedis as never, {
      windowMs: 60000, // 1 minute
      maxRequests: 5,
    });

    mockReq = {
      headers: {
        'x-user-id': 'user-123',
      },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('middleware', () => {
    it('should allow request when under limit', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async to complete
      await new Promise(resolve => setImmediate(resolve));

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should set TTL on first request', async () => {
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.expire).toHaveBeenCalledWith('ratelimit:user-123', 60);
    });

    it('should not set TTL on subsequent requests', async () => {
      mockRedis.incr.mockResolvedValue(3);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.expire).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should block request when over limit', async () => {
      mockRedis.incr.mockResolvedValue(6);
      mockRedis.ttl.mockResolvedValue(30);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        retryAfter: 30,
      });
    });

    it('should allow request through on Redis error', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis connection lost'));

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      // Should fail open
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should skip rate limiting when no user key', async () => {
      mockReq.headers = {};

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.incr).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('custom key generator', () => {
    it('should use custom key generator', async () => {
      const customLimiter = new RedisRateLimiter(mockRedis as never, {
        keyGenerator: req => (req.headers['x-api-key'] as string) ?? '',
      });

      mockReq.headers = { 'x-api-key': 'my-api-key' };
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const middleware = customLimiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.incr).toHaveBeenCalledWith('ratelimit:my-api-key');
    });
  });

  describe('custom key prefix', () => {
    it('should use custom key prefix', async () => {
      const customLimiter = new RedisRateLimiter(mockRedis as never, {
        keyPrefix: 'custom:prefix:',
      });

      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const middleware = customLimiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.incr).toHaveBeenCalledWith('custom:prefix:user-123');
    });
  });

  describe('getCount', () => {
    it('should return current count', async () => {
      mockRedis.get.mockResolvedValue('3');

      const count = await limiter.getCount('user-123');

      expect(count).toBe(3);
      expect(mockRedis.get).toHaveBeenCalledWith('ratelimit:user-123');
    });

    it('should return 0 for non-existent key', async () => {
      mockRedis.get.mockResolvedValue(null);

      const count = await limiter.getCount('user-123');

      expect(count).toBe(0);
    });
  });

  describe('reset', () => {
    it('should delete the key', async () => {
      mockRedis.del.mockResolvedValue(1);

      await limiter.reset('user-123');

      expect(mockRedis.del).toHaveBeenCalledWith('ratelimit:user-123');
    });
  });
});

describe('createRedisWalletRateLimiter', () => {
  it('should create middleware with wallet-specific settings', () => {
    const middleware = createRedisWalletRateLimiter(mockRedis as never);

    expect(typeof middleware).toBe('function');
  });
});
