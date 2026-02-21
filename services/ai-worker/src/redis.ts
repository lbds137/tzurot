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

import {
  initCoreRedisServices,
  VisionDescriptionCache,
  PersistentVisionCache,
  getPrismaClient,
} from '@tzurot/common-types';
import { RedisService } from './services/RedisService.js';
import { modelSupportsVision } from './services/ModelCapabilityChecker.js';

const { redis, voiceTranscriptCache } = initCoreRedisServices('Redis');

// Export singleton RedisService instance
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: RedisService wraps ioredis client for job results and streaming. Multiple instances would create redundant connections and inconsistent state.
export const redisService = new RedisService(redis);

// Export singleton VoiceTranscriptCache instance
 
export { voiceTranscriptCache };

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
