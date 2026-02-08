/**
 * ConversationHistoryService
 * Manages short-term conversation history in PostgreSQL (CRUD and query operations)
 *
 * Related services:
 * - ConversationRetentionService: Cleanup and retention policies
 * - ConversationSyncService: Opportunistic sync with Discord (edit/delete detection)
 * - ConversationMessageMapper: Data transformation
 */

import type { PrismaClient } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MessageRole } from '../constants/index.js';
import { countTextTokens } from '../utils/tokenCounter.js';
import type { MessageMetadata } from '../types/schemas/index.js';
import {
  conversationHistorySelect,
  mapToConversationMessage,
  mapToConversationMessages,
  type ConversationMessage,
} from './ConversationMessageMapper.js';
import { generateConversationHistoryUuid } from '../utils/deterministicUuid.js';

// Re-export ConversationMessage for consumers that import from this module
export type { ConversationMessage } from './ConversationMessageMapper.js';

const logger = createLogger('ConversationHistoryService');

/**
 * Options for adding a message to conversation history
 */
interface AddMessageOptions {
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

      // Generate deterministic UUID for conversation history
      // Use personaId as the user identifier since it's unique per user+personality
      const createdAt = timestamp ?? new Date();
      const id = generateConversationHistoryUuid(channelId, personalityId, personaId, createdAt);

      await this.prisma.conversationHistory.create({
        data: {
          id,
          channelId,
          guildId: guildId ?? null,
          personalityId,
          personaId,
          role,
          content,
          tokenCount, // Cache token count for performance
          discordMessageId: messageIds,
          createdAt,
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
   * Get recent conversation history for a channel across ALL personalities.
   * Returns messages in chronological order (oldest first).
   *
   * This method does NOT filter by personalityId — it returns all messages in the channel.
   * Use this when you need complete channel context (e.g., extended context scenarios).
   *
   * @param channelId Channel ID
   * @param limit Number of messages to fetch (default: 20)
   * @param contextEpoch Optional epoch timestamp - messages before this time are excluded
   */
  async getChannelHistory(
    channelId: string,
    limit = 20,
    contextEpoch?: Date
  ): Promise<ConversationMessage[]> {
    try {
      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          // NO personalityId filter - fetch ALL channel messages
          deletedAt: null,
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
        `Retrieved ${history.length} messages from channel history (channel: ${channelId}, all personalities)`
      );
      return history;
    } catch (error) {
      logger.error({ err: error }, `Failed to get channel conversation history`);
      return [];
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
}
