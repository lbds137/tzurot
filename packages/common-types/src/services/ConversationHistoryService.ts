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
    userId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): Promise<void> {
    try {
      await this.prisma.conversationHistory.create({
        data: {
          channelId,
          personalityId,
          userId,
          role,
          content,
        },
      });

      logger.debug(`Added ${role} message to history (channel: ${channelId}, personality: ${personalityId})`);

    } catch (error) {
      logger.error({ err: error }, `Failed to add message to conversation history`);
      throw error;
    }
  }

  /**
   * Update the most recent message for a user in a channel
   * Used to enrich user messages with attachment descriptions after AI processing
   */
  async updateLastUserMessage(
    channelId: string,
    personalityId: string,
    userId: string,
    newContent: string
  ): Promise<boolean> {
    try {
      // Find the most recent user message
      const lastMessage = await this.prisma.conversationHistory.findFirst({
        where: {
          channelId,
          personalityId,
          userId,
          role: 'user',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!lastMessage) {
        logger.warn(`No user message found to update (channel: ${channelId}, personality: ${personalityId})`);
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
        },
      });

      // Reverse to get chronological order (oldest first)
      const history = messages.reverse().map((msg: { id: string; role: string; content: string; createdAt: Date }) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        createdAt: msg.createdAt,
      }));

      logger.debug(`Retrieved ${history.length} messages from history (channel: ${channelId}, personality: ${personalityId})`);
      return history;

    } catch (error) {
      logger.error({ err: error }, `Failed to get conversation history`);
      return [];
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
