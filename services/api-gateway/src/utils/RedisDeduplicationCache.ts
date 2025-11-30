/**
 * Redis-backed Request Deduplication Cache
 *
 * Prevents duplicate AI requests by caching recent requests in Redis
 * and returning the same job ID for identical requests within a short time window.
 *
 * Redis-backed implementation enables horizontal scaling of API Gateway instances
 * since all instances share the same deduplication state.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createLogger, INTERVALS, REDIS_KEY_PREFIXES } from '@tzurot/common-types';
import type { GenerateRequest, CachedRequest } from '../types.js';

const logger = createLogger('RequestDeduplication');

export interface RedisDeduplicationOptions {
  /**
   * Time window (seconds) for duplicate detection
   * @default INTERVALS.REQUEST_DEDUP_WINDOW / 1000 (5 seconds)
   */
  duplicateWindowSeconds?: number;
}

/**
 * Redis-backed Request Deduplication Cache
 *
 * Uses Redis SET with TTL for automatic expiration - no cleanup interval needed.
 *
 * Example usage:
 * ```typescript
 * const cache = new RedisDeduplicationCache(redis);
 *
 * // Check for duplicates
 * const cached = await cache.checkDuplicate(request);
 * if (cached) {
 *   return cached.jobId;
 * }
 *
 * // Cache new request
 * await cache.cacheRequest(request, requestId, jobId);
 * ```
 */
export class RedisDeduplicationCache {
  private readonly redis: Redis;
  private readonly duplicateWindowSeconds: number;
  private readonly keyPrefix: string;

  constructor(redis: Redis, options: RedisDeduplicationOptions = {}) {
    this.redis = redis;
    this.duplicateWindowSeconds =
      options.duplicateWindowSeconds ?? Math.ceil(INTERVALS.REQUEST_DEDUP_WINDOW / 1000);
    this.keyPrefix = REDIS_KEY_PREFIXES.REQUEST_DEDUP;
  }

  /**
   * Check if a request is a duplicate and return cached job if so
   * @returns Cached request if duplicate found, null otherwise
   */
  async checkDuplicate(request: GenerateRequest): Promise<CachedRequest | null> {
    const hash = this.hashRequest(request);
    const key = `${this.keyPrefix}${hash}`;

    try {
      const cached = await this.redis.get(key);

      if (cached === null) {
        return null;
      }

      const data = JSON.parse(cached) as CachedRequest;
      const timeSinceRequest = Date.now() - data.timestamp;

      logger.info(
        `[Deduplication] Found duplicate request, returning cached job ${data.jobId} (${timeSinceRequest}ms ago)`
      );

      return data;
    } catch (error) {
      // Log error but don't fail the request - deduplication is a performance optimization
      logger.error({ err: error }, '[Deduplication] Failed to check duplicate, proceeding');
      return null;
    }
  }

  /**
   * Cache a request to prevent duplicates
   */
  async cacheRequest(request: GenerateRequest, requestId: string, jobId: string): Promise<void> {
    const hash = this.hashRequest(request);
    const key = `${this.keyPrefix}${hash}`;
    const now = Date.now();

    const data: CachedRequest = {
      requestId,
      jobId,
      timestamp: now,
      expiresAt: now + this.duplicateWindowSeconds * 1000,
    };

    try {
      // Use SETEX for atomic set + expiry
      await this.redis.setex(key, this.duplicateWindowSeconds, JSON.stringify(data));
      logger.debug(`[Deduplication] Cached request ${requestId} with job ${jobId}`);
    } catch (error) {
      // Log error but don't fail the request
      logger.error({ err: error }, '[Deduplication] Failed to cache request');
    }
  }

  /**
   * Get approximate cache size (for monitoring)
   *
   * Uses SCAN instead of KEYS to avoid blocking Redis.
   * SCAN iterates incrementally and doesn't block the server.
   */
  async getCacheSize(): Promise<number> {
    try {
      let cursor = '0';
      let count = 0;

      do {
        // SCAN returns [newCursor, keys]
        // COUNT is a hint, not a guarantee - Redis may return more or fewer
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.keyPrefix}*`,
          'COUNT',
          100
        );
        cursor = newCursor;
        count += keys.length;
      } while (cursor !== '0');

      return count;
    } catch (error) {
      logger.error({ err: error }, '[Deduplication] Failed to get cache size');
      return 0;
    }
  }

  /**
   * Create a hash for a request to detect duplicates
   * Uses SHA-256 for stable, collision-resistant hashing
   */
  private hashRequest(request: GenerateRequest): string {
    const { personality, message, context } = request;

    // Create hash from key components
    const personalityName = personality.name;
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    const contextStr = `${context.userId}-${context.channelId ?? 'dm'}`;

    // Create stable hash using SHA-256 for the entire message
    // 16 hex chars = 64 bits of entropy (sufficient for current usage)
    const messageHash = createHash('sha256').update(messageStr).digest('hex').substring(0, 16);

    return `${personalityName}:${contextStr}:${messageHash}`;
  }
}
