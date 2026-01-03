/**
 * VisionDescriptionCache
 * Two-tier cache for image descriptions to avoid duplicate vision API calls
 *
 * Cache Architecture:
 * - L1 (Redis): Fast, ephemeral, TTL-based (1 hour default)
 * - L2 (PostgreSQL): Persistent, survives Redis restarts, no TTL
 *
 * Lookup Strategy:
 * 1. Check L1 (Redis) → return if found
 * 2. Check L2 (PostgreSQL) → populate L1 and return if found
 * 3. Return null (cache miss)
 *
 * Write Strategy:
 * - Always write to L1 (Redis)
 * - Write to L2 (PostgreSQL) only when attachmentId is available (stable key)
 *
 * Cache Key Strategy:
 * 1. Prefer Discord attachment ID (stable snowflake) when available
 * 2. Fall back to URL hash (with query params stripped) for embed images
 *
 * @see PersistentVisionCache for L2 implementation
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createLogger } from '../utils/logger.js';
import { REDIS_KEY_PREFIXES, INTERVALS, TEXT_LIMITS } from '../constants/index.js';
import type { PersistentVisionCache } from './PersistentVisionCache.js';

/** Configuration for L2 cache write retries */
const L2_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
} as const;

const logger = createLogger('VisionDescriptionCache');

/** Options for cache key generation */
export interface VisionCacheKeyOptions {
  /** Discord attachment ID (stable, preferred) */
  attachmentId?: string;
  /** Image URL (fallback) */
  url: string;
}

/** Options for storing with L2 cache */
export interface VisionStoreOptions extends VisionCacheKeyOptions {
  /** Model that generated the description (for L2 cache) */
  model?: string;
}

export class VisionDescriptionCache {
  private l2Cache: PersistentVisionCache | null = null;

  constructor(private redis: Redis) {}

  /**
   * Set the L2 (PostgreSQL) cache for persistent storage
   * @param cache PersistentVisionCache instance
   */
  setL2Cache(cache: PersistentVisionCache): void {
    this.l2Cache = cache;
    logger.info('[VisionDescriptionCache] L2 cache enabled');
  }

  /**
   * Store vision description in cache
   * @param options Cache key options (attachmentId preferred, url as fallback)
   * @param description Generated image description
   * @param ttlSeconds Time to live in seconds (default: 1 hour)
   */
  async store(
    options: VisionStoreOptions,
    description: string,
    ttlSeconds: number = INTERVALS.VISION_DESCRIPTION_TTL
  ): Promise<void> {
    try {
      // Always write to L1 (Redis)
      const key = this.getCacheKey(options);
      await this.redis.setex(key, ttlSeconds, description);
      logger.debug(
        {
          attachmentId: options.attachmentId,
          urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
        },
        '[VisionDescriptionCache] Stored description in L1'
      );

      // Write to L2 (PostgreSQL) only when attachmentId is available
      // L2 uses stable attachment IDs, not URL hashes
      if (
        this.l2Cache !== null &&
        options.attachmentId !== undefined &&
        options.attachmentId !== ''
      ) {
        // L2 write with retry logic for resilience
        await this.writeToL2WithRetry(
          options.attachmentId,
          description,
          options.model ?? 'unknown'
        );
      }
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store description');
    }
  }

  /**
   * Get cached vision description (checks L1, then L2)
   * @param options Cache key options (attachmentId preferred, url as fallback)
   * @returns Description text or null if not found
   */
  async get(options: VisionCacheKeyOptions): Promise<string | null> {
    try {
      // Step 1: Check L1 (Redis)
      const key = this.getCacheKey(options);
      const l1Description = await this.redis.get(key);

      if (l1Description !== null && l1Description.length > 0) {
        logger.info(
          {
            attachmentId: options.attachmentId,
            urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
          },
          '[VisionDescriptionCache] L1 cache HIT'
        );
        return l1Description;
      }

      // Step 2: Check L2 (PostgreSQL) if attachmentId is available
      if (
        this.l2Cache !== null &&
        options.attachmentId !== undefined &&
        options.attachmentId !== ''
      ) {
        const l2Entry = await this.l2Cache.get(options.attachmentId);

        if (l2Entry !== null) {
          // Populate L1 from L2 for future fast access
          await this.redis.setex(key, INTERVALS.VISION_DESCRIPTION_TTL, l2Entry.description);
          logger.info(
            { attachmentId: options.attachmentId },
            '[VisionDescriptionCache] L2 cache HIT - populated L1'
          );
          return l2Entry.description;
        }
      }

      logger.debug(
        {
          attachmentId: options.attachmentId,
          urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
        },
        '[VisionDescriptionCache] Cache MISS (L1 and L2)'
      );
      return null;
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to get description');
      return null;
    }
  }

  /**
   * Write to L2 cache with exponential backoff retry
   * Fire-and-forget with logging - doesn't throw on failure
   */
  private async writeToL2WithRetry(
    attachmentId: string,
    description: string,
    model: string
  ): Promise<void> {
    if (this.l2Cache === null) {
      return;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < L2_RETRY_CONFIG.maxRetries; attempt++) {
      try {
        await this.l2Cache.set({ attachmentId, description, model });
        logger.debug(
          { attachmentId, attempt: attempt + 1 },
          '[VisionDescriptionCache] Stored description in L2'
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt < L2_RETRY_CONFIG.maxRetries - 1) {
          // Exponential backoff with jitter
          const delay = Math.min(
            L2_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
            L2_RETRY_CONFIG.maxDelayMs
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          logger.debug(
            { attachmentId, attempt: attempt + 1, delayMs: delay },
            '[VisionDescriptionCache] L2 write failed, retrying'
          );
        }
      }
    }

    // All retries exhausted - log warning but don't throw
    logger.warn(
      { attachmentId, err: lastError, maxRetries: L2_RETRY_CONFIG.maxRetries },
      '[VisionDescriptionCache] L2 write failed after all retries - L1 cache still valid'
    );
  }

  /**
   * Generate cache key from attachment ID (preferred) or URL (fallback)
   *
   * Priority:
   * 1. If attachmentId is provided, use it directly (stable Discord snowflake)
   * 2. Otherwise, hash the URL with query params stripped (for URL stability)
   */
  private getCacheKey(options: VisionCacheKeyOptions): string {
    if (options.attachmentId !== undefined && options.attachmentId !== '') {
      // Attachment ID is stable - use it directly
      return `${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}id:${options.attachmentId}`;
    }

    // Fallback: Strip query params and hash the base URL
    // Discord CDN URLs like: https://cdn.discordapp.com/attachments/123/456/image.png?ex=...&is=...&hm=...
    // Becomes: https://cdn.discordapp.com/attachments/123/456/image.png
    const baseUrl = options.url.split('?')[0];
    const urlHash = createHash('sha256').update(baseUrl).digest('hex');
    return `${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}url:${urlHash}`;
  }
}
