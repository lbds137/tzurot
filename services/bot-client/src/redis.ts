/**
 * Redis Client for Bot
 *
 * Handles persistent storage for webhook message tracking.
 * Allows reply routing to survive bot restarts.
 */

import { createClient, type RedisClientType } from 'redis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createRedisSocketConfig,
} from '@tzurot/common-types';

const logger = createLogger('Redis');
const config = getConfig();

// Get Redis connection config from environment
// Prefer REDIS_URL (Railway provides this), fall back to individual variables
const parsedUrl =
  config.REDIS_URL !== undefined &&
  config.REDIS_URL !== null &&
  config.REDIS_URL.length > 0
    ? parseRedisUrl(config.REDIS_URL)
    : null;

const redisConfig = createRedisSocketConfig({
  host: parsedUrl?.host ?? config.REDIS_HOST,
  port: parsedUrl?.port ?? config.REDIS_PORT,
  password: parsedUrl?.password ?? config.REDIS_PASSWORD,
  username: parsedUrl?.username,
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

// Create Redis client with explicit type
export const redis: RedisClientType = createClient(redisConfig) as RedisClientType;

// Error handling
redis.on('error', error => {
  logger.error({ err: error }, '[Redis] Redis client error');
});

redis.on('connect', () => {
  logger.info('[Redis] Connected to Redis');
});

redis.on('ready', () => {
  logger.info('[Redis] Redis client ready');
});

redis.on('reconnecting', () => {
  logger.info('[Redis] Reconnecting to Redis');
});

// Connect on startup
redis.connect().catch(error => {
  logger.error({ err: error }, '[Redis] Failed to connect to Redis');
});

/**
 * Store webhook message -> personality mapping
 * @param messageId Discord message ID
 * @param personalityName Personality name
 * @param ttlSeconds Time to live in seconds (default: 7 days)
 */
export async function storeWebhookMessage(
  messageId: string,
  personalityName: string,
  ttlSeconds: number = 7 * 24 * 60 * 60 // 7 days
): Promise<void> {
  try {
    await redis.setEx(`webhook:${messageId}`, ttlSeconds, personalityName);
    logger.debug(`[Redis] Stored webhook message: ${messageId} -> ${personalityName}`);
  } catch (error) {
    logger.error({ err: error }, `[Redis] Failed to store webhook message: ${messageId}`);
  }
}

/**
 * Get personality name from webhook message ID
 * @param messageId Discord message ID
 * @returns Personality name or null if not found
 */
export async function getWebhookPersonality(messageId: string): Promise<string | null> {
  try {
    const personalityName = await redis.get(`webhook:${messageId}`);
    if (
      personalityName !== undefined &&
      personalityName !== null &&
      personalityName.length > 0
    ) {
      logger.debug(`[Redis] Retrieved webhook message: ${messageId} -> ${personalityName}`);
    }
    return personalityName;
  } catch (error) {
    logger.error({ err: error }, `[Redis] Failed to get webhook message: ${messageId}`);
    return null;
  }
}

/**
 * Store voice transcript cache
 * @param attachmentUrl Discord CDN attachment URL
 * @param transcript Transcribed text
 * @param ttlSeconds Time to live in seconds (default: 5 minutes)
 */
export async function storeVoiceTranscript(
  attachmentUrl: string,
  transcript: string,
  ttlSeconds: number = 5 * 60 // 5 minutes
): Promise<void> {
  try {
    await redis.setEx(`transcript:${attachmentUrl}`, ttlSeconds, transcript);
    logger.debug(`[Redis] Stored voice transcript cache for: ${attachmentUrl.substring(0, 50)}...`);
  } catch (error) {
    logger.error({ err: error }, '[Redis] Failed to store voice transcript');
  }
}

/**
 * Get cached voice transcript
 * @param attachmentUrl Discord CDN attachment URL
 * @returns Transcript text or null if not found
 */
export async function getVoiceTranscript(attachmentUrl: string): Promise<string | null> {
  try {
    const transcript = await redis.get(`transcript:${attachmentUrl}`);
    if (
      transcript !== undefined &&
      transcript !== null &&
      transcript.length > 0
    ) {
      logger.debug(
        `[Redis] Retrieved cached voice transcript for: ${attachmentUrl.substring(0, 50)}...`
      );
    }
    return transcript;
  } catch (error) {
    logger.error({ err: error }, '[Redis] Failed to get voice transcript');
    return null;
  }
}

/**
 * Health check
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    logger.error({ err: error }, '[Redis] Health check failed');
    return false;
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
