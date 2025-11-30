/**
 * Redis Client for AI Worker
 *
 * Exports singleton RedisService instance for transcript caching and job results.
 * Also exports ioredis client for model capability checking.
 */

import { createClient, type RedisClientType } from 'redis';
import { Redis as IORedis } from 'ioredis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createRedisSocketConfig,
  createBullMQRedisConfig,
  VoiceTranscriptCache,
} from '@tzurot/common-types';
import { RedisService } from './services/RedisService.js';
import { modelSupportsVision, clearCapabilityCache } from './services/ModelCapabilityChecker.js';

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

// Create ioredis client for model capability checking (uses same Redis URL)
//
// NOTE: We maintain both node-redis and ioredis clients because:
// - node-redis: Used by RedisService and VoiceTranscriptCache (existing infrastructure)
// - ioredis: Required by BullMQ and ModelCapabilityChecker (library requirements)
//
// This results in 2 Redis connections per ai-worker instance.
// TODO: Consider migrating fully to ioredis to reduce connection overhead (tech debt)
const ioredisConfig = createBullMQRedisConfig({
  host: parsedUrl.host,
  port: parsedUrl.port,
  password: parsedUrl.password,
  username: parsedUrl.username,
  family: 6, // Railway private network uses IPv6
});

const ioredisClient = new IORedis({
  host: ioredisConfig.host,
  port: ioredisConfig.port,
  password: ioredisConfig.password,
  username: ioredisConfig.username,
  family: ioredisConfig.family,
});

ioredisClient.on('error', (error: Error) => {
  logger.error({ err: error }, '[Redis] ioredis client error');
});

ioredisClient.on('connect', () => {
  logger.info('[Redis] ioredis client connected (for model capability checking)');
});

/**
 * Check if a model supports vision input using OpenRouter's cached model data.
 * This is a singleton wrapper that uses the shared ioredis client.
 *
 * @param modelId - The model ID to check (e.g., "google/gemma-3-27b-it:free")
 * @returns true if the model supports image input
 */
export async function checkModelVisionSupport(modelId: string): Promise<boolean> {
  return modelSupportsVision(modelId, ioredisClient);
}

/**
 * Clear the model capability cache (useful when model data is updated)
 */
export { clearCapabilityCache };
