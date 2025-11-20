/**
 * RedisService
 * Handles Redis operations for transcript caching and job results
 */

import type { RedisClientType } from 'redis';
import { createLogger, REDIS_KEY_PREFIXES } from '@tzurot/common-types';

const logger = createLogger('RedisService');

export class RedisService {
  constructor(private redis: RedisClientType) {}

  /**
   * Publish job result to Redis Stream for async delivery
   * @param jobId BullMQ job ID
   * @param requestId Request ID for tracking
   * @param result Job result payload
   */
  async publishJobResult(jobId: string, requestId: string, result: unknown): Promise<void> {
    try {
      const messageId = await this.redis.xAdd('job-results', '*', {
        jobId,
        requestId,
        result: JSON.stringify(result),
        completedAt: new Date().toISOString(),
      });

      logger.info(
        { jobId, requestId, messageId },
        `[RedisService] Published job result to stream (message: ${messageId})`
      );

      // Trim stream to prevent unbounded growth (~10k messages, approximately 1 week of results)
      // Using approximate trimming (~) for better performance
      await this.redis.xTrim('job-results', 'MAXLEN', 10000, {
        strategyModifier: '~', // Approximate trimming
        LIMIT: 100, // Max entries to trim per call
      });
    } catch (error) {
      logger.error(
        { err: error, jobId, requestId },
        '[RedisService] Failed to publish job result to stream'
      );
      throw error; // Re-throw so caller knows about failure
    }
  }

  /**
   * Store job result in Redis for dependent jobs to fetch
   * Results are stored with a TTL of 1 hour
   * @param jobId Job ID to store result for
   * @param result Job result payload
   */
  async storeJobResult(jobId: string, result: unknown): Promise<void> {
    try {
      const key = `${REDIS_KEY_PREFIXES.JOB_RESULT}${jobId}`;
      const value = JSON.stringify(result);
      const ttlSeconds = 3600; // 1 hour

      await this.redis.setEx(key, ttlSeconds, value);

      logger.debug({ jobId, key }, '[RedisService] Stored job result (TTL: 1 hour)');
    } catch (error) {
      logger.error({ err: error, jobId }, '[RedisService] Failed to store job result');
      throw error;
    }
  }

  /**
   * Fetch job result from Redis (for dependent jobs)
   * @param jobId Job ID to fetch result for
   * @returns Parsed job result or null if not found
   */
  async getJobResult<T = unknown>(jobId: string): Promise<T | null> {
    try {
      const key = `${REDIS_KEY_PREFIXES.JOB_RESULT}${jobId}`;
      const value = await this.redis.get(key);

      if (value === null || value.length === 0) {
        logger.debug({ jobId, key }, '[RedisService] Job result not found');
        return null;
      }

      const result = JSON.parse(value) as T;
      logger.debug({ jobId, key }, '[RedisService] Retrieved job result');
      return result;
    } catch (error) {
      logger.error({ err: error, jobId }, '[RedisService] Failed to get job result');
      return null;
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
