/**
 * RedisService
 * Handles Redis operations for webhook message tracking
 */

import type { RedisClientType } from 'redis';
import { createLogger, REDIS_KEY_PREFIXES, INTERVALS } from '@tzurot/common-types';

const logger = createLogger('RedisService');

export class RedisService {
  constructor(private redis: RedisClientType) {}

  /**
   * Store webhook message -> personality mapping
   * @param messageId Discord message ID
   * @param personalityName Personality name
   * @param ttlSeconds Time to live in seconds (default: 7 days)
   */
  async storeWebhookMessage(
    messageId: string,
    personalityName: string,
    ttlSeconds: number = INTERVALS.WEBHOOK_MESSAGE_TTL
  ): Promise<void> {
    try {
      await this.redis.setEx(
        `${REDIS_KEY_PREFIXES.WEBHOOK_MESSAGE}${messageId}`,
        ttlSeconds,
        personalityName
      );
      logger.debug(`[RedisService] Stored webhook message: ${messageId} -> ${personalityName}`);
    } catch (error) {
      logger.error({ err: error }, `[RedisService] Failed to store webhook message: ${messageId}`);
    }
  }

  /**
   * Get personality name from webhook message ID
   * @param messageId Discord message ID
   * @returns Personality name or null if not found
   */
  async getWebhookPersonality(messageId: string): Promise<string | null> {
    try {
      const personalityName = await this.redis.get(
        `${REDIS_KEY_PREFIXES.WEBHOOK_MESSAGE}${messageId}`
      );
      if (personalityName !== undefined && personalityName !== null && personalityName.length > 0) {
        logger.debug(
          `[RedisService] Retrieved webhook message: ${messageId} -> ${personalityName}`
        );
      }
      return personalityName;
    } catch (error) {
      logger.error({ err: error }, `[RedisService] Failed to get webhook message: ${messageId}`);
      return null;
    }
  }

  /**
   * Health check
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      logger.error({ err: error }, '[RedisService] Health check failed');
      return false;
    }
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    logger.info('[RedisService] Closing Redis connection...');
    await this.redis.quit();
    logger.info('[RedisService] Redis connection closed');
  }
}
