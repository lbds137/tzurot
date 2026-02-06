/**
 * PersistentVisionCache (L2 Cache)
 *
 * PostgreSQL-backed persistent cache for image descriptions.
 * Used as L2 fallback when Redis L1 cache misses.
 *
 * Benefits:
 * - Survives Redis restarts
 * - Reduces API costs for frequently accessed images
 * - Uses stable Discord attachment IDs (snowflakes) as keys
 *
 * @see VisionDescriptionCache for L1 (Redis) cache
 */

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { createLogger } from '../utils/logger.js';
import { generateImageDescriptionCacheUuid } from '../utils/deterministicUuid.js';

const logger = createLogger('PersistentVisionCache');

export interface PersistentVisionCacheEntry {
  attachmentId: string;
  description: string;
  model: string;
}

export interface PersistentVisionFailureEntry {
  category: string;
}

export class PersistentVisionCache {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get a cached image description from PostgreSQL
   * @param attachmentId Discord attachment snowflake ID
   * @returns Description and model, or null if not found
   */
  async get(attachmentId: string): Promise<PersistentVisionCacheEntry | null> {
    const entry = await this.prisma.imageDescriptionCache.findUnique({
      where: { attachmentId },
      select: {
        attachmentId: true,
        description: true,
        model: true,
      },
    });

    if (entry !== null) {
      logger.info(
        { attachmentId },
        '[PersistentVisionCache] L2 cache HIT - found persistent description'
      );
      return entry;
    }

    logger.debug({ attachmentId }, '[PersistentVisionCache] L2 cache MISS');
    return null;
  }

  /**
   * Store an image description in PostgreSQL
   * Uses upsert to handle duplicates gracefully
   * @param entry The cache entry to store
   */
  async set(entry: PersistentVisionCacheEntry): Promise<void> {
    await this.prisma.imageDescriptionCache.upsert({
      where: { attachmentId: entry.attachmentId },
      create: {
        id: generateImageDescriptionCacheUuid(entry.attachmentId),
        attachmentId: entry.attachmentId,
        description: entry.description,
        model: entry.model,
      },
      update: {
        description: entry.description,
        model: entry.model,
      },
    });

    logger.debug(
      { attachmentId: entry.attachmentId, model: entry.model },
      '[PersistentVisionCache] Stored description in L2 cache'
    );
  }

  /**
   * Check if an attachment ID exists in the cache
   * @param attachmentId Discord attachment snowflake ID
   * @returns true if entry exists
   */
  async has(attachmentId: string): Promise<boolean> {
    const count = await this.prisma.imageDescriptionCache.count({
      where: { attachmentId },
    });
    return count > 0;
  }

  /**
   * Store a permanent failure in PostgreSQL
   * Uses upsert to handle duplicates - overwrites any previous success entry
   * @param attachmentId Discord attachment snowflake ID
   * @param category Failure category (e.g., 'authentication', 'content_policy')
   */
  async setFailure(attachmentId: string, category: string): Promise<void> {
    await this.prisma.imageDescriptionCache.upsert({
      where: { attachmentId },
      create: {
        id: generateImageDescriptionCacheUuid(attachmentId),
        attachmentId,
        description: '[permanent failure]',
        model: 'none',
        failureCategory: category,
      },
      update: {
        description: '[permanent failure]',
        model: 'none',
        failureCategory: category,
      },
    });

    logger.debug(
      { attachmentId, category },
      '[PersistentVisionCache] Stored permanent failure in L2 cache'
    );
  }

  /**
   * Get a cached failure from PostgreSQL
   * @param attachmentId Discord attachment snowflake ID
   * @returns Failure category, or null if no failure is cached
   */
  async getFailure(attachmentId: string): Promise<PersistentVisionFailureEntry | null> {
    const entry = await this.prisma.imageDescriptionCache.findUnique({
      where: { attachmentId },
      select: { failureCategory: true },
    });

    if (entry?.failureCategory !== null && entry?.failureCategory !== undefined) {
      logger.info(
        { attachmentId, category: entry.failureCategory },
        '[PersistentVisionCache] L2 failure cache HIT'
      );
      return { category: entry.failureCategory };
    }

    return null;
  }

  /**
   * Delete a cached entry (rarely needed, mainly for testing)
   * @param attachmentId Discord attachment snowflake ID
   */
  async delete(attachmentId: string): Promise<void> {
    try {
      await this.prisma.imageDescriptionCache.delete({
        where: { attachmentId },
      });
      logger.debug({ attachmentId }, '[PersistentVisionCache] Deleted entry');
    } catch (error) {
      // P2025: Record not found - delete is idempotent, ignore this error
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return;
      }
      // Re-throw actual database errors
      throw error;
    }
  }
}
