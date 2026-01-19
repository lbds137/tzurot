/**
 * Redis Client for Bot
 *
 * Single ioredis client for all Redis operations:
 * - RedisService: Webhook message tracking
 * - VoiceTranscriptCache: Transcript caching
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
  PersonaCacheInvalidationService,
} from '@tzurot/common-types';
import { RedisService } from './services/RedisService.js';
import { initSessionManager, shutdownSessionManager } from './utils/dashboard/index.js';

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
// eslint-disable-next-line @tzurot/no-singleton-export -- Redis requires singleton pattern for connection reuse
export const redisService = new RedisService(redis);

// Export singleton VoiceTranscriptCache instance
// eslint-disable-next-line @tzurot/no-singleton-export -- Redis requires singleton pattern for connection reuse
export const voiceTranscriptCache = new VoiceTranscriptCache(redis);

// Export singleton PersonaCacheInvalidationService instance
// Used by persona commands to broadcast cache invalidation events to ai-worker instances
// eslint-disable-next-line @tzurot/no-singleton-export -- Redis requires singleton pattern for connection reuse
export const personaCacheInvalidationService = new PersonaCacheInvalidationService(redis);

// Initialize Dashboard Session Manager
// This enables Redis-backed session storage for dashboard editing sessions
try {
  initSessionManager(redis);
} catch (error) {
  logger.error(
    { err: error },
    '[Redis] Failed to initialize session manager - dashboards will not work'
  );
  // Session manager remains null; getSessionManager() will throw a clear error if called
}

// Export close function for graceful shutdown
export async function closeRedis(): Promise<void> {
  shutdownSessionManager();
  await redisService.close();
}
