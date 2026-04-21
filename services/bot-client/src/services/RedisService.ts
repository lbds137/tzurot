/**
 * RedisService
 * Handles Redis operations for webhook message tracking
 *
 * Uses ioredis (unified Redis client for all services - BullMQ requires it anyway)
 */

import type { Redis } from 'ioredis';
import { createLogger, REDIS_KEY_PREFIXES, INTERVALS } from '@tzurot/common-types';

const logger = createLogger('RedisService');

export class RedisService {
  constructor(private redis: Redis) {}

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
      // ioredis uses lowercase method names: setex instead of setEx
      await this.redis.setex(
        `${REDIS_KEY_PREFIXES.WEBHOOK_MESSAGE}${messageId}`,
        ttlSeconds,
        personalityName
      );
      logger.debug(`Stored webhook message: ${messageId} -> ${personalityName}`);
    } catch (error) {
      logger.error({ err: error }, `Failed to store webhook message: ${messageId}`);
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
        logger.debug(`Retrieved webhook message: ${messageId} -> ${personalityName}`);
      }
      return personalityName;
    } catch (error) {
      logger.error({ err: error }, `Failed to get webhook message: ${messageId}`);
      return null;
    }
  }

  /**
   * Fetch TTS audio buffer from Redis.
   * Audio is stored by ai-worker with a 5-minute TTL.
   * @param key Full Redis key (tts-audio:{jobId})
   * @returns Audio buffer or null if expired/not found
   */
  async getTTSAudio(key: string): Promise<Buffer | null> {
    try {
      // getBuffer returns raw binary data (not UTF-8 decoded string)
      const value = await this.redis.getBuffer(key);
      if (value === null) {
        logger.debug({ key }, 'TTS audio not found or expired');
        return null;
      }
      logger.debug({ key, audioSize: value.length }, 'Retrieved TTS audio');
      return value;
    } catch (error) {
      logger.error({ err: error, key }, 'Failed to get TTS audio');
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
      logger.error({ err: error }, 'Health check failed');
      return false;
    }
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    logger.info('Closing Redis connection...');
    await this.redis.quit();
    logger.info('Redis connection closed');
  }
}
