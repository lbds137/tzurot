/**
 * Redis-backed Rate Limiter
 *
 * Uses Redis for distributed rate limiting, enabling horizontal scaling
 * of API Gateway instances. Each instance shares rate limit state through Redis.
 *
 * Implementation uses Redis INCR with TTL for a simple sliding window approach.
 */

import type { Redis } from 'ioredis';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger, REDIS_KEY_PREFIXES } from '@tzurot/common-types';

const logger = createLogger('RedisRateLimiter');

interface RedisRateLimiterOptions {
  /** Time window in milliseconds (default: 15 minutes) */
  windowMs?: number;
  /** Maximum requests per window (default: 10) */
  maxRequests?: number;
  /** Custom message for rate limit exceeded */
  message?: string;
  /** Key generator function - return null to skip rate limiting (default: uses X-User-Id header) */
  keyGenerator?: (req: Request) => string | null;
  /** Optional key prefix (default: 'ratelimit:') */
  keyPrefix?: string;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_KEY_PREFIX = REDIS_KEY_PREFIXES.RATE_LIMIT;

/**
 * Lua script for atomic INCR + EXPIRE
 *
 * This prevents the race condition where a process could crash between
 * INCR and EXPIRE, leaving a key without TTL (permanent rate limit).
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = TTL in seconds
 *
 * Returns the incremented count
 */
const INCR_WITH_EXPIRE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

/**
 * Redis-backed rate limiter factory
 */
export class RedisRateLimiter {
  private readonly redis: Redis;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly message: string;
  private readonly keyGenerator: (req: Request) => string | null;
  private readonly keyPrefix: string;

  constructor(redis: Redis, options: RedisRateLimiterOptions = {}) {
    this.redis = redis;
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.message = options.message ?? 'Too many requests, please try again later';
    this.keyGenerator = options.keyGenerator ?? defaultKeyGenerator;
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  }

  /**
   * Create Express middleware for rate limiting
   */
  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Wrap async logic
      void this.checkRateLimit(req, res, next);
    };
  }

  /**
   * Check rate limit for a request
   */
  private async checkRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const userKey = this.keyGenerator(req);

    if (userKey === null) {
      // No key = can't rate limit, allow through
      // This happens for unauthenticated requests (should be caught by auth middleware)
      logger.debug('[RateLimiter.checkRateLimit] No user key, skipping rate limit');
      next();
      return;
    }

    const key = `${this.keyPrefix}${userKey}`;
    const windowSeconds = Math.ceil(this.windowMs / 1000);

    try {
      // Use Lua script for atomic INCR + EXPIRE
      // This prevents race condition where process crash between INCR and EXPIRE
      // could leave a key without TTL (permanent rate limit)
      const count = (await this.redis.eval(INCR_WITH_EXPIRE_LUA, 1, key, windowSeconds)) as number;

      // Check if over limit
      if (count > this.maxRequests) {
        // Get remaining TTL for retry-after header
        const ttl = await this.redis.ttl(key);
        const resetTime = ttl > 0 ? ttl : windowSeconds;

        logger.warn(
          { userId: userKey, count, maxRequests: this.maxRequests },
          '[RateLimiter.checkRateLimit] Rate limit exceeded'
        );

        res.status(StatusCodes.TOO_MANY_REQUESTS).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: this.message,
          retryAfter: resetTime,
        });
        return;
      }

      next();
    } catch (error) {
      // On Redis error, log and allow request through
      // (fail open to prevent service disruption)
      logger.error(
        { err: error, userId: userKey },
        '[RateLimiter.checkRateLimit] Redis error - allowing request through'
      );
      next();
    }
  }

  /**
   * Get current count for a key (for testing/debugging)
   */
  async getCount(userKey: string): Promise<number> {
    const key = `${this.keyPrefix}${userKey}`;
    const count = await this.redis.get(key);
    return count !== null ? parseInt(count, 10) : 0;
  }

  /**
   * Reset rate limit for a key (for testing)
   */
  async reset(userKey: string): Promise<void> {
    const key = `${this.keyPrefix}${userKey}`;
    await this.redis.del(key);
  }
}

/**
 * Default key generator - uses X-User-Id header
 *
 * Returns null if no user ID is present to skip rate limiting.
 * This prevents all anonymous requests from sharing a single rate limit bucket.
 */
function defaultKeyGenerator(req: Request): string | null {
  const userId = req.headers['x-user-id'] as string | undefined;
  // Check for undefined, null, empty, or whitespace-only strings
  if (userId === undefined || userId === null || userId.trim().length === 0) {
    return null;
  }
  return userId;
}

/**
 * Create rate limiter for wallet operations
 *
 * More restrictive than general API limits since these
 * involve external API calls and sensitive operations.
 */
export function createRedisWalletRateLimiter(redis: Redis): RequestHandler {
  const limiter = new RedisRateLimiter(redis, {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 operations per 15 minutes
    message: 'Too many API key operations. Please try again later.',
    keyPrefix: 'ratelimit:wallet:',
  });
  return limiter.middleware();
}

/**
 * Create rate limiter for denylist admin operations (POST/DELETE)
 *
 * Denylist mutations are infrequent admin actions. Rate limit to
 * prevent accidental rapid-fire changes, not DDoS protection.
 */
export function createRedisDenylistRateLimiter(redis: Redis): RequestHandler {
  const limiter = new RedisRateLimiter(redis, {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 mutations per minute
    message: 'Too many denylist operations. Please try again later.',
    keyPrefix: 'ratelimit:denylist:',
  });
  return limiter.middleware();
}
