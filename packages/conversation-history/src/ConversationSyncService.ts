/**
 * ConversationSyncService
 * Handles opportunistic synchronization between Discord and database
 *
 * Separated from ConversationHistoryService to isolate:
 * - Sync operations (detecting edits/deletes) from core CRUD operations
 * - Bot-client specific sync logic from general history management
 *
 * Uses tombstones to prevent db-sync from restoring deleted messages.
 */

import { SYNC_LIMITS } from '@tzurot/common-types/constants/timing';
import {
  collateChunksForSync,
  contentsDiffer,
  getOldestObservedTimestamp,
  type ObservedSyncMessage,
} from '@tzurot/common-types/services/conversationSyncDiff';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';

const logger = createLogger('ConversationSyncService');

/** Result of a runSync pass. */
export interface ConversationSyncResult {
  /** Messages whose content was updated (edit detected). */
  updated: number;
  /** Messages soft-deleted (present in DB window, absent from the snapshot). */
  deleted: number;
}

/** DB record shape used by the edit-detection pass. */
interface SyncDbMessage {
  id: string;
  content: string;
  discordMessageId: string[];
  deletedAt: Date | null;
  createdAt: Date;
}

/**
 * Group observed Discord messages by their DB record — a chunked assistant
 * reply spans several Discord messages that all map to one row. Soft-deleted
 * rows are excluded (the delete pass owns those).
 */
function groupObservedByDbRecord(
  observedMessages: ObservedSyncMessage[],
  dbMessages: Map<string, SyncDbMessage>
): Map<string, { dbMsg: SyncDbMessage; chunks: ObservedSyncMessage[] }> {
  const dbRecordToChunks = new Map<
    string,
    { dbMsg: SyncDbMessage; chunks: ObservedSyncMessage[] }
  >();
  for (const observed of observedMessages) {
    const dbMsg = dbMessages.get(observed.id);
    if (dbMsg?.deletedAt === null) {
      const existing = dbRecordToChunks.get(dbMsg.id);
      if (existing) {
        existing.chunks.push(observed);
      } else {
        dbRecordToChunks.set(dbMsg.id, { dbMsg, chunks: [observed] });
      }
    }
  }
  return dbRecordToChunks;
}

export class ConversationSyncService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Run the full opportunistic edit/delete sync for one channel+personality
   * against a snapshot of observed Discord messages.
   *
   * This is THE sync algorithm — api-gateway's `/internal/conversation/sync`
   * endpoint and bot-client's legacy direct path both delegate here, so the
   * two paths cannot drift during the dual-write window. Idempotent:
   * re-running an already-applied snapshot finds zero work.
   *
   * Errors are swallowed into logs (matching the defensive style of the
   * individual operations below) — sync is opportunistic and must never fail
   * the surrounding flow.
   */
  async runSync(
    channelId: string,
    personalityId: string,
    observedMessages: ObservedSyncMessage[]
  ): Promise<ConversationSyncResult> {
    const result: ConversationSyncResult = { updated: 0, deleted: 0 };

    try {
      if (observedMessages.length === 0) {
        return result;
      }

      result.updated = await this.applyEdits(channelId, personalityId, observedMessages);
      result.deleted = await this.applyDeletes(channelId, personalityId, observedMessages);

      if (result.updated > 0 || result.deleted > 0) {
        logger.info(
          { channelId, personalityId, updated: result.updated, deleted: result.deleted },
          'Opportunistic sync completed'
        );
      }

      return result;
    } catch (error) {
      logger.error({ channelId, personalityId, err: error }, 'Sync failed');
      return result;
    }
  }

  /**
   * Edit-detection pass: group observed messages by their DB record (chunked
   * assistant replies span several Discord messages), collate, and update
   * rows whose content genuinely differs.
   */
  private async applyEdits(
    channelId: string,
    personalityId: string,
    observedMessages: ObservedSyncMessage[]
  ): Promise<number> {
    const dbMessages = await this.getMessagesByDiscordIds(
      observedMessages.map(m => m.id),
      channelId,
      personalityId
    );

    if (dbMessages.size === 0) {
      logger.debug(
        { channelId, observedCount: observedMessages.length },
        'No matching DB messages for sync'
      );
      return 0;
    }

    const dbRecordToChunks = groupObservedByDbRecord(observedMessages, dbMessages);

    let updated = 0;
    for (const [dbId, { dbMsg, chunks }] of dbRecordToChunks) {
      const collatedContent = collateChunksForSync(dbId, dbMsg, chunks);
      if (collatedContent === null) {
        continue;
      }

      if (contentsDiffer(collatedContent, dbMsg.content)) {
        const didUpdate = await this.updateMessageContent(dbId, collatedContent);
        if (didUpdate) {
          updated++;
          logger.debug({ messageId: dbId, chunkCount: chunks.length }, 'Synced edited message');
        }
      }
    }
    return updated;
  }

  /**
   * Delete-detection pass: DB rows inside the observed time window whose
   * Discord IDs are all absent from the snapshot were deleted on Discord —
   * soft-delete them with tombstones.
   */
  private async applyDeletes(
    channelId: string,
    personalityId: string,
    observedMessages: ObservedSyncMessage[]
  ): Promise<number> {
    const oldestObservedTime = getOldestObservedTimestamp(observedMessages);
    // Unreachable via runSync (it returns early on an empty snapshot) — kept
    // as a backstop honoring getOldestObservedTimestamp's null contract so
    // this method stays safe if it ever gains another caller.
    if (oldestObservedTime === null) {
      return 0;
    }

    const dbMessagesInWindow = await this.getMessagesInTimeWindow(
      channelId,
      personalityId,
      oldestObservedTime
    );

    const observedIdSet = new Set(observedMessages.map(m => m.id));
    const deletedMessageIds: string[] = [];
    for (const dbMsg of dbMessagesInWindow) {
      const hasMatchingDiscordId = dbMsg.discordMessageId.some(id => observedIdSet.has(id));
      if (!hasMatchingDiscordId) {
        deletedMessageIds.push(dbMsg.id);
      }
    }

    if (deletedMessageIds.length === 0) {
      return 0;
    }

    const deleteCount = await this.softDeleteMessages(deletedMessageIds);
    logger.info(
      { channelId, deletedCount: deleteCount },
      'Soft deleted messages not found in Discord'
    );
    return deleteCount;
  }

  /**
   * Soft delete a message by setting deletedAt timestamp
   * Used when Discord message is detected as deleted during extended context fetch
   *
   * @param messageId Internal database message ID
   * @returns true if message was soft deleted
   */
  async softDeleteMessage(messageId: string): Promise<boolean> {
    try {
      const row = await this.prisma.conversationHistory.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
        select: { discordMessageId: true },
      });

      logger.debug({ messageId }, 'Soft deleted message');
      await this.propagateDeletionToMemories(row.discordMessageId);
      return true;
    } catch (error) {
      logger.error({ err: error, messageId }, 'Failed to soft delete message');
      return false;
    }
  }

  /**
   * Propagate source-message deletion to linked long-term memories
   * (memory-architecture Phase 0, R8: deletion means deletion). Memories carry
   * the triggering Discord message id in `messageIds`; when that turn is
   * deleted, the memory is soft-deleted (visibility='deleted' — the same state
   * the RAG retrieval filter excludes). Locked memories are deliberately
   * PRESERVED: a user pin is explicit curation that outranks source deletion —
   * the skip is logged so the tension stays observable. Non-fatal by design:
   * a propagation failure must never break the sync path.
   */
  private async propagateDeletionToMemories(discordMessageIds: string[]): Promise<void> {
    const ids = discordMessageIds.filter(id => id.length > 0);
    if (ids.length === 0) {
      return;
    }
    try {
      const result = await this.prisma.memory.updateMany({
        where: { messageIds: { hasSome: ids }, visibility: 'normal', isLocked: false },
        data: { visibility: 'deleted' },
      });
      if (result.count > 0) {
        logger.info(
          { memoriesDeleted: result.count, sourceMessages: ids.length },
          'Propagated message deletion to linked memories'
        );
      }
      const lockedRetained = await this.prisma.memory.count({
        where: { messageIds: { hasSome: ids }, visibility: 'normal', isLocked: true },
      });
      if (lockedRetained > 0) {
        logger.warn(
          { lockedRetained, sourceMessages: ids.length },
          'Locked memories retained despite source-message deletion (pin outranks propagation)'
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Memory deletion propagation failed (non-fatal)');
    }
  }

  /**
   * Bulk soft delete messages and create tombstones
   * Used during opportunistic sync when Discord messages are detected as deleted
   *
   * @param messageIds Array of internal database message IDs to soft delete
   * @returns Number of messages successfully soft deleted
   */
  async softDeleteMessages(messageIds: string[]): Promise<number> {
    if (messageIds.length === 0) {
      return 0;
    }

    try {
      // First get the message details for tombstone creation
      // Bounded query to prevent OOM with large arrays
      const messages = await this.prisma.conversationHistory.findMany({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          channelId: true,
          personalityId: true,
          personaId: true,
          discordMessageId: true,
        },
        take: Math.min(messageIds.length, SYNC_LIMITS.MAX_MESSAGE_BATCH),
      });

      // Soft delete messages and create tombstones in a transaction
      const now = new Date();
      await this.prisma.$transaction([
        // Soft delete all messages
        this.prisma.conversationHistory.updateMany({
          where: { id: { in: messageIds } },
          data: { deletedAt: now },
        }),
        // Create tombstones to prevent resurrection during db-sync
        this.prisma.conversationHistoryTombstone.createMany({
          data: messages.map(msg => ({
            id: msg.id,
            channelId: msg.channelId,
            personalityId: msg.personalityId,
            personaId: msg.personaId,
            deletedAt: now,
          })),
          skipDuplicates: true,
        }),
      ]);

      logger.info(
        { count: messageIds.length },
        `Soft deleted ${messageIds.length} messages with tombstones`
      );

      // NOTE: propagation shares the tombstone fetch's MAX_MESSAGE_BATCH bound —
      // a >1000-id bulk delete would soft-delete all rows but only propagate the
      // first 1000 turns' memories. Current callers (opportunistic sync windows)
      // are far below the bound; revisit with an unbounded id-only fetch if a
      // bulk path ever exceeds it.
      await this.propagateDeletionToMemories(messages.flatMap(m => m.discordMessageId));
      return messageIds.length;
    } catch (error) {
      logger.error({ err: error, count: messageIds.length }, `Failed to bulk soft delete messages`);
      return 0;
    }
  }

  /**
   * Update message content when edit is detected during sync
   * Also updates editedAt timestamp and recomputes token count
   *
   * @param messageId Internal database message ID
   * @param newContent Updated content from Discord
   * @returns true if message was updated
   */
  async updateMessageContent(messageId: string, newContent: string): Promise<boolean> {
    try {
      const tokenCount = countTextTokens(newContent);

      await this.prisma.conversationHistory.update({
        where: { id: messageId },
        data: {
          content: newContent,
          tokenCount,
          editedAt: new Date(),
        },
      });

      logger.debug({ messageId, tokenCount }, 'Updated message content');
      return true;
    } catch (error) {
      logger.error({ err: error, messageId }, 'Failed to update message content');
      return false;
    }
  }

  /**
   * Get messages by Discord message IDs for sync comparison
   * Returns messages that have the specified Discord IDs (including soft-deleted)
   *
   * @param discordMessageIds Array of Discord message IDs to look up
   * @param channelId Optional channel ID filter for performance
   * @param personalityId Optional personality ID filter for performance
   * @returns Map of Discord message ID to message data
   */
  async getMessagesByDiscordIds(
    discordMessageIds: string[],
    channelId?: string,
    personalityId?: string
  ): Promise<
    Map<
      string,
      {
        id: string;
        content: string;
        discordMessageId: string[];
        deletedAt: Date | null;
        createdAt: Date;
      }
    >
  > {
    if (discordMessageIds.length === 0) {
      return new Map();
    }

    try {
      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          discordMessageId: { hasSome: discordMessageIds },
          ...(channelId !== undefined && { channelId }),
          ...(personalityId !== undefined && { personalityId }),
        },
        select: {
          id: true,
          content: true,
          discordMessageId: true,
          deletedAt: true,
          createdAt: true,
        },
        // Bounded query: allow margin for chunked messages, cap at MAX_DISCORD_ID_LOOKUP
        take: Math.min(discordMessageIds.length * 2, SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP),
      });

      // Create a map from Discord message ID to message data
      // Note: A DB message can have multiple Discord IDs (chunked messages)
      const resultMap = new Map<
        string,
        {
          id: string;
          content: string;
          discordMessageId: string[];
          deletedAt: Date | null;
          createdAt: Date;
        }
      >();

      // Use Set for O(1) lookup instead of O(n) array includes
      const requestedIds = new Set(discordMessageIds);
      for (const msg of messages) {
        for (const discordId of msg.discordMessageId) {
          if (requestedIds.has(discordId)) {
            resultMap.set(discordId, msg);
          }
        }
      }

      logger.debug(
        { dbMessageCount: resultMap.size, discordIdCount: discordMessageIds.length },
        'Found DB messages for Discord IDs'
      );
      return resultMap;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get messages by Discord IDs');
      return new Map();
    }
  }

  /**
   * Get all non-deleted messages in a time window for a channel/personality
   * Used to detect deleted messages during sync (messages in DB but not in Discord)
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param since Only get messages after this timestamp
   * @param limit Maximum number of messages to return (default SYNC_LIMITS.DEFAULT_TIME_WINDOW_LIMIT, bounded for safety)
   * @returns Array of messages with their Discord IDs
   */
  async getMessagesInTimeWindow(
    channelId: string,
    personalityId: string,
    since: Date,
    limit: number = SYNC_LIMITS.DEFAULT_TIME_WINDOW_LIMIT
  ): Promise<
    {
      id: string;
      discordMessageId: string[];
      createdAt: Date;
    }[]
  > {
    try {
      return await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          personalityId,
          deletedAt: null, // Only non-deleted messages
          createdAt: { gte: since },
          discordMessageId: { isEmpty: false }, // Must have Discord ID to compare
        },
        select: {
          id: true,
          discordMessageId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: limit, // Bounded query to prevent OOM
      });
    } catch (error) {
      logger.error({ err: error }, `Failed to get messages in time window`);
      return [];
    }
  }
}
