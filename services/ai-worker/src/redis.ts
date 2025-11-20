/**
 * Redis Client for AI Worker
 *
 * Handles Redis operations for transcript caching.
 */

import { createClient, type RedisClientType } from 'redis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createRedisSocketConfig,
  REDIS_KEY_PREFIXES,
} from '@tzurot/common-types';

const logger = createLogger('Redis');
const config = getConfig();

// Get Redis connection config from environment
if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
  throw new Error('REDIS_URL environment variable is required');
}

const parsedUrl = parseRedisUrl(config.REDIS_URL);

const redisConfig = createRedisSocketConfig({
  host: parsedUrl.host,
  port: parsedUrl.port,
  password: parsedUrl.password,
  username: parsedUrl.username,
  family: 6, // Railway private network uses IPv6
});

logger.info(
  {
    host: redisConfig.socket.host,
    port: redisConfig.socket.port,
    hasPassword: redisConfig.password !== undefined,
    connectTimeout: redisConfig.socket.connectTimeout,
    commandTimeout: redisConfig.socket.commandTimeout,
  },
  '[Redis] Redis config:'
);

// Create Redis client
export const redis: RedisClientType = createClient(redisConfig) as RedisClientType;

// Error handling
redis.on('error', error => {
  logger.error({ err: error }, '[Redis] Redis client error');
});

redis.on('connect', () => {
  logger.info('[Redis] Connected to Redis');
});

// Connect on startup
redis.connect().catch(error => {
  logger.error({ err: error }, '[Redis] Failed to connect to Redis');
});

/**
 * Get cached voice transcript
 * @param attachmentUrl Discord CDN attachment URL (originalUrl)
 * @returns Transcript text or null if not found
 */
export async function getVoiceTranscript(attachmentUrl: string): Promise<string | null> {
  try {
    const transcript = await redis.get(`${REDIS_KEY_PREFIXES.VOICE_TRANSCRIPT}${attachmentUrl}`);
    if (transcript !== null && transcript.length > 0) {
      logger.debug(`[Redis] Cache HIT for voice transcript: ${attachmentUrl.substring(0, 50)}...`);
    } else {
      logger.debug(`[Redis] Cache MISS for voice transcript: ${attachmentUrl.substring(0, 50)}...`);
    }
    return transcript;
  } catch (error) {
    logger.error({ err: error }, '[Redis] Failed to get voice transcript from cache');
    return null;
  }
}

/**
 * Publish job result to Redis Stream for async delivery
 * @param jobId BullMQ job ID
 * @param requestId Request ID for tracking
 * @param result Job result payload
 */
export async function publishJobResult(
  jobId: string,
  requestId: string,
  result: unknown
): Promise<void> {
  try {
    const messageId = await redis.xAdd('job-results', '*', {
      jobId,
      requestId,
      result: JSON.stringify(result),
      completedAt: new Date().toISOString(),
    });

    logger.info(
      { jobId, requestId, messageId },
      `[Redis] Published job result to stream (message: ${messageId})`
    );

    // Trim stream to prevent unbounded growth (~10k messages, approximately 1 week of results)
    // Using approximate trimming (~) for better performance
    await redis.xTrim('job-results', 'MAXLEN', 10000, {
      strategyModifier: '~', // Approximate trimming
      LIMIT: 100, // Max entries to trim per call
    });
  } catch (error) {
    logger.error(
      { err: error, jobId, requestId },
      '[Redis] Failed to publish job result to stream'
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
export async function storeJobResult(jobId: string, result: unknown): Promise<void> {
  try {
    const key = `${REDIS_KEY_PREFIXES.JOB_RESULT}${jobId}`;
    const value = JSON.stringify(result);
    const ttlSeconds = 3600; // 1 hour

    await redis.setEx(key, ttlSeconds, value);

    logger.debug({ jobId, key }, '[Redis] Stored job result (TTL: 1 hour)');
  } catch (error) {
    logger.error({ err: error, jobId }, '[Redis] Failed to store job result');
    throw error;
  }
}

/**
 * Fetch job result from Redis (for dependent jobs)
 * @param jobId Job ID to fetch result for
 * @returns Parsed job result or null if not found
 */
export async function getJobResult<T = unknown>(jobId: string): Promise<T | null> {
  try {
    const key = `${REDIS_KEY_PREFIXES.JOB_RESULT}${jobId}`;
    const value = await redis.get(key);

    if (value === null || value.length === 0) {
      logger.debug({ jobId, key }, '[Redis] Job result not found');
      return null;
    }

    const result = JSON.parse(value) as T;
    logger.debug({ jobId, key }, '[Redis] Retrieved job result');
    return result;
  } catch (error) {
    logger.error({ err: error, jobId }, '[Redis] Failed to get job result');
    return null;
  }
}

/**
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  logger.info('[Redis] Closing Redis connection...');
  await redis.close();
  logger.info('[Redis] Redis connection closed');
}
