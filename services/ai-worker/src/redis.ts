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
import { FreeTierRequestQuota, ZAI_FREE_TIER_KEYS } from './services/FreeTierRequestQuota.js';
import { ZaiPlanMeter } from './services/ZaiPlanMeter.js';
import { ZaiFreeTierAdmission } from './services/ZaiFreeTierAdmission.js';
import { reactToZaiFreeTierFailure } from './services/zaiBusinessCodes.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
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

// Export singleton FreeTierRequestQuota — rolling-window fair share for the
// shared system OpenRouter free-tier key (guests + credit-exhausted-BYOK
// fallback). Budget/window/floor/ceiling are runtime-tunable system settings,
// resolved per decision through the SWR cache (admin edits apply to the next
// request; the instance's Redis window state is untouched).
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: shared Redis client; multiple instances would each keep a separate view of the shared-key contention set and undercount the fair-share cap.
export const freeTierRequestQuota = new FreeTierRequestQuota(redis, () => ({
  globalDailyBudget: getSystemSetting('freeTierGlobalDailyBudget'),
  windowMinutes: getSystemSetting('freeTierWindowMinutes'),
  minPerWindow: getSystemSetting('freeTierMinPerWindow'),
  maxPerWindow: getSystemSetting('freeTierMaxPerWindow'),
}));

// z.ai free-tier piggyback singletons: the plan meter (owner-protection input,
// also mirrored to Redis for /admin usage), a second fair-share quota over the
// zaifreeq:* pool (same window/floor/ceiling knobs, its own daily budget), and
// the admission gate composing flag + kill switch + headroom + fair share.
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: caches the plan reading process-wide; per-instance caches would multiply endpoint calls.
export const zaiPlanMeter = new ZaiPlanMeter(getConfig().ZAI_CODING_API_KEY, redis);
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: shared Redis client; a second instance would keep a separate view of the zai contention set and undercount the fair-share cap.
export const zaiFreeTierQuota = new FreeTierRequestQuota(
  redis,
  () => ({
    globalDailyBudget: getSystemSetting('zaiGlobalDailyBudget'),
    windowMinutes: getSystemSetting('freeTierWindowMinutes'),
    minPerWindow: getSystemSetting('freeTierMinPerWindow'),
    maxPerWindow: getSystemSetting('freeTierMaxPerWindow'),
  }),
  undefined,
  ZAI_FREE_TIER_KEYS
);
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: composes the singleton meter/quota above; a second instance would split their shared state.
export const zaiFreeTierAdmission = new ZaiFreeTierAdmission(
  redis,
  zaiFreeTierQuota,
  zaiPlanMeter,
  {
    enabled: () => getSystemSetting('zaiFreeTierEnabled'),
    apiKey: getConfig().ZAI_CODING_API_KEY,
    headroomPercent: () => getSystemSetting('zaiHeadroomPercent'),
  }
);

/** Pre-wired z.ai failure reactor (keeps the raw redis client module-private). */
export const zaiFreeTierFailureReactor = (error: unknown): Promise<void> =>
  reactToZaiFreeTierFailure(redis, zaiPlanMeter, error);

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
