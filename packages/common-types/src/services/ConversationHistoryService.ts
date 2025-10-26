/**
 * ConversationHistoryService
 * Manages short-term conversation history in PostgreSQL
 */

import { getPrismaClient } from './prisma.js';
import { createLogger } from '../logger.js';

const logger = createLogger('ConversationHistoryService');

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  personaId: string;
  personaName?: string; // The persona's name for display in context
}

export class ConversationHistoryService {
  private prisma;

  constructor() {
    this.prisma = getPrismaClient();
  }

  /**
   * Add a message to conversation history
   */
  async addMessage(
    channelId: string,
    personalityId: string,
    personaId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    try {
      await this.prisma.conversationHistory.create({
        data: {
          channelId,
          personalityId,
          personaId,
          role,
          content,
        },
      });

      logger.debug(`Added ${role} message to history (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`);

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
          role: 'user',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!lastMessage) {
        logger.warn(`No user message found to update (channel: ${channelId}, personality: ${personalityId}, persona: ${personaId.substring(0, 8)}...)`);
        return false;
      }

      // Update the content
      await this.prisma.conversationHistory.update({
        where: {
          id: lastMessage.id,
        },
        data: {
          content: newContent,
        },
      });

      logger.debug(`Updated user message ${lastMessage.id} with enriched content`);
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
    limit: number = 20
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
          createdAt: true,
          personaId: true,
          persona: {
            select: {
              name: true,
              preferredName: true,
            },
          },
        },
      });

      // Reverse to get chronological order (oldest first)
      const history = messages.reverse().map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        createdAt: msg.createdAt,
        personaId: msg.personaId,
        personaName: msg.persona.preferredName || msg.persona.name,
      }));

      logger.debug(`Retrieved ${history.length} messages from history (channel: ${channelId}, personality: ${personalityId})`);
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
    limit: number = 20,
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
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          personaId: true,
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
      const history = resultMessages.reverse().map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        createdAt: msg.createdAt,
        personaId: msg.personaId,
        personaName: msg.persona.preferredName || msg.persona.name,
      }));

      // Next cursor is the ID of the last message (in desc order, before reversal)
      const nextCursor = hasMore ? resultMessages[resultMessages.length - 1].id : undefined;

      logger.debug(
        `Retrieved ${history.length} messages (hasMore: ${hasMore}, cursor: ${cursor || 'none'}) ` +
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

      logger.info(`Cleared ${result.count} messages from history (channel: ${channelId}, personality: ${personalityId})`);
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
  async cleanupOldHistory(daysToKeep: number = 30): Promise<number> {
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
      logger.error({ err: error}, `Failed to cleanup old conversation history`);
      throw error;
    }
  }
}
