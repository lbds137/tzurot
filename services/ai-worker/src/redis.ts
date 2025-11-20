/**
 * Redis Client for AI Worker
 *
 * Exports singleton RedisService instance for transcript caching and job results.
 */

import { createClient, type RedisClientType } from 'redis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createRedisSocketConfig,
  VoiceTranscriptCache,
} from '@tzurot/common-types';
import { RedisService } from './services/RedisService.js';

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
const redis: RedisClientType = createClient(redisConfig) as RedisClientType;

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

// Export singleton RedisService instance
export const redisService = new RedisService(redis);

// Export singleton VoiceTranscriptCache instance
export const voiceTranscriptCache = new VoiceTranscriptCache(redis);
