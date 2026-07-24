/**
 * ConversationRetentionService
 * Handles cleanup and retention policies for conversation history
 *
 * Separated from ConversationHistoryService to isolate:
 * - Cold path (scheduled cleanup jobs) from hot path (CRUD operations)
 * - Retention policy logic from message management logic
 *
 * Hard deletes are recorded for db-sync by the
 * sync_tombstone_conversation_history AFTER DELETE trigger, so no app-level
 * tombstone write is needed.
 */

import { CLEANUP_DEFAULTS, SYNC_LIMITS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient, type Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ConversationRetentionService');

/**
 * Delete messages matching the where clause in batches, so a large sweep never
 * holds row locks across the whole operation. The AFTER DELETE sync_tombstone
 * trigger records each deletion for db-sync — no app-level tombstone write.
 *
 * Atomicity is PER BATCH — each batch commits in its own transaction, releasing
 * row locks between batches. A single sweep-wide transaction would hold every
 * deleted row's lock until the final commit, and the main pool's `lock_timeout`
 * (3s) would then fail any concurrent writer waiting on one of those rows for the
 * whole sweep duration. Cross-batch atomicity is not needed: a partial sweep just
 * leaves rows for the next run. No cursor needed — each committed batch removes
 * its rows from the `where` result set, so a plain re-fetch naturally advances.
 */
async function deleteMessagesInBatches(
  prisma: PrismaClient,
  where: Prisma.ConversationHistoryWhereInput
): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const fetched = await prisma.$transaction(async tx => {
      const batch = await tx.conversationHistory.findMany({
        where,
        select: { id: true },
        take: SYNC_LIMITS.RETENTION_BATCH_SIZE,
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) {
        return 0;
      }

      const deleteResult = await tx.conversationHistory.deleteMany({
        where: { id: { in: batch.map(msg => msg.id) } },
      });
      totalDeleted += deleteResult.count;
      return batch.length;
    });

    // A short batch means the where-set is drained.
    if (fetched < SYNC_LIMITS.RETENTION_BATCH_SIZE) {
      break;
    }
  }

  return totalDeleted;
}

export class ConversationRetentionService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Clear conversation history for a channel + personality
   * Optionally filter by personaId for per-persona deletion
   * (useful for /history clear and /history purge)
   *
   * NOT atomic end-to-end: deletion commits per batch (see
   * deleteMessagesInBatches), so a mid-sweep failure leaves a partial delete and
   * a retry picks up the remainder. Chosen over all-or-nothing so a large clear
   * can't hold row locks across the whole sweep. Each hard delete is recorded for
   * db-sync by the AFTER DELETE trigger.
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param personaId Optional persona ID - if provided, only deletes messages for that persona
   */
  async clearHistory(
    channelId: string,
    personalityId: string,
    personaId?: string
  ): Promise<number> {
    try {
      const where: Prisma.ConversationHistoryWhereInput = {
        channelId,
        personalityId,
        ...(personaId !== undefined && personaId.length > 0 && { personaId }),
      };

      const count = await deleteMessagesInBatches(this.prisma, where);

      logger.info(
        {
          count,
          channelId,
          personalityId,
          personaIdPrefix:
            personaId !== undefined && personaId.length > 0 ? personaId.substring(0, 8) : null,
        },
        'Cleared messages from history'
      );
      return count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to clear conversation history');
      throw error;
    }
  }

  /**
   * Clean up old history (older than X days)
   * Call this periodically to prevent unbounded growth. Each hard delete is
   * recorded for db-sync by the AFTER DELETE trigger.
   */
  async cleanupOldHistory(
    daysToKeep: number = CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY
  ): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const count = await deleteMessagesInBatches(this.prisma, {
        createdAt: { lt: cutoffDate },
      });

      logger.info({ count, daysToKeep }, 'Cleaned up old messages');
      return count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to cleanup old conversation history');
      throw error;
    }
  }

  /**
   * Hard delete soft-deleted messages (those with deletedAt set) older than X days.
   * Soft-deleted messages are excluded from context but still take up space; this
   * is the final cleanup after the soft-delete grace period. Each hard delete is
   * recorded for db-sync by the AFTER DELETE trigger.
   *
   * @param daysToKeep Only delete soft-deleted messages older than this many days
   */
  async cleanupSoftDeletedMessages(
    daysToKeep: number = CLEANUP_DEFAULTS.DAYS_TO_KEEP_SOFT_DELETED
  ): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      // Hard delete messages that were soft-deleted before the cutoff date
      const result = await this.prisma.conversationHistory.deleteMany({
        where: {
          deletedAt: {
            lt: cutoffDate,
          },
        },
      });

      if (result.count > 0) {
        logger.info({ count: result.count, daysToKeep }, 'Hard deleted soft-deleted messages');
      }

      return result.count;
    } catch (error) {
      logger.error({ err: error }, `Failed to cleanup soft-deleted messages`);
      throw error;
    }
  }
}
