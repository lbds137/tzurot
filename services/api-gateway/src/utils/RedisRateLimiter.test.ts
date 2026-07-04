/**
 * Tests for Redis Rate Limiter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Mock } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import {
  RedisRateLimiter,
  createRedisWalletRateLimiter,
  createRedisWalletReadRateLimiter,
  createRedisPublicRouteRateLimiter,
} from './RedisRateLimiter.js';

/**
 * Minimal Redis client interface for rate limiting
 * Only includes methods actually used by RedisRateLimiter
 */
interface MockRedisClient {
  eval: Mock<(script: string, numKeys: number, ...args: (string | number)[]) => Promise<number>>;
  ttl: Mock<(key: string) => Promise<number>>;
  get: Mock<(key: string) => Promise<string | null>>;
  del: Mock<(key: string) => Promise<number>>;
}

// Mock ioredis with proper typing
const mockRedis: MockRedisClient = {
  eval: vi.fn(), // Lua script execution (atomic INCR + EXPIRE)
  ttl: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
};

// Mock common-types
vi.mock('@tzurot/common-types/constants/queue', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/queue')>(
    '@tzurot/common-types/constants/queue'
  );
  return {
    ...actual,
    REDIS_KEY_PREFIXES: {
      RATE_LIMIT: 'ratelimit:',
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

describe('RedisRateLimiter', () => {
  let limiter: RedisRateLimiter;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    limiter = new RedisRateLimiter(mockRedis as unknown as import('ioredis').Redis, {
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
      set: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe('middleware', () => {
    it('should allow request when under limit', async () => {
      // Lua script returns the incremented count
      mockRedis.eval.mockResolvedValue(1);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      // Wait for async to complete
      await new Promise(resolve => setImmediate(resolve));

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should use atomic Lua script for INCR + EXPIRE', async () => {
      mockRedis.eval.mockResolvedValue(1);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      // Should call eval with Lua script, 1 key, the key, and TTL
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call'),
        1,
        'ratelimit:user-123',
        60
      );
    });

    it('should allow subsequent requests under limit', async () => {
      mockRedis.eval.mockResolvedValue(3);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockNext).toHaveBeenCalled();
    });

    it('should block request when over limit', async () => {
      mockRedis.eval.mockResolvedValue(6);
      mockRedis.ttl.mockResolvedValue(30);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
      expect(mockRes.set).toHaveBeenCalledWith('Retry-After', '30');
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        retryAfter: 30,
      });
    });

    it('should fall back to windowSeconds for Retry-After when TTL is missing', async () => {
      // Edge case: Redis returns -1 (no TTL) or -2 (key not found) for ttl().
      // The handler falls back to the configured window to ensure clients
      // still get a sensible back-off rather than 0 or a bogus value.
      mockRedis.eval.mockResolvedValue(6);
      mockRedis.ttl.mockResolvedValue(-1);

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRes.set).toHaveBeenCalledWith('Retry-After', '60');
    });

    it('should allow request through on Redis error (fail open)', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis connection lost'));

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      // Should fail open
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should skip rate limiting when no user key (returns null)', async () => {
      mockReq.headers = {};

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip rate limiting when user key is empty string', async () => {
      mockReq.headers = { 'x-user-id': '' };

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip rate limiting when user key is whitespace-only', async () => {
      mockReq.headers = { 'x-user-id': '   ' };

      const middleware = limiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('custom key generator', () => {
    it('should use custom key generator', async () => {
      const customLimiter = new RedisRateLimiter(mockRedis as unknown as import('ioredis').Redis, {
        keyGenerator: req => {
          const apiKey = req.headers['x-api-key'] as string | undefined;
          return apiKey && apiKey.length > 0 ? apiKey : null;
        },
      });

      mockReq.headers = { 'x-api-key': 'my-api-key' };
      mockRedis.eval.mockResolvedValue(1);

      const middleware = customLimiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      // Check eval was called with the custom key
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:my-api-key',
        expect.any(Number)
      );
    });

    it('should skip rate limiting when custom key generator returns null', async () => {
      const customLimiter = new RedisRateLimiter(mockRedis as unknown as import('ioredis').Redis, {
        keyGenerator: () => null,
      });

      const middleware = customLimiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.eval).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('custom key prefix', () => {
    it('should use custom key prefix', async () => {
      const customLimiter = new RedisRateLimiter(mockRedis as never, {
        keyPrefix: 'custom:prefix:',
      });

      mockRedis.eval.mockResolvedValue(1);

      const middleware = customLimiter.middleware();
      middleware(mockReq as Request, mockRes as Response, mockNext);

      await new Promise(resolve => setImmediate(resolve));

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'custom:prefix:user-123',
        expect.any(Number)
      );
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

describe('createRedisWalletReadRateLimiter', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  const mockReq = { headers: { 'x-user-id': 'user-123' } } as unknown as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  it('uses the dedicated wallet-read key prefix', async () => {
    mockRedis.eval.mockResolvedValue(1);
    createRedisWalletReadRateLimiter(mockRedis as never)(mockReq, mockRes as Response, mockNext);
    await new Promise(resolve => setImmediate(resolve));
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call'),
      1,
      'ratelimit:wallet-read:user-123',
      60
    );
  });

  it('allows reads well past the strict 10-per-window mutation budget', async () => {
    // The 11th read in a window would be blocked by the strict wallet limiter;
    // the read limiter lets it through (limit is 60/min), so browsing the model
    // list never falsely degrades usability to "needs a key".
    mockRedis.eval.mockResolvedValue(11);
    createRedisWalletReadRateLimiter(mockRedis as never)(mockReq, mockRes as Response, mockNext);
    await new Promise(resolve => setImmediate(resolve));
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('blocks once the generous read budget is exceeded', async () => {
    mockRedis.eval.mockResolvedValue(61);
    mockRedis.ttl.mockResolvedValue(30);
    createRedisWalletReadRateLimiter(mockRedis as never)(mockReq, mockRes as Response, mockNext);
    await new Promise(resolve => setImmediate(resolve));
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
  });
});

describe('createRedisPublicRouteRateLimiter', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    };
    mockNext = vi.fn();
  });

  function buildReq(overrides: { xff?: string | string[]; socketAddr?: string }): Request {
    return {
      headers: overrides.xff !== undefined ? { 'x-forwarded-for': overrides.xff } : {},
      socket: { remoteAddress: overrides.socketAddr },
    } as unknown as Request;
  }

  it('should rate-limit using the X-Forwarded-For header', async () => {
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: '203.0.113.42' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:203.0.113.42',
      60
    );
    expect(mockNext).toHaveBeenCalled();
  });

  it('should take the RIGHTMOST XFF entry to defeat spoofing', async () => {
    // Attacker injects `X-Forwarded-For: 1.2.3.4`. Railway appends the real
    // client IP, so XFF arrives as "1.2.3.4, 198.51.100.7". The rightmost
    // entry (198.51.100.7) is the one Railway saw and cannot be spoofed.
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: '1.2.3.4, 198.51.100.7' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:198.51.100.7',
      60
    );
  });

  it('should combine rightmost-XFF + IPv6 bracket stripping on multi-hop headers', async () => {
    // Intersection of two security paths: attacker injects an IPv4 entry,
    // Railway appends a bracketed IPv6 client address. Should resolve to the
    // bare bracketless IPv6 form.
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: '1.2.3.4, [2001:db8::1]' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:2001:db8::1',
      60
    );
  });

  it('should strip RFC 7239 IPv6 brackets so [addr] and addr share a bucket', async () => {
    // Upstream proxies may emit `X-Forwarded-For: [2001:db8::1]` (RFC 7239
    // §6.3 bracket form) or the bare `2001:db8::1`. Both should land in the
    // same Redis key — otherwise the same client gets split-bucket rate
    // limits depending on header formatting.
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: '[2001:db8::1]' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:2001:db8::1',
      60
    );
  });

  it('should handle XFF arriving as a string[] (Express type contract)', async () => {
    // Node.js normally joins repeated headers, but Express types still allow
    // `string[]`. The key generator flattens both shapes before parsing.
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: ['1.2.3.4', '198.51.100.7'] }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:198.51.100.7',
      60
    );
  });

  it('should fall back to socket.remoteAddress when no XFF header', async () => {
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ socketAddr: '127.0.0.1' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:127.0.0.1',
      60
    );
  });

  it('should fall back to socket.remoteAddress when XFF is empty string', async () => {
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: '', socketAddr: '127.0.0.1' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:127.0.0.1',
      60
    );
  });

  it('should fall back to socket.remoteAddress when XFF is only commas/whitespace', async () => {
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({ xff: ' , , ', socketAddr: '127.0.0.1' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:127.0.0.1',
      60
    );
  });

  it('should fall back to "unknown" bucket when neither XFF nor socket is available', async () => {
    mockRedis.eval.mockResolvedValue(1);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 60);
    middleware(buildReq({}), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'ratelimit:public:unknown',
      60
    );
  });

  it('should honor the maxRequestsPerMinute argument', async () => {
    mockRedis.eval.mockResolvedValue(11);
    mockRedis.ttl.mockResolvedValue(30);

    const middleware = createRedisPublicRouteRateLimiter(mockRedis as never, 10);
    middleware(buildReq({ xff: '203.0.113.42' }), mockRes as Response, mockNext);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRes.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
    expect(mockRes.set).toHaveBeenCalledWith('Retry-After', '30');
    expect(mockNext).not.toHaveBeenCalled();
  });
});
