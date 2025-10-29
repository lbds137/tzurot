/**
 * Redis Client for AI Worker
 *
 * Handles Redis operations for transcript caching.
 */

import { createClient, type RedisClientType } from 'redis';
import { createLogger, getConfig, parseRedisUrl } from '@tzurot/common-types';

const logger = createLogger('Redis');
const config = getConfig();

// Get Redis connection config from environment
const parsedUrl = config.REDIS_URL && config.REDIS_URL.length > 0
  ? parseRedisUrl(config.REDIS_URL)
  : null;

const redisConfig = {
  socket: {
    host: parsedUrl?.host || config.REDIS_HOST,
    port: parsedUrl?.port || config.REDIS_PORT,
    family: 6 // Railway private networking requires IPv6
  },
  password: parsedUrl?.password || config.REDIS_PASSWORD,
};

logger.info({
  host: redisConfig.socket.host,
  port: redisConfig.socket.port,
  hasPassword: redisConfig.password !== undefined
}, '[Redis] Redis config:');

// Create Redis client
export const redis: RedisClientType = createClient(redisConfig) as RedisClientType;

// Error handling
redis.on('error', (error) => {
  logger.error({ err: error }, '[Redis] Redis client error');
});

redis.on('connect', () => {
  logger.info('[Redis] Connected to Redis');
});

// Connect on startup
redis.connect().catch((error) => {
  logger.error({ err: error }, '[Redis] Failed to connect to Redis');
});

/**
 * Get cached voice transcript
 * @param attachmentUrl Discord CDN attachment URL (originalUrl)
 * @returns Transcript text or null if not found
 */
export async function getVoiceTranscript(attachmentUrl: string): Promise<string | null> {
  try {
    const transcript = await redis.get(`transcript:${attachmentUrl}`);
    if (transcript) {
      logger.info(`[Redis] Cache HIT for voice transcript: ${attachmentUrl.substring(0, 50)}...`);
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
 * Graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  logger.info('[Redis] Closing Redis connection...');
  await redis.close();
  logger.info('[Redis] Redis connection closed');
}
