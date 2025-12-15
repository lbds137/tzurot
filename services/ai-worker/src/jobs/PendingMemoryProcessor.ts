/**
 * Pending Memory Processor
 *
 * Processes pending_memory records that failed to store to the vector database.
 * Runs as a scheduled job to retry failed memory storage operations.
 */

import type { PrismaClient } from '@tzurot/common-types';
import { PgvectorMemoryAdapter, MemoryMetadataSchema } from '../services/PgvectorMemoryAdapter.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('PendingMemoryProcessor');

interface ProcessingStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

interface PendingMemoryRecord {
  id: string;
  text: string;
  metadata: unknown;
  attempts: number;
}

const MAX_ATTEMPTS = 3;

export class PendingMemoryProcessor {
  private memoryAdapter: PgvectorMemoryAdapter | undefined;

  constructor(
    private prisma: PrismaClient,
    memoryAdapter: PgvectorMemoryAdapter | undefined
  ) {
    this.memoryAdapter = memoryAdapter;
  }

  /**
   * Process all pending memories that haven't exceeded retry limit
   */
  async processPendingMemories(): Promise<ProcessingStats> {
    const adapter = this.memoryAdapter;
    if (!adapter) {
      logger.warn({}, '[PendingMemory] Memory adapter unavailable, skipping processing');
      return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
    }

    try {
      const stats: ProcessingStats = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
      const pendingMemories = await this.fetchPendingMemories();

      if (pendingMemories.length === 0) {
        logger.debug('[PendingMemory] No pending memories to process');
        return stats;
      }

      logger.info(`[PendingMemory] Processing ${pendingMemories.length} pending memories`);

      for (const pending of pendingMemories) {
        stats.processed++;
        await this.processSingleMemory(pending, stats, adapter);
      }

      logger.info({ ...stats }, '[PendingMemory] Batch complete');
      return stats;
    } catch (error) {
      logger.error({ err: error }, '[PendingMemory] Failed to process pending memories');
      return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
    }
  }

  private async fetchPendingMemories(): Promise<PendingMemoryRecord[]> {
    return this.prisma.pendingMemory.findMany({
      where: { attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  private async processSingleMemory(
    pending: PendingMemoryRecord,
    stats: ProcessingStats,
    adapter: PgvectorMemoryAdapter
  ): Promise<void> {
    const validationResult = MemoryMetadataSchema.safeParse(pending.metadata);

    if (!validationResult.success) {
      await this.handleInvalidMetadata(pending, validationResult.error);
      stats.skipped++;
      return;
    }

    try {
      await adapter.addMemory({
        text: pending.text,
        metadata: validationResult.data,
      });
      await this.prisma.pendingMemory.delete({ where: { id: pending.id } });
      stats.succeeded++;
      logger.debug(`[PendingMemory] Successfully stored pending memory ${pending.id}`);
    } catch (error) {
      await this.handleStorageFailure(pending, error);
      stats.failed++;
    }
  }

  private async handleInvalidMetadata(
    pending: PendingMemoryRecord,
    error: { message: string; flatten: () => unknown }
  ): Promise<void> {
    logger.error(
      { pendingId: pending.id, validationError: error.flatten(), invalidData: pending.metadata },
      '[PendingMemory] Metadata validation failed, skipping record'
    );
    await this.prisma.pendingMemory.update({
      where: { id: pending.id },
      data: {
        attempts: 999,
        lastAttemptAt: new Date(),
        error: `Invalid metadata: ${error.message}`,
      },
    });
  }

  private async handleStorageFailure(pending: PendingMemoryRecord, error: unknown): Promise<void> {
    const newAttempts = pending.attempts + 1;
    const shouldGiveUp = newAttempts >= MAX_ATTEMPTS;

    await this.prisma.pendingMemory.update({
      where: { id: pending.id },
      data: {
        attempts: newAttempts,
        lastAttemptAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });

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
