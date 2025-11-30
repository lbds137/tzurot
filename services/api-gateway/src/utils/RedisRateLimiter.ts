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

export interface RedisRateLimiterOptions {
  /** Time window in milliseconds (default: 15 minutes) */
  windowMs?: number;
  /** Maximum requests per window (default: 10) */
  maxRequests?: number;
  /** Custom message for rate limit exceeded */
  message?: string;
  /** Key generator function (default: uses X-User-Id header) */
  keyGenerator?: (req: Request) => string;
  /** Optional key prefix (default: 'ratelimit:') */
  keyPrefix?: string;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_KEY_PREFIX = REDIS_KEY_PREFIXES.RATE_LIMIT;

/**
 * Redis-backed rate limiter factory
 */
export class RedisRateLimiter {
  private readonly redis: Redis;
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly message: string;
  private readonly keyGenerator: (req: Request) => string;
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

    if (!userKey) {
      // No key = can't rate limit (should be caught by auth middleware)
      next();
      return;
    }

    const key = `${this.keyPrefix}${userKey}`;
    const windowSeconds = Math.ceil(this.windowMs / 1000);

    try {
      // Atomically increment counter and set TTL on first access
      // INCR creates the key with value 1 if it doesn't exist
      const count = await this.redis.incr(key);

      // Set TTL only on first request (when count is 1)
      if (count === 1) {
        await this.redis.expire(key, windowSeconds);
      }

      // Check if over limit
      if (count > this.maxRequests) {
        // Get remaining TTL for retry-after header
        const ttl = await this.redis.ttl(key);
        const resetTime = ttl > 0 ? ttl : windowSeconds;

        logger.warn(
          { userId: userKey, count, maxRequests: this.maxRequests },
          '[RateLimit] Rate limit exceeded'
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
        '[RateLimit] Redis error - allowing request through'
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
 */
function defaultKeyGenerator(req: Request): string {
  return (req.headers['x-user-id'] as string) ?? '';
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
