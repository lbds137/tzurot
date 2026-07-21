/**
 * ConversationRetentionService
 * Handles cleanup and retention policies for conversation history
 *
 * Separated from ConversationHistoryService to isolate:
 * - Cold path (scheduled cleanup jobs) from hot path (CRUD operations)
 * - Retention policy logic from message management logic
 *
 * Uses tombstones to prevent db-sync from restoring deleted messages.
 */

import { CLEANUP_DEFAULTS, SYNC_LIMITS } from '@tzurot/common-types/constants/timing';
import { type PrismaClient, type Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ConversationRetentionService');

/**
 * Delete messages matching the where clause and create tombstones to prevent db-sync restoration.
 * Processes in batches to prevent OOM on large datasets.
 *
 * Atomicity is PER BATCH — each batch's tombstone-create + delete commits in its own
 * transaction, releasing row locks between batches. A single sweep-wide transaction
 * would hold every deleted row's lock until the final commit, and the main pool's
 * `lock_timeout` (3s) would then fail any concurrent writer waiting on one of those
 * rows for the whole sweep duration. Cross-batch atomicity is not needed: a partial
 * sweep just leaves rows for the next run, and the tombstone-before-delete invariant
 * (the thing that actually matters for db-sync) holds within each batch. No cursor
 * needed — each committed batch removes its rows from the `where` result set, so a
 * plain re-fetch naturally advances.
 */
async function deleteMessagesWithTombstones(
  prisma: PrismaClient,
  where: Prisma.ConversationHistoryWhereInput
): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const fetched = await prisma.$transaction(async tx => {
      const batch = await tx.conversationHistory.findMany({
        where,
        select: {
          id: true,
          channelId: true,
          personalityId: true,
          personaId: true,
        },
        take: SYNC_LIMITS.RETENTION_BATCH_SIZE,
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) {
        return 0;
      }

      // Create tombstones for this batch BEFORE deleting — prevents db-sync
      // from restoring the rows if it runs between batches.
      await tx.conversationHistoryTombstone.createMany({
        data: batch.map(msg => ({
          id: msg.id,
          channelId: msg.channelId,
          personalityId: msg.personalityId,
          personaId: msg.personaId,
        })),
        skipDuplicates: true, // In case tombstone already exists
      });

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
   * Creates tombstone records for deleted messages to prevent db-sync from
   * restoring them. Tombstones are small (just IDs) and can be periodically purged.
   *
   * NOT atomic end-to-end: deletion commits per batch (see
   * deleteMessagesWithTombstones), so a mid-sweep failure leaves a partial
   * delete — already-deleted rows stay tombstoned, and a retry picks up the
   * remainder. Chosen over all-or-nothing so a large clear can't hold row
   * locks across the whole sweep.
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

      const count = await deleteMessagesWithTombstones(this.prisma, where);

      logger.info(
        {
          count,
          channelId,
          personalityId,
          personaIdPrefix:
            personaId !== undefined && personaId.length > 0 ? personaId.substring(0, 8) : null,
        },
        'Cleared messages from history with tombstones'
      );
      return count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to clear conversation history');
      throw error;
    }
  }

  /**
   * Clean up old history (older than X days)
   * Call this periodically to prevent unbounded growth.
   * Creates tombstones to prevent db-sync from restoring deleted messages.
   */
  async cleanupOldHistory(
    daysToKeep: number = CLEANUP_DEFAULTS.DAYS_TO_KEEP_HISTORY
  ): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const count = await deleteMessagesWithTombstones(this.prisma, {
        createdAt: { lt: cutoffDate },
      });

      logger.info({ count, daysToKeep }, 'Cleaned up old messages with tombstones');
      return count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to cleanup old conversation history');
      throw error;
    }
  }

  /**
   * Clean up old tombstones (older than X days)
   * Tombstones only need to exist long enough for db-sync to propagate deletions.
   * Call this periodically to prevent unbounded growth.
   */
  async cleanupOldTombstones(
    daysToKeep: number = CLEANUP_DEFAULTS.DAYS_TO_KEEP_TOMBSTONES
  ): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await this.prisma.conversationHistoryTombstone.deleteMany({
        where: {
          deletedAt: {
            lt: cutoffDate,
          },
        },
      });

      logger.info({ count: result.count, daysToKeep }, 'Cleaned up old tombstones');
      return result.count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to cleanup old tombstones');
      throw error;
    }
  }

  /**
   * Hard delete soft-deleted messages (those with deletedAt set) older than X days.
   * Soft-deleted messages are excluded from context but still take up space.
   * This performs the final cleanup after the soft-delete grace period.
   *
   * Note: Tombstones already exist for these messages (created during soft delete),
   * so we can safely delete them without creating new tombstones.
   *
   * @param daysToKeep Only delete soft-deleted messages older than this many days
   */
  async cleanupSoftDeletedMessages(
    daysToKeep: number = CLEANUP_DEFAULTS.DAYS_TO_KEEP_TOMBSTONES
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
