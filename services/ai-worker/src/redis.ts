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

import { initCoreRedisServices } from '@tzurot/common-types/utils/redis';
import { VisionDescriptionCache } from './services/VisionDescriptionCache.js';
import { RedisService } from './services/RedisService.js';
import { RateLimitCache } from './services/RateLimitCache.js';
import { CreditExhaustionCache } from './services/CreditExhaustionCache.js';
import { VisionFallbackQuota } from './services/VisionFallbackQuota.js';
import {
  modelSupportsVision,
  modelSupportsReasoning,
  getModelContextLength,
} from './services/ModelCapabilityChecker.js';

const { redis, voiceTranscriptCache } = initCoreRedisServices('WorkerRedis');

// Export singleton RedisService instance
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: RedisService wraps ioredis client for job results and streaming. Multiple instances would create redundant connections and inconsistent state.
export const redisService = new RedisService(redis);

// Singleton: shares Redis connection for transcript caching — see initCoreRedisServices
export { voiceTranscriptCache };

// Export singleton VisionDescriptionCache instance — L1 Redis only (no L2 PostgreSQL).
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: shared Redis client; multiple instances would bypass the cache and waste API calls.
export const visionDescriptionCache = new VisionDescriptionCache(redis);

// Export singleton RateLimitCache instance — short-circuits LLM calls when a
// (apiKey, model) pair is in a known rate-limit window.
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: shared Redis client; multiple instances would each maintain a separate view of rate-limit state and miss the short-circuit.
export const rateLimitCache = new RateLimitCache(redis);

// Export singleton CreditExhaustionCache instance — short-circuits LLM calls
// when a BYOK account is known to be out of credits (per-account 402).
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: shared Redis client; multiple instances would each maintain a separate view of credit-exhaustion state and miss the short-circuit.
export const creditExhaustionCache = new CreditExhaustionCache(redis);

// Export singleton VisionFallbackQuota instance — per-user daily cap on
// system-key free-vision fallbacks (bounds the broad-fallback freeloading surface).
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: shared Redis client; multiple instances would each maintain a separate per-user counter and undercount the shared cap.
export const visionFallbackQuota = new VisionFallbackQuota(redis);

/**
 * Check if a model supports vision input using OpenRouter's cached model data.
 * This is a singleton wrapper that uses the shared ioredis client.
 *
 * @param modelId - The model ID to check (e.g., "google/gemma-4-31b-it:free")
 * @returns true if the model supports image input
 */
export async function checkModelVisionSupport(modelId: string): Promise<boolean> {
  return modelSupportsVision(modelId, redis);
}

/**
 * Check if a model supports reasoning parameters using OpenRouter's cached model data.
 * This is a singleton wrapper that uses the shared ioredis client.
 *
 * @param modelId - The model ID to check
 * @returns true if the model supports reasoning parameters
 */
export async function checkModelReasoningSupport(modelId: string): Promise<boolean> {
  return modelSupportsReasoning(modelId, redis);
}

/**
 * Get a model's real context length using OpenRouter's cached model data.
 * This is a singleton wrapper that uses the shared ioredis client.
 *
 * @param modelId - The model ID to look up
 * @returns The context length in tokens, or null when unknown (cache miss, non-OpenRouter model)
 */
export async function checkModelContextLength(modelId: string): Promise<number | null> {
  return getModelContextLength(modelId, redis);
}
