/**
 * ConversationHistoryService
 * Manages short-term conversation history in PostgreSQL
 *
 * Note: This service consolidates all conversation history operations (CRUD, pagination,
 * cleanup, tombstones) in one file for cohesion. Data transformation is handled by
 * ConversationMessageMapper to reduce duplication.
 */

import type { PrismaClient } from './prisma.js';
import { Prisma } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MessageRole, CLEANUP_DEFAULTS } from '../constants/index.js';
import { countTextTokens } from '../utils/tokenCounter.js';
import type { MessageMetadata } from '../types/schemas.js';
import {
  conversationHistorySelect,
  mapToConversationMessage,
  mapToConversationMessages,
} from './ConversationMessageMapper.js';

const logger = createLogger('ConversationHistoryService');

/**
 * Delete messages matching the where clause and create tombstones to prevent db-sync restoration.
 * This is the internal implementation used by both clearHistory and cleanupOldHistory.
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

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  tokenCount?: number; // Cached token count (computed once, reused on every request)
  createdAt: Date;
  personaId: string;
  personaName?: string; // The persona's name for display in context
  discordUsername?: string; // Discord username for disambiguation when persona name matches personality name
  discordMessageId: string[]; // Discord snowflake IDs for chunked messages (deduplication)
  messageMetadata?: MessageMetadata; // Structured metadata (referenced messages, attachments)
}

/**
 * Options for adding a message to conversation history
 */
export interface AddMessageOptions {
  /** Discord channel ID */
  channelId: string;
  /** Personality ID */
  personalityId: string;
  /** User's persona ID */
  personaId: string;
  /** Message role (user or assistant) */
  role: MessageRole;
  /** Message content */
  content: string;
  /** Discord guild ID (null for DMs). Required to explicitly handle DM vs guild context. */
  guildId: string | null;
  /**
   * Discord message ID(s). Can be:
   * - string: single message ID (user messages, single-chunk assistant messages)
   * - string[]: multiple message IDs (chunked assistant messages)
   * - undefined: no Discord message ID yet
   */
  discordMessageId?: string | string[];
  /**
   * Optional timestamp for the message. If provided, overrides the default
   * PostgreSQL timestamp. Used to maintain chronological ordering when
   * creating assistant messages after Discord send completes.
   */
  timestamp?: Date;
  /** Optional structured metadata (referenced messages, attachment descriptions) */
  messageMetadata?: MessageMetadata;
}

export class ConversationHistoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Add a message to conversation history
   */
  async addMessage(options: AddMessageOptions): Promise<void> {
    const {
      channelId,
      personalityId,
      personaId,
      role,
      content,
      guildId,
      discordMessageId,
      timestamp,
      messageMetadata,
    } = options;

    try {
      // Normalize discordMessageId to array format
      const messageIds =
        discordMessageId !== undefined
          ? Array.isArray(discordMessageId)
            ? discordMessageId
            : [discordMessageId]
          : [];

      // Compute token count once and cache it
      // This prevents recomputing on every AI request (web Claude optimization)
      const tokenCount = countTextTokens(content);

      await this.prisma.conversationHistory.create({
        data: {
          channelId,
          guildId: guildId ?? null,
          personalityId,
          personaId,
          role,
          content,
          tokenCount, // Cache token count for performance
          discordMessageId: messageIds,
          // Use provided timestamp if given, otherwise let PostgreSQL use default (now())
          ...(timestamp !== undefined && { createdAt: timestamp }),
          // Store structured metadata (referenced messages, attachments)
          ...(messageMetadata !== undefined && { messageMetadata }),
        },
      });

      logger.debug(
        `Added ${role} message to history (channel: ${channelId}, guild: ${guildId ?? 'DM'}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}..., discord: ${messageIds.length > 0 ? `${messageIds.length} ID(s)` : 'none'}, timestamp: ${timestamp !== undefined ? 'explicit' : 'default'}, tokens: ${tokenCount}, hasMetadata: ${messageMetadata !== undefined})`
      );
    } catch (error) {
      logger.error({ err: error }, `Failed to add message to conversation history`);
      throw error;
    }
  }

  /**
   * Update the most recent message for a persona in a channel
   * Used to enrich user messages with attachment descriptions after AI processing
   *
   * @param newContent Updated plain text content (user message + attachment descriptions)
   * @param newMetadata Optional updated metadata (with processed attachment descriptions)
   */
  async updateLastUserMessage(
    channelId: string,
    personalityId: string,
    personaId: string,
    newContent: string,
    newMetadata?: MessageMetadata
  ): Promise<boolean> {
    try {
      // Find the most recent user message for this persona
      const lastMessage = await this.prisma.conversationHistory.findFirst({
        where: {
          channelId,
          personalityId,
          personaId,
          role: MessageRole.User,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!lastMessage) {
        logger.warn(
          {},
          `No user message found to update (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`
        );
        return false;
      }

      // Recompute token count for enriched content
      const tokenCount = countTextTokens(newContent);

      // Update the content, token count, and optionally metadata
      await this.prisma.conversationHistory.update({
        where: {
          id: lastMessage.id,
        },
        data: {
          content: newContent,
          tokenCount, // Update token count to match enriched content
          // Update metadata if provided (merges with existing)
          ...(newMetadata !== undefined && { messageMetadata: newMetadata }),
        },
      });

      logger.debug(
        `Updated user message ${lastMessage.id} with enriched content (tokens: ${tokenCount}, hasMetadata: ${newMetadata !== undefined})`
      );
      return true;
    } catch (error) {
      logger.error({ err: error }, `Failed to update user message`);
      return false;
    }
  }

  /**
   * Get recent conversation history for a channel + personality
   * Returns messages in chronological order (oldest first)
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param limit Number of messages to fetch (default: 20)
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded (STM reset)
   */
  async getRecentHistory(
    channelId: string,
    personalityId: string,
    limit = 20,
    contextEpoch?: Date
  ): Promise<ConversationMessage[]> {
    try {
      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          personalityId,
          // Filter by context epoch if provided (STM reset feature)
          ...(contextEpoch !== undefined && {
            createdAt: {
              gt: contextEpoch,
            },
          }),
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        select: conversationHistorySelect,
      });

      // Reverse to get chronological order (oldest first) and map to domain objects
      const history = mapToConversationMessages(messages.reverse());

      logger.debug(
        `Retrieved ${history.length} messages from history (channel: ${channelId}, personality: ${personalityId})`
      );
      return history;
    } catch (error) {
      logger.error({ err: error }, `Failed to get conversation history`);
      return [];
    }
  }

  /**
   * Get paginated conversation history with cursor support
   * Returns messages in chronological order (oldest first)
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param limit Number of messages to fetch (default: 20, max: 100)
   * @param cursor Optional cursor (message ID) to fetch messages before
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded (STM reset)
   * @returns Paginated messages and cursor for next page
   */
  async getHistory(
    channelId: string,
    personalityId: string,
    limit = 20,
    cursor?: string,
    contextEpoch?: Date
  ): Promise<{
    messages: ConversationMessage[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    try {
      // Enforce max limit to prevent excessive queries
      const safeLimit = Math.min(limit, 100);

      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          personalityId,
          // Filter by context epoch if provided (STM reset feature)
          ...(contextEpoch !== undefined && {
            createdAt: {
              gt: contextEpoch,
            },
          }),
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: safeLimit + 1, // Fetch one extra to check if there are more
        ...(cursor !== undefined && cursor.length > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: conversationHistorySelect,
      });

      // Check if there are more messages
      const hasMore = messages.length > safeLimit;
      const resultMessages = hasMore ? messages.slice(0, safeLimit) : messages;

      // Reverse to get chronological order (oldest first) and map to domain objects
      const history = mapToConversationMessages(resultMessages.reverse());

      // Next cursor is the ID of the last message (in desc order, before reversal)
      const nextCursor = hasMore ? resultMessages[resultMessages.length - 1].id : undefined;

      logger.debug(
        `Retrieved ${history.length} messages (hasMore: ${hasMore}, cursor: ${cursor ?? 'none'}) ` +
          `from history (channel: ${channelId}, personality: ${personalityId})`
      );

      return {
        messages: history,
        hasMore,
        nextCursor,
      };
    } catch (error) {
      logger.error({ err: error }, `Failed to get paginated conversation history`);
      return {
        messages: [],
        hasMore: false,
      };
    }
  }

  /**
   * Update the most recent assistant message with Discord message IDs (for chunked messages)
   * Used to enable deduplication of referenced messages
   */
  async updateLastAssistantMessageId(
    channelId: string,
    personalityId: string,
    personaId: string,
    discordMessageIds: string[]
  ): Promise<boolean> {
    try {
      // Find the most recent assistant message for this persona
      const lastMessage = await this.prisma.conversationHistory.findFirst({
        where: {
          channelId,
          personalityId,
          personaId,
          role: MessageRole.Assistant,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!lastMessage) {
        logger.warn(
          {},
          `No assistant message found to update (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`
        );
        return false;
      }

      // Update with Discord message IDs (array for chunked messages)
      await this.prisma.conversationHistory.update({
        where: {
          id: lastMessage.id,
        },
        data: {
          discordMessageId: discordMessageIds,
        },
      });

      logger.debug(
        `Updated assistant message ${lastMessage.id} with ${discordMessageIds.length} Discord chunk ID(s)`
      );
      return true;
    } catch (error) {
      logger.error({ err: error }, `Failed to update assistant message with Discord IDs`);
      return false;
    }
  }

  /**
   * Get a message by Discord message ID
   * Used for retrieving voice transcripts from referenced messages
   */
  async getMessageByDiscordId(discordMessageId: string): Promise<ConversationMessage | null> {
    try {
      const message = await this.prisma.conversationHistory.findFirst({
        where: {
          discordMessageId: {
            has: discordMessageId,
          },
        },
        select: conversationHistorySelect,
      });

      if (!message) {
        return null;
      }

      return mapToConversationMessage(message);
    } catch (error) {
      logger.error({ err: error, discordMessageId }, `Failed to get message by Discord message ID`);
      return null;
    }
  }

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
   * Get conversation history statistics for a channel + personality
   * Used for /history stats command
   *
   * @param channelId Channel ID
   * @param personalityId Personality ID
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded
   * @returns Statistics about the conversation history
   */
  async getHistoryStats(
    channelId: string,
    personalityId: string,
    contextEpoch?: Date
  ): Promise<{
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    oldestMessage?: Date;
    newestMessage?: Date;
  }> {
    try {
      const whereClause = {
        channelId,
        personalityId,
        ...(contextEpoch !== undefined && {
          createdAt: {
            gt: contextEpoch,
          },
        }),
      };

      // Get counts by role
      const [total, userCount, assistantCount, oldest, newest] = await Promise.all([
        this.prisma.conversationHistory.count({ where: whereClause }),
        this.prisma.conversationHistory.count({
          where: { ...whereClause, role: MessageRole.User },
        }),
        this.prisma.conversationHistory.count({
          where: { ...whereClause, role: MessageRole.Assistant },
        }),
        this.prisma.conversationHistory.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.conversationHistory.findFirst({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      return {
        totalMessages: total,
        userMessages: userCount,
        assistantMessages: assistantCount,
        oldestMessage: oldest?.createdAt,
        newestMessage: newest?.createdAt,
      };
    } catch (error) {
      logger.error({ err: error }, `Failed to get conversation history stats`);
      return {
        totalMessages: 0,
        userMessages: 0,
        assistantMessages: 0,
      };
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

      logger.info(`Cleaned up ${count} old messages with tombstones (older than ${daysToKeep} days)`);
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
}
