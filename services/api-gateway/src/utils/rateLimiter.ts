/**
 * Simple in-memory rate limiter for API endpoints
 *
 * For production distributed deployments, this should be
 * replaced with Redis-backed rate limiting.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('rate-limiter');

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimiterOptions {
  /** Time window in milliseconds (default: 15 minutes) */
  windowMs?: number;
  /** Maximum requests per window (default: 10) */
  maxRequests?: number;
  /** Custom message for rate limit exceeded */
  message?: string;
  /** Key generator function (default: uses X-User-Id header) */
  keyGenerator?: (req: Request) => string;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_REQUESTS = 10;

/**
 * Create a rate limiting middleware
 *
 * @param options - Rate limiter configuration
 * @returns Express middleware function
 */
export function createRateLimiter(options: RateLimiterOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const message = options.message ?? 'Too many requests, please try again later';
  const keyGenerator = options.keyGenerator ?? defaultKeyGenerator;

  // In-memory store (for single instance)
  // TODO: Replace with Redis for distributed deployments
  const store = new Map<string, RateLimitEntry>();

  // Cleanup old entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.windowStart > windowMs) {
        store.delete(key);
      }
    }
  }, windowMs);

  // Prevent interval from keeping process alive
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);

    if (!key) {
      // No key = can't rate limit (should be caught by auth middleware)
      next();
      return;
    }

    const now = Date.now();
    let entry = store.get(key);

    // Check if we're in a new window
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 1, windowStart: now };
      store.set(key, entry);
      next();
      return;
    }

    // Increment counter
    entry.count++;

    // Check if over limit
    if (entry.count > maxRequests) {
      const resetTime = Math.ceil((entry.windowStart + windowMs - now) / 1000);

      logger.warn(
        { userId: key, count: entry.count, maxRequests },
        '[RateLimit] Rate limit exceeded'
      );

      res.status(StatusCodes.TOO_MANY_REQUESTS).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message,
        retryAfter: resetTime,
      });
      return;
    }

    next();
  };
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
export function createWalletRateLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 operations per 15 minutes
    message: 'Too many API key operations. Please try again later.',
  });
}
