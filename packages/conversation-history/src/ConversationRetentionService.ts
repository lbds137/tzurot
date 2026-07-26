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
import { propagateDeletionToMemories } from './memoryDeletionPropagation.js';

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
 *
 * `onBatchDeleted` fires once per committed batch with that batch's Discord
 * message ids. It is per-batch rather than a single accumulated list at the end
 * because the retention sweep can delete tens of thousands of rows — holding
 * every id in memory to hand back at the end would turn a bounded sweep into an
 * unbounded allocation. Callers that don't need the ids simply omit it and
 * nothing is collected.
 */
async function deleteMessagesInBatches(
  prisma: PrismaClient,
  where: Prisma.ConversationHistoryWhereInput,
  onBatchDeleted?: (discordMessageIds: string[]) => Promise<void>
): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const { fetched, discordMessageIds } = await prisma.$transaction(async tx => {
      const batch = await tx.conversationHistory.findMany({
        where,
        // discordMessageId only when a caller asked for it — the retention
        // sweep pays nothing for a column it will never read.
        select: { id: true, ...(onBatchDeleted !== undefined && { discordMessageId: true }) },
        take: SYNC_LIMITS.RETENTION_BATCH_SIZE,
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) {
        return { fetched: 0, discordMessageIds: [] };
      }

      const deleteResult = await tx.conversationHistory.deleteMany({
        where: { id: { in: batch.map(msg => msg.id) } },
      });
      totalDeleted += deleteResult.count;
      return {
        fetched: batch.length,
        discordMessageIds: batch.flatMap(msg => msg.discordMessageId ?? []),
      };
    });

    // AFTER the batch commits, never inside its transaction: the propagation
    // writes to a different table, and holding the conversation rows' locks
    // across it is exactly the cross-table lock-hold this batching exists to
    // avoid. A crash in between leaves memories un-propagated, which the user
    // can still clear via /memory — strictly better than a wedged sweep.
    if (onBatchDeleted !== undefined && discordMessageIds.length > 0) {
      await onBatchDeleted(discordMessageIds);
    }

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
   * This is a USER-REQUESTED deletion, so it propagates to the memories derived
   * from the deleted turns (R8: deletion means deletion). Without that, a purge
   * removed the conversation but left its memories retrievable, and RAG pulled
   * them straight back into the next prompt — the character still "remembered" a
   * conversation the user had just erased. The propagation must happen HERE
   * rather than after the fact, because the hard delete destroys the only rows
   * that map a memory back to its source message.
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

      const count = await deleteMessagesInBatches(this.prisma, where, discordMessageIds =>
        propagateDeletionToMemories(this.prisma, discordMessageIds)
      );

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
