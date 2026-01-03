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

import type { PrismaClient } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { countTextTokens } from '../utils/tokenCounter.js';
import { SYNC_LIMITS } from '../constants/index.js';

const logger = createLogger('ConversationSyncService');

export class ConversationSyncService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Soft delete a message by setting deletedAt timestamp
   * Used when Discord message is detected as deleted during extended context fetch
   *
   * @param messageId Internal database message ID
   * @returns true if message was soft deleted
   */
  async softDeleteMessage(messageId: string): Promise<boolean> {
    try {
      await this.prisma.conversationHistory.update({
        where: { id: messageId },
        data: { deletedAt: new Date() },
      });

      logger.debug(`Soft deleted message ${messageId}`);
      return true;
    } catch (error) {
      logger.error({ err: error, messageId }, `Failed to soft delete message`);
      return false;
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
      const messages = await this.prisma.conversationHistory.findMany({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          channelId: true,
          personalityId: true,
          personaId: true,
        },
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

      logger.debug(`Updated message ${messageId} content (tokens: ${tokenCount})`);
      return true;
    } catch (error) {
      logger.error({ err: error, messageId }, `Failed to update message content`);
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
        `Found ${resultMap.size} DB messages for ${discordMessageIds.length} Discord IDs`
      );
      return resultMap;
    } catch (error) {
      logger.error({ err: error }, `Failed to get messages by Discord IDs`);
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
    limit = SYNC_LIMITS.DEFAULT_TIME_WINDOW_LIMIT
  ): Promise<
    {
      id: string;
      discordMessageId: string[];
      createdAt: Date;
    }[]
  > {
    try {
      const messages = await this.prisma.conversationHistory.findMany({
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

      return messages;
    } catch (error) {
      logger.error({ err: error }, `Failed to get messages in time window`);
      return [];
    }
  }
}
