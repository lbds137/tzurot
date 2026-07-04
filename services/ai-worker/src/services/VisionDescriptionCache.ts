/**
 * VisionDescriptionCache
 * Redis-backed L1 cache for image vision-API outputs and negative-cache cooldowns.
 *
 * Cache layout:
 * - Success descriptions: 1h Redis TTL (`VISION_DESCRIPTION_TTL`).
 * - Failure entries: per-category cooldown via `VISION_FAILURE_CACHE_POLICY`.
 *   AUTH/QUOTA failures get 5min cooldowns so transient OpenRouter glitches
 *   don't poison an attachment for its lifetime; attachment-bound failures
 *   (content-policy, dead URL, missing model) get 60min cooldowns.
 *
 * Cache key strategy:
 * 1. Namespace by the resolved vision model — so swapping the model (e.g. changing the
 *    global vision default) re-attempts immediately instead of replaying a poisoned /
 *    wrong-model entry for the OLD model
 * 2. Then prefer Discord attachment ID (stable snowflake) when available
 * 3. Fall back to URL hash (with query params stripped) for embed images
 *
 * History note: a PostgreSQL L2 layer existed prior to v3.0.0-beta.110 to
 * survive Redis restarts. It was removed because (a) Discord attachments are
 * ephemeral, so the persistence value is small, and (b) lacking a TTL or
 * eviction path, transient failures became permanent for affected attachments.
 * See git history / release notes for the original vision negative-cache incident.
 */

import type { Redis } from 'ioredis';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  VISION_FAILURE_CACHE_POLICY,
  ApiErrorCategory,
} from '@tzurot/common-types/constants/error';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import { deriveAttachmentCacheKey } from '@tzurot/common-types/utils/attachmentCacheKey';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('VisionDescriptionCache');

/** Options for cache key generation */
interface VisionCacheKeyOptions {
  /** Discord attachment ID (stable, preferred) */
  attachmentId?: string;
  /** Image URL (fallback) */
  url: string;
  /**
   * Resolved vision model that produced (or will produce) the entry. Namespaces the
   * cache key so a model swap re-attempts immediately instead of replaying a
   * poisoned/wrong-model entry for the old model. Optional: a missing model uses the
   * un-namespaced (legacy) key.
   */
  model?: string;
}

/** Options for storing a description (success path) */
type VisionStoreOptions = VisionCacheKeyOptions;

/** Options for storing a vision failure */
interface VisionFailureOptions extends VisionCacheKeyOptions {
  /** Error category from `parseApiError`. TTL is selected via `VISION_FAILURE_CACHE_POLICY`. */
  category: ApiErrorCategory;
}

/** Cached failure entry returned from getFailure */
export interface VisionFailureEntry {
  /** Error category */
  category: ApiErrorCategory;
  /**
   * ISO timestamp of when this entry was cached — useful for diagnosing "how long has this been
   * poisoned." Optional because pre-deploy Redis entries lack this field; consumers should treat
   * a missing value as "unknown age" rather than "just now."
   */
  cachedAt?: string;
}

export class VisionDescriptionCache {
  constructor(private redis: Redis) {}

  /**
   * Store a vision description in Redis L1.
   */
  async store(
    options: VisionStoreOptions,
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
        '[VisionDescriptionCache] Stored description in L1'
      );
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store description');
    }
  }

  /**
   * Get cached vision description from Redis L1.
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
          '[VisionDescriptionCache] L1 cache HIT'
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
   * Store a vision failure in the negative cache.
   *
   * TTL is selected per-category via `VISION_FAILURE_CACHE_POLICY` so that
   * possibly-transient failures (auth glitches, quota resets) get short
   * cooldowns and recover quickly, while attachment-bound failures (content
   * policy, dead URL, missing model) get longer cooldowns to avoid re-hammering.
   */
  async storeFailure(options: VisionFailureOptions): Promise<void> {
    try {
      const key = this.getFailureKey(options);
      const ttlSeconds = VISION_FAILURE_CACHE_POLICY[options.category].l1TtlSeconds;
      const cachedAt = new Date().toISOString();
      const value = JSON.stringify({ category: options.category, cachedAt });

      await this.redis.setex(key, ttlSeconds, value);

      logger.info(
        {
          attachmentId: options.attachmentId,
          category: options.category,
          ttlSeconds,
          cachedAt,
        },
        '[VisionDescriptionCache] Stored failure in negative cache'
      );
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to store failure');
    }
  }

  /**
   * Check if a vision failure is cached (negative cache check).
   * Returns the entry on hit, null on miss / OK to retry.
   */
  async getFailure(options: VisionCacheKeyOptions): Promise<VisionFailureEntry | null> {
    try {
      const key = this.getFailureKey(options);
      const value = await this.redis.get(key);

      if (value === null || value.length === 0) {
        return null;
      }

      const entry = JSON.parse(value) as VisionFailureEntry;
      logger.info(
        {
          attachmentId: options.attachmentId,
          category: entry.category,
          cachedAt: entry.cachedAt,
        },
        '[VisionDescriptionCache] Negative cache HIT'
      );
      return entry;
    } catch (error) {
      logger.error({ err: error }, '[VisionDescriptionCache] Failed to check failure cache');
      return null;
    }
  }

  /**
   * Generate cache key from attachment ID (preferred) or query-stripped URL
   * hash (fallback). Delegates to the shared `deriveAttachmentCacheKey` so the
   * voice + vision caches share one normalization strategy.
   */
  private getCacheKey(options: VisionCacheKeyOptions): string {
    return deriveAttachmentCacheKey(
      this.prefixWithModel(REDIS_KEY_PREFIXES.VISION_DESCRIPTION, options.model),
      {
        id: options.attachmentId,
        url: options.url,
      }
    );
  }

  /**
   * Generate failure cache key (separate namespace from success cache).
   */
  private getFailureKey(options: VisionCacheKeyOptions): string {
    return deriveAttachmentCacheKey(
      this.prefixWithModel(REDIS_KEY_PREFIXES.VISION_FAILURE, options.model),
      {
        id: options.attachmentId,
        url: options.url,
      }
    );
  }

  /**
   * Namespace a key prefix by the resolved vision model so entries are per-(attachment,
   * model) — a model swap re-attempts rather than replaying the old model's entry. The
   * model is sanitized (only `[A-Za-z0-9._-]` survive) so it can't introduce the `:`
   * key delimiter. A missing model returns the bare prefix (legacy un-namespaced key).
   */
  private prefixWithModel(prefix: string, model?: string): string {
    if (model === undefined || model.length === 0) {
      return prefix;
    }
    const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${prefix}:${safeModel}`;
  }
}
