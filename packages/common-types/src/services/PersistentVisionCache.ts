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

import type { PrismaClient } from '../generated/prisma/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PersistentVisionCache');

export interface PersistentVisionCacheEntry {
  attachmentId: string;
  description: string;
  model: string;
}

export class PersistentVisionCache {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get a cached image description from PostgreSQL
   * @param attachmentId Discord attachment snowflake ID
   * @returns Description and model, or null if not found
   */
  async get(attachmentId: string): Promise<PersistentVisionCacheEntry | null> {
    try {
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
    } catch (error) {
      logger.error({ err: error, attachmentId }, '[PersistentVisionCache] Failed to get entry');
      return null;
    }
  }

  /**
   * Store an image description in PostgreSQL
   * Uses upsert to handle duplicates gracefully
   * @param entry The cache entry to store
   */
  async set(entry: PersistentVisionCacheEntry): Promise<void> {
    try {
      await this.prisma.imageDescriptionCache.upsert({
        where: { attachmentId: entry.attachmentId },
        create: {
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
    } catch (error) {
      logger.error(
        { err: error, attachmentId: entry.attachmentId },
        '[PersistentVisionCache] Failed to store entry'
      );
    }
  }

  /**
   * Check if an attachment ID exists in the cache
   * @param attachmentId Discord attachment snowflake ID
   * @returns true if entry exists
   */
  async has(attachmentId: string): Promise<boolean> {
    try {
      const count = await this.prisma.imageDescriptionCache.count({
        where: { attachmentId },
      });
      return count > 0;
    } catch (error) {
      logger.error({ err: error, attachmentId }, '[PersistentVisionCache] Failed to check entry');
      return false;
    }
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
      // Ignore "not found" errors
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        return;
      }
      logger.error({ err: error, attachmentId }, '[PersistentVisionCache] Failed to delete entry');
    }
  }
}
