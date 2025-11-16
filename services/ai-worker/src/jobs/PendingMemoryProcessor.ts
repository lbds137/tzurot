/**
 * Pending Memory Processor
 *
 * Processes pending_memory records that failed to store to the vector database.
 * Runs as a scheduled job to retry failed memory storage operations.
 */

import { PrismaClient } from '@prisma/client';
import { PgvectorMemoryAdapter } from '../services/PgvectorMemoryAdapter.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('PendingMemoryProcessor');

export class PendingMemoryProcessor {
  private prisma: PrismaClient;
  private memoryAdapter: PgvectorMemoryAdapter | undefined;

  constructor(memoryAdapter: PgvectorMemoryAdapter | undefined) {
    this.prisma = new PrismaClient();
    this.memoryAdapter = memoryAdapter;
  }

  /**
   * Process all pending memories that haven't exceeded retry limit
   */
  async processPendingMemories(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
  }> {
    // If memory adapter is unavailable, skip processing
    if (!this.memoryAdapter) {
      logger.warn({}, '[PendingMemory] Memory adapter unavailable, skipping pending memory processing');
      return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
    }

    try {
      const maxAttempts = 3;
      const stats = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

      // Fetch pending memories that haven't exceeded retry limit
      const pendingMemories = await this.prisma.pendingMemory.findMany({
        where: {
          attempts: { lt: maxAttempts },
        },
        orderBy: {
          createdAt: 'asc', // Process oldest first
        },
        take: 100, // Process up to 100 at a time to avoid overwhelming the system
      });

      if (pendingMemories.length === 0) {
        logger.debug('[PendingMemory] No pending memories to process');
        return stats;
      }

      logger.info(`[PendingMemory] Processing ${pendingMemories.length} pending memories`);

      for (const pending of pendingMemories) {
        stats.processed++;

        try {
          // Attempt to store the memory
          await this.memoryAdapter.addMemory({
            text: pending.text,
            metadata: pending.metadata as any, // Cast from Json to MemoryMetadata
          });

          // Success! Delete the pending memory
          await this.prisma.pendingMemory.delete({
            where: { id: pending.id },
          });

          stats.succeeded++;
          logger.debug(`[PendingMemory] Successfully stored pending memory ${pending.id}`);
        } catch (error) {
          // Failed - update attempt count and error message
          const newAttempts = pending.attempts + 1;
          const shouldGiveUp = newAttempts >= maxAttempts;

          await this.prisma.pendingMemory.update({
            where: { id: pending.id },
            data: {
              attempts: newAttempts,
              lastAttemptAt: new Date(),
              error: error instanceof Error ? error.message : String(error),
            },
          });

          stats.failed++;

          if (shouldGiveUp) {
            logger.error(
              { err: error, pendingId: pending.id, attempts: newAttempts },
              '[PendingMemory] Gave up on pending memory after max attempts'
            );
          } else {
            logger.warn(
              { err: error, pendingId: pending.id, attempts: newAttempts },
              '[PendingMemory] Failed to store pending memory, will retry'
            );
          }
        }
      }

      logger.info(
        { ...stats },
        `[PendingMemory] Batch complete: ${stats.succeeded} succeeded, ${stats.failed} failed`
      );

      return stats;
    } catch (error) {
      logger.error({ err: error }, '[PendingMemory] Failed to process pending memories');
      return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
    }
  }

  /**
   * Get statistics about pending memories
   */
  async getStats(): Promise<{
    total: number;
    byAttempts: Record<number, number>;
  }> {
    try {
      const pending = await this.prisma.pendingMemory.findMany({
        select: { attempts: true },
      });

      const byAttempts: Record<number, number> = {};
      for (const p of pending) {
        byAttempts[p.attempts] = (byAttempts[p.attempts] || 0) + 1;
      }

      return {
        total: pending.length,
        byAttempts,
      };
    } catch (error) {
      logger.error({ err: error }, '[PendingMemory] Failed to get stats');
      return { total: 0, byAttempts: {} };
    }
  }

  /**
   * Cleanup - disconnect Prisma
   */
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
