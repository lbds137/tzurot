/**
 * RedisService
 * Handles Redis operations for transcript caching and job results
 *
 * Uses ioredis (unified Redis client for all services - BullMQ requires it anyway)
 */

import type { Redis } from 'ioredis';
import { createLogger, REDIS_KEY_PREFIXES, IncognitoSessionSchema } from '@tzurot/common-types';

const logger = createLogger('RedisService');

/**
 * Build Redis key for incognito session
 * @param personalityId - Personality UUID or 'all' for global incognito
 */
function buildIncognitoKey(userId: string, personalityId: string): string {
  return `${REDIS_KEY_PREFIXES.INCOGNITO}${userId}:${personalityId}`;
}

export class RedisService {
  constructor(private redis: Redis) {}

  /**
   * Publish job result to Redis Stream for async delivery
   * @param jobId BullMQ job ID
   * @param requestId Request ID for tracking
   * @param result Job result payload
   */
  async publishJobResult(jobId: string, requestId: string, result: unknown): Promise<void> {
    try {
      // ioredis xadd uses varargs: xadd(key, id, ...fieldValuePairs)
      const messageId = await this.redis.xadd(
        'job-results',
        '*',
        'jobId',
        jobId,
        'requestId',
        requestId,
        'result',
        JSON.stringify(result),
        'completedAt',
        new Date().toISOString()
      );

      logger.info(
        { jobId, requestId, messageId },
        `[RedisService] Published job result to stream (message: ${messageId})`
      );

      // Trim stream to prevent unbounded growth (~10k messages, approximately 1 week of results)
      // Using approximate trimming (~) for better performance
      // ioredis xtrim signature: xtrim(key, strategy, modifier, count)
      await this.redis.xtrim('job-results', 'MAXLEN', '~', 10000);
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

      // ioredis uses lowercase method names: setex instead of setEx
      await this.redis.setex(key, ttlSeconds, value);

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
   * Check if incognito mode is active for a user and personality
   * Checks both the specific personality and 'all' (global incognito)
   *
   * @param userId Discord user ID
   * @param personalityId Personality ID
   * @returns true if incognito is active
   */
  async isIncognitoActive(userId: string, personalityId: string): Promise<boolean> {
    try {
      // Check both specific personality and global 'all' in parallel
      const [specificKey, globalKey] = [
        buildIncognitoKey(userId, personalityId),
        buildIncognitoKey(userId, 'all'),
      ];

      const [specificSession, globalSession] = await Promise.all([
        this.redis.get(specificKey),
        this.redis.get(globalKey),
      ]);

      // Validate session data if found
      let isActive = false;

      if (specificSession !== null) {
        try {
          IncognitoSessionSchema.parse(JSON.parse(specificSession));
          isActive = true;
        } catch {
          // Invalid session data - clean up
          await this.redis.del(specificKey);
          logger.warn({ key: specificKey }, '[RedisService] Cleaned up invalid incognito session');
        }
      }

      if (!isActive && globalSession !== null) {
        try {
          IncognitoSessionSchema.parse(JSON.parse(globalSession));
          isActive = true;
        } catch {
          // Invalid session data - clean up
          await this.redis.del(globalKey);
          logger.warn({ key: globalKey }, '[RedisService] Cleaned up invalid incognito session');
        }
      }

      if (isActive) {
        logger.debug(
          { userId, personalityId },
          '[RedisService] Incognito mode active - memory storage will be skipped'
        );
      }

      return isActive;
    } catch (error) {
      logger.error(
        { err: error, userId, personalityId },
        '[RedisService] Error checking incognito status - defaulting to active storage'
      );
      // On error, default to normal behavior (don't block memory storage)
      return false;
    }
  }

  /**
   * Acquire idempotency lock for a Discord message.
   * Uses SET NX EX to atomically set a key only if it doesn't exist.
   *
   * IMPORTANT: If processing fails after acquiring the lock, call releaseMessageLock()
   * to allow BullMQ retries. Otherwise the retry will be blocked as a "duplicate".
   *
   * @param messageId Discord message ID that triggered the request
   * @returns true if lock acquired (should process), false if already locked/processed
   */
  async markMessageProcessing(messageId: string): Promise<boolean> {
    try {
      const key = `${REDIS_KEY_PREFIXES.PROCESSED_MESSAGE}${messageId}`;
      // SET key value NX EX ttl - sets only if key doesn't exist, with 1 hour TTL
      const result = await this.redis.set(key, '1', 'EX', 3600, 'NX');

      // Result is 'OK' if key was set (new message), null if key already exists (duplicate)
      const isNew = result === 'OK';

      if (!isNew) {
        logger.info(
          { messageId },
          '[RedisService] Duplicate message detected - skipping processing'
        );
      }

      return isNew;
    } catch (error) {
      logger.error(
        { err: error, messageId },
        '[RedisService] Error acquiring idempotency lock - allowing processing'
      );
      // On error, default to allowing processing (fail open)
      return true;
    }
  }

  /**
   * Release idempotency lock for a Discord message.
   * Call this when job processing FAILS to allow BullMQ retries.
   * Do NOT call on success - the lock should remain to prevent reprocessing.
   *
   * @param messageId Discord message ID that triggered the request
   */
  async releaseMessageLock(messageId: string): Promise<void> {
    try {
      const key = `${REDIS_KEY_PREFIXES.PROCESSED_MESSAGE}${messageId}`;
      await this.redis.del(key);
      logger.debug({ messageId }, '[RedisService] Released idempotency lock for retry');
    } catch (error) {
      // Log but don't throw - lock release failure shouldn't block error propagation
      logger.error({ err: error, messageId }, '[RedisService] Failed to release idempotency lock');
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
