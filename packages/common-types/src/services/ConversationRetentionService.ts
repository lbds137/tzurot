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

import type { PrismaClient } from './prisma.js';
import { Prisma } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { CLEANUP_DEFAULTS } from '../constants/index.js';

const logger = createLogger('ConversationRetentionService');

/**
 * Delete messages matching the where clause and create tombstones to prevent db-sync restoration.
 */
async function deleteMessagesWithTombstones(
  tx: Prisma.TransactionClient,
  where: Prisma.ConversationHistoryWhereInput
): Promise<number> {
  // Fetch messages that will be deleted (need IDs for tombstones)
  const messagesToDelete = await tx.conversationHistory.findMany({
    where,
    select: {
      id: true,
      channelId: true,
      personalityId: true,
      personaId: true,
    },
  });

  if (messagesToDelete.length === 0) {
    return 0;
  }

  // Create tombstones for all messages being deleted
  // This prevents db-sync from restoring them
  await tx.conversationHistoryTombstone.createMany({
    data: messagesToDelete.map(msg => ({
      id: msg.id,
      channelId: msg.channelId,
      personalityId: msg.personalityId,
      personaId: msg.personaId,
    })),
    skipDuplicates: true, // In case tombstone already exists
  });

  // Delete the actual messages
  const deleteResult = await tx.conversationHistory.deleteMany({ where });

  return deleteResult.count;
}

export class ConversationRetentionService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Clear conversation history for a channel + personality
   * Optionally filter by personaId for per-persona deletion
   * (useful for /reset and /history hard-delete commands)
   *
   * Creates tombstone records for deleted messages to prevent db-sync from
   * restoring them. Tombstones are small (just IDs) and can be periodically purged.
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

      const count = await this.prisma.$transaction(tx => deleteMessagesWithTombstones(tx, where));

      const scopeInfo =
        personaId !== undefined && personaId.length > 0
          ? `channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...`
          : `channel: ${channelId}, personality: ${personalityId}`;

      logger.info(`Cleared ${count} messages from history with tombstones (${scopeInfo})`);
      return count;
    } catch (error) {
      logger.error({ err: error }, `Failed to clear conversation history`);
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

      const count = await this.prisma.$transaction(tx =>
        deleteMessagesWithTombstones(tx, { createdAt: { lt: cutoffDate } })
      );

      logger.info(
        `Cleaned up ${count} old messages with tombstones (older than ${daysToKeep} days)`
      );
      return count;
    } catch (error) {
      logger.error({ err: error }, `Failed to cleanup old conversation history`);
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

      logger.info(`Cleaned up ${result.count} old tombstones (older than ${daysToKeep} days)`);
      return result.count;
    } catch (error) {
      logger.error({ err: error }, `Failed to cleanup old tombstones`);
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
        logger.info(
          `Hard deleted ${result.count} soft-deleted messages (deletedAt older than ${daysToKeep} days)`
        );
      }

      return result.count;
    } catch (error) {
      logger.error({ err: error }, `Failed to cleanup soft-deleted messages`);
      throw error;
    }
  }
}
