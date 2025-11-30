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
 */

import type { Redis } from 'ioredis';
import { createLogger } from '../utils/logger.js';
import { REDIS_KEY_PREFIXES, INTERVALS } from '../constants/index.js';

const logger = createLogger('VisionDescriptionCache');

export class VisionDescriptionCache {
  constructor(private redis: Redis) {}

  /**
   * Store vision description in cache
   * @param imageUrl Image URL (the URL used for the vision API call)
   * @param description Generated image description
   * @param ttlSeconds Time to live in seconds (default: 1 hour)
   */
  async store(
    imageUrl: string,
    description: string,
    ttlSeconds: number = INTERVALS.VISION_DESCRIPTION_TTL
  ): Promise<void> {
    try {
      const key = this.getCacheKey(imageUrl);
      await this.redis.setex(key, ttlSeconds, description);
      logger.debug(
        { urlPrefix: imageUrl.substring(0, 60) },
        '[VisionDescriptionCache] Stored description'
      );
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store description');
    }
  }

  /**
   * Get cached vision description
   * @param imageUrl Image URL (the URL used for the vision API call)
   * @returns Description text or null if not found
   */
  async get(imageUrl: string): Promise<string | null> {
    try {
      const key = this.getCacheKey(imageUrl);
      const description = await this.redis.get(key);

      if (description !== null && description.length > 0) {
        logger.info(
          { urlPrefix: imageUrl.substring(0, 60) },
          '[VisionDescriptionCache] Cache HIT - avoiding duplicate vision API call'
        );
        return description;
      }

      logger.debug(
        { urlPrefix: imageUrl.substring(0, 60) },
        '[VisionDescriptionCache] Cache MISS'
      );
      return null;
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to get description');
      return null;
    }
  }

  /**
   * Generate cache key from image URL
   * Uses URL hash to handle long URLs
   */
  private getCacheKey(imageUrl: string): string {
    return `${REDIS_KEY_PREFIXES.VISION_DESCRIPTION}${imageUrl}`;
  }
}
