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

import { createLogger, initCoreRedisServices } from '@tzurot/common-types';
import { RedisService } from './services/RedisService.js';
import { initSessionManager, shutdownSessionManager } from './utils/dashboard/index.js';

const logger = createLogger('Redis');

const { redis, voiceTranscriptCache } = initCoreRedisServices('Redis');

// Export raw Redis client for direct access (e.g., pending verification messages)
export { redis };

// Export singleton RedisService instance
// eslint-disable-next-line @tzurot/no-singleton-export -- Redis requires singleton pattern for connection reuse
export const redisService = new RedisService(redis);

// Export singleton VoiceTranscriptCache instance
export { voiceTranscriptCache };

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
