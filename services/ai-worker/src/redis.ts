/**
 * Redis Client for AI Worker
 *
 * Single ioredis client for all Redis operations:
 * - RedisService: Job results and streaming
 * - VoiceTranscriptCache: Transcript caching
 * - ModelCapabilityChecker: Vision support detection
 *
 * Unified on ioredis because BullMQ requires it anyway.
 * This eliminates the previous dual-client overhead (node-redis + ioredis).
 */

import { Redis as IORedis } from 'ioredis';
import {
  createLogger,
  getConfig,
  parseRedisUrl,
  createBullMQRedisConfig,
  VoiceTranscriptCache,
  VisionDescriptionCache,
  PersistentVisionCache,
  getPrismaClient,
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

// Use BullMQ-compatible config for all ioredis operations
const ioredisConfig = createBullMQRedisConfig({
  host: parsedUrl.host,
  port: parsedUrl.port,
  password: parsedUrl.password,
  username: parsedUrl.username,
  family: 6, // Railway private network uses IPv6
});

logger.info(
  {
    host: ioredisConfig.host,
    port: ioredisConfig.port,
    hasPassword: ioredisConfig.password !== undefined,
    connectTimeout: ioredisConfig.connectTimeout,
    commandTimeout: ioredisConfig.commandTimeout,
  },
  '[Redis] Redis config (ioredis):'
);

// Single ioredis client for all operations
const redis = new IORedis({
  host: ioredisConfig.host,
  port: ioredisConfig.port,
  password: ioredisConfig.password,
  username: ioredisConfig.username,
  family: ioredisConfig.family,
  connectTimeout: ioredisConfig.connectTimeout,
  commandTimeout: ioredisConfig.commandTimeout,
  keepAlive: ioredisConfig.keepAlive,
  lazyConnect: ioredisConfig.lazyConnect,
  enableReadyCheck: ioredisConfig.enableReadyCheck,
  // Note: maxRetriesPerRequest is set to null for BullMQ queues, but we want
  // standard retries for general Redis operations. Leave as default (20).
});

redis.on('error', (error: Error) => {
  logger.error({ err: error }, '[Redis] ioredis client error');
});

redis.on('connect', () => {
  logger.info('[Redis] Connected to Redis (ioredis)');
});

redis.on('ready', () => {
  logger.info('[Redis] Redis client ready');
});

redis.on('reconnecting', () => {
  logger.info('[Redis] Reconnecting to Redis');
});

// Export singleton RedisService instance
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: RedisService wraps ioredis client for job results and streaming. Multiple instances would create redundant connections and inconsistent state.
export const redisService = new RedisService(redis);

// Export singleton VoiceTranscriptCache instance
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: VoiceTranscriptCache shares Redis connection for transcript caching. Multiple instances would cause cache misses and wasted API calls.
export const voiceTranscriptCache = new VoiceTranscriptCache(redis);

// Export singleton VisionDescriptionCache instance with L2 persistent cache
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: VisionDescriptionCache shares Redis connection with L2 PostgreSQL cache. Multiple instances would bypass cache layers and waste API calls.
export const visionDescriptionCache = new VisionDescriptionCache(redis);

// Set up L2 (PostgreSQL) cache for persistent storage
// This survives Redis restarts and reduces API costs
const prisma = getPrismaClient();
const persistentVisionCache = new PersistentVisionCache(prisma);
visionDescriptionCache.setL2Cache(persistentVisionCache);

/**
 * Check if a model supports vision input using OpenRouter's cached model data.
 * This is a singleton wrapper that uses the shared ioredis client.
 *
 * @param modelId - The model ID to check (e.g., "google/gemma-3-27b-it:free")
 * @returns true if the model supports image input
 */
export async function checkModelVisionSupport(modelId: string): Promise<boolean> {
  return modelSupportsVision(modelId, redis);
}

/**
 * Clear the model capability cache (useful when model data is updated)
 */
export { clearCapabilityCache };

/**
 * Close Redis connection for graceful shutdown
 */
export async function closeRedis(): Promise<void> {
  await redisService.close();
}
