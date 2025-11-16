/**
 * ConversationHistoryService
 * Manages short-term conversation history in PostgreSQL
 */

import { getPrismaClient } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { MessageRole } from '../constants/index.js';
import { countTextTokens } from '../utils/tokenCounter.js';

const logger = createLogger('ConversationHistoryService');

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  tokenCount?: number; // Cached token count (computed once, reused on every request)
  createdAt: Date;
  personaId: string;
  personaName?: string; // The persona's name for display in context
  discordMessageId: string[]; // Discord snowflake IDs for chunked messages (deduplication)
}

export class ConversationHistoryService {
  private prisma;

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Add a message to conversation history
   *
   * @param discordMessageId Discord message ID(s). Can be:
   *                         - string: single message ID (user messages, single-chunk assistant messages)
   *                         - string[]: multiple message IDs (chunked assistant messages)
   *                         - undefined: no Discord message ID yet
   * @param timestamp Optional timestamp for the message. If provided, overrides the default
   *                  PostgreSQL timestamp. This is used to maintain chronological ordering when
   *                  creating assistant messages after Discord send completes, ensuring the
   *                  assistant timestamp is slightly after the user message timestamp.
   */
  async addMessage(
    channelId: string,
    personalityId: string,
    personaId: string,
    role: MessageRole,
    content: string,
    guildId?: string | null,
    discordMessageId?: string | string[],
    timestamp?: Date
  ): Promise<void> {
    try {
      // Normalize discordMessageId to array format
      const messageIds = discordMessageId !== undefined
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
        },
      });

      logger.debug(
        `Added ${role} message to history (channel: ${channelId}, guild: ${guildId ?? 'DM'}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}..., discord: ${messageIds.length > 0 ? `${messageIds.length} ID(s)` : 'none'}, timestamp: ${timestamp !== undefined ? 'explicit' : 'default'}, tokens: ${tokenCount})`
      );
    } catch (error) {
      logger.error({ err: error }, `Failed to add message to conversation history`);
      throw error;
    }
  }

  /**
   * Update the most recent message for a persona in a channel
   * Used to enrich user messages with attachment descriptions after AI processing
   */
  async updateLastUserMessage(
    channelId: string,
    personalityId: string,
    personaId: string,
    newContent: string
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

      // Update the content and token count
      await this.prisma.conversationHistory.update({
        where: {
          id: lastMessage.id,
        },
        data: {
          content: newContent,
          tokenCount, // Update token count to match enriched content
        },
      });

      logger.debug(
        `Updated user message ${lastMessage.id} with enriched content (tokens: ${tokenCount})`
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
   */
  async getRecentHistory(
    channelId: string,
    personalityId: string,
    limit = 20
  ): Promise<ConversationMessage[]> {
    try {
      const messages = await this.prisma.conversationHistory.findMany({
        where: {
          channelId,
          personalityId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        select: {
          id: true,
          role: true,
          content: true,
          tokenCount: true, // Include cached token count
          createdAt: true,
          personaId: true,
          discordMessageId: true,
          persona: {
            select: {
              name: true,
              preferredName: true,
            },
          },
        },
      });

      // Reverse to get chronological order (oldest first)
      type MessageWithPersona = (typeof messages)[number];
      const history = messages.reverse().map(
        (msg: MessageWithPersona): ConversationMessage => ({
          id: msg.id,
          role: msg.role as MessageRole,
          content: msg.content,
          tokenCount: msg.tokenCount ?? undefined, // Use cached token count
          createdAt: msg.createdAt,
          personaId: msg.personaId,
          personaName: msg.persona.preferredName ?? msg.persona.name,
          discordMessageId: msg.discordMessageId,
        })
      );

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
   * @returns Paginated messages and cursor for next page
   */
  async getHistory(
    channelId: string,
    personalityId: string,
    limit = 20,
    cursor?: string
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
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: safeLimit + 1, // Fetch one extra to check if there are more
        ...(cursor !== undefined && cursor.length > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          role: true,
          content: true,
          tokenCount: true, // Include cached token count
          createdAt: true,
          personaId: true,
          discordMessageId: true,
          persona: {
            select: {
              name: true,
              preferredName: true,
            },
          },
        },
      });

      // Check if there are more messages
      const hasMore = messages.length > safeLimit;
      const resultMessages = hasMore ? messages.slice(0, safeLimit) : messages;

      // Reverse to get chronological order (oldest first)
      type MessageWithPersona = (typeof messages)[number];
      const history = resultMessages.reverse().map(
        (msg: MessageWithPersona): ConversationMessage => ({
          id: msg.id,
          role: msg.role as MessageRole,
          content: msg.content,
          tokenCount: msg.tokenCount ?? undefined, // Use cached token count
          createdAt: msg.createdAt,
          personaId: msg.personaId,
          personaName: msg.persona.preferredName ?? msg.persona.name,
          discordMessageId: msg.discordMessageId,
        })
      );

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
        select: {
          id: true,
          role: true,
          content: true,
          tokenCount: true,
          createdAt: true,
          personaId: true,
          discordMessageId: true,
          persona: {
            select: {
              name: true,
              preferredName: true,
            },
          },
        },
      });

      if (!message) {
        return null;
      }

      return {
        id: message.id,
        role: message.role as MessageRole,
        content: message.content,
        tokenCount: message.tokenCount ?? undefined,
        createdAt: message.createdAt,
        personaId: message.personaId,
        personaName: message.persona.preferredName ?? message.persona.name,
        discordMessageId: message.discordMessageId,
      };
    } catch (error) {
      logger.error(
        { err: error, discordMessageId },
        `Failed to get message by Discord message ID`
      );
      return null;
    }
  }

  /**
   * Clear conversation history for a channel + personality
   * (useful for /reset command)
   */
  async clearHistory(channelId: string, personalityId: string): Promise<number> {
    try {
      const result = await this.prisma.conversationHistory.deleteMany({
        where: {
          channelId,
          personalityId,
        },
      });

      logger.info(
        `Cleared ${result.count} messages from history (channel: ${channelId}, personality: ${personalityId})`
      );
      return result.count;
    } catch (error) {
      logger.error({ err: error }, `Failed to clear conversation history`);
      throw error;
    }
  }

  /**
   * Clean up old history (older than X days)
   * Call this periodically to prevent unbounded growth
   */
  async cleanupOldHistory(daysToKeep = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await this.prisma.conversationHistory.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
      });

      logger.info(`Cleaned up ${result.count} old messages (older than ${daysToKeep} days)`);
      return result.count;
    } catch (error) {
      logger.error({ err: error }, `Failed to cleanup old conversation history`);
      throw error;
    }
  }
}
