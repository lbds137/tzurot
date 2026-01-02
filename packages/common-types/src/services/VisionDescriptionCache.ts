/**
 * VisionDescriptionCache
 * Caches image descriptions to avoid duplicate vision API calls
 *
 * This addresses the two different code paths for image processing:
 * 1. Direct attachments: Preprocessed via ImageDescriptionJob
 * 2. Referenced message images: Processed inline by ReferencedMessageFormatter
 *
 * By caching descriptions by image URL, both code paths benefit from the cache,
 * avoiding duplicate API calls for the same image across different contexts.
 *
 * Cache Key Strategy:
 * 1. Prefer Discord attachment ID (stable snowflake) when available
 * 2. Fall back to URL hash (with query params stripped) for embed images
 *
 * This fixes the issue where Discord CDN URLs expire and change query params,
 * causing cache misses for the same image.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createLogger } from '../utils/logger.js';
import { REDIS_KEY_PREFIXES, INTERVALS, TEXT_LIMITS } from '../constants/index.js';

const logger = createLogger('VisionDescriptionCache');

/** Options for cache key generation */
export interface VisionCacheKeyOptions {
  /** Discord attachment ID (stable, preferred) */
  attachmentId?: string;
  /** Image URL (fallback) */
  url: string;
}

export class VisionDescriptionCache {
  constructor(private redis: Redis) {}

  /**
   * Store vision description in cache
   * @param options Cache key options (attachmentId preferred, url as fallback)
   * @param description Generated image description
   * @param ttlSeconds Time to live in seconds (default: 1 hour)
   */
  async store(
    options: VisionCacheKeyOptions,
    description: string,
    ttlSeconds: number = INTERVALS.VISION_DESCRIPTION_TTL
  ): Promise<void> {
    try {
      const key = this.getCacheKey(options);
      await this.redis.setex(key, ttlSeconds, description);
      logger.debug(
        {
          attachmentId: options.attachmentId,
          urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
        },
        '[VisionDescriptionCache] Stored description'
      );
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store description');
    }
  }

  /**
   * Get cached vision description
   * @param options Cache key options (attachmentId preferred, url as fallback)
   * @returns Description text or null if not found
   */
  async get(options: VisionCacheKeyOptions): Promise<string | null> {
    try {
      const key = this.getCacheKey(options);
      const description = await this.redis.get(key);

      if (description !== null && description.length > 0) {
        logger.info(
          {
            attachmentId: options.attachmentId,
            urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
          },
          '[VisionDescriptionCache] Cache HIT - avoiding duplicate vision API call'
        );
        return description;
      }

      logger.debug(
        {
          attachmentId: options.attachmentId,
          urlPrefix: options.url.substring(0, TEXT_LIMITS.URL_LOG_PREVIEW),
        },
        '[VisionDescriptionCache] Cache MISS'
      );
      return null;
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to get description');
      return null;
    }
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
