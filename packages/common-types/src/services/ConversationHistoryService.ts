/**
 * ConversationHistoryService
 * Manages short-term conversation history in PostgreSQL (CRUD and query operations)
 *
 * Cleanup and retention operations are handled by ConversationRetentionService.
 * Data transformation is handled by ConversationMessageMapper.
 */

import type { PrismaClient } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MessageRole } from '../constants/index.js';
import { countTextTokens } from '../utils/tokenCounter.js';
import type { MessageMetadata } from '../types/schemas.js';
import {
  conversationHistorySelect,
  mapToConversationMessage,
  mapToConversationMessages,
} from './ConversationMessageMapper.js';

const logger = createLogger('ConversationHistoryService');

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
          // Exclude soft-deleted messages
          deletedAt: null,
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
          // Exclude soft-deleted messages
          deletedAt: null,
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

  // ============================================================================
  // Soft Delete / Edit Sync Methods (for opportunistic DB sync)
  // ============================================================================

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

      for (const msg of messages) {
        for (const discordId of msg.discordMessageId) {
          if (discordMessageIds.includes(discordId)) {
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
   * @param limit Maximum number of messages to return (default 200, bounded for safety)
   * @returns Array of messages with their Discord IDs
   */
  async getMessagesInTimeWindow(
    channelId: string,
    personalityId: string,
    since: Date,
    limit = 200
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
