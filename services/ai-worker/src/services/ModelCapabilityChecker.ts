/**
 * ModelCapabilityChecker
 *
 * Checks model capabilities using the OpenRouter models cache in Redis.
 * This reads from the same cache that api-gateway populates, avoiding
 * hardcoded model lists and ensuring accurate capability detection.
 *
 * Falls back to pattern matching if cache is unavailable.
 */

import type { Redis } from 'ioredis';
import {
  createLogger,
  REDIS_KEY_PREFIXES,
  AI_DEFAULTS,
  type OpenRouterModel,
} from '@tzurot/common-types';

const logger = createLogger('ModelCapabilityChecker');

/**
 * In-memory cache for model capabilities to avoid repeated Redis lookups
 * within the same request cycle
 */
interface CachedCapabilities {
  supportsVision: boolean;
  timestamp: number;
}

const capabilityCache = new Map<string, CachedCapabilities>();

/**
 * Check if a model supports vision input using OpenRouter's model data
 *
 * Resolution order:
 * 1. In-memory cache (5 min TTL)
 * 2. Redis cache (populated by api-gateway)
 * 3. Fallback to pattern matching (for resilience)
 *
 * Note on :free suffix handling:
 * OpenRouter's /api/v1/models endpoint returns model IDs WITHOUT the :free suffix.
 * However, users and LlmConfig may store model IDs WITH the suffix (e.g., "x-ai/grok-4.1-fast:free").
 * We normalize by stripping :free for the cache key, and check both forms when querying the model list
 * to handle edge cases where OpenRouter might change their behavior.
 *
 * @param modelId - The model ID to check (e.g., "google/gemma-3-27b-it:free")
 * @param redis - Redis client instance
 * @returns true if the model supports image input
 */
export async function modelSupportsVision(modelId: string, redis: Redis): Promise<boolean> {
  // Normalize model ID for cache key (strip :free suffix since OpenRouter stores without it)
  const normalizedId = modelId.replace(/:free$/, '');

  // Check in-memory cache first
  const cached = capabilityCache.get(normalizedId);
  if (cached && Date.now() - cached.timestamp < AI_DEFAULTS.MODEL_CAPABILITY_CACHE_TTL_MS) {
    return cached.supportsVision;
  }

  // Try to get from Redis cache
  try {
    const modelsJson = await redis.get(REDIS_KEY_PREFIXES.OPENROUTER_MODELS);
    if (modelsJson !== null && modelsJson !== '') {
      // Parse JSON separately for clearer error logging
      let models: OpenRouterModel[];
      try {
        models = JSON.parse(modelsJson) as OpenRouterModel[];
      } catch (parseError) {
        logger.warn(
          { err: parseError, modelId },
          '[ModelCapabilityChecker] Failed to parse Redis cache data, using fallback'
        );
        // Fall through to pattern matching
        models = [];
      }

      const model = models.find(m => m.id === normalizedId || m.id === modelId);

      if (model) {
        const supportsVision = model.architecture.input_modalities.includes('image');
        capabilityCache.set(normalizedId, { supportsVision, timestamp: Date.now() });
        logger.debug(
          { modelId, supportsVision, source: 'redis-cache' },
          '[ModelCapabilityChecker] Resolved vision capability from cache'
        );
        return supportsVision;
      }
    }
  } catch (error) {
    logger.warn(
      { err: error, modelId },
      '[ModelCapabilityChecker] Failed to read from Redis, using fallback'
    );
  }

  // Fallback to pattern matching for resilience
  const supportsVision = hasVisionSupportFallback(modelId);
  capabilityCache.set(normalizedId, { supportsVision, timestamp: Date.now() });
  logger.debug(
    { modelId, supportsVision, source: 'pattern-fallback' },
    '[ModelCapabilityChecker] Using pattern matching fallback'
  );
  return supportsVision;
}

/**
 * Vision model patterns for fallback detection
 * Each pattern has a required term and optional additional terms (any must match)
 */
const VISION_MODEL_PATTERNS: { required: string; additional?: string[] }[] = [
  // OpenAI vision models (gpt-4 + vision/4o/turbo)
  { required: 'gpt-4', additional: ['vision', '4o', 'turbo'] },
  // Anthropic Claude 3+ models
  { required: 'claude-3' },
  { required: 'claude-4' },
  // Google Gemini models (gemini + 1.5/2./vision)
  { required: 'gemini', additional: ['1.5', '2.', 'vision'] },
  // Google Gemma 3 models
  { required: 'gemma-3' },
  { required: 'gemma3' },
  // Llama vision models
  { required: 'llama', additional: ['vision'] },
  // Qwen VL models
  { required: 'qwen', additional: ['vl', 'vision'] },
];

/**
 * Fallback pattern matching for vision support detection
 * Used when Redis cache is unavailable
 */
function hasVisionSupportFallback(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  return VISION_MODEL_PATTERNS.some(pattern => {
    if (!normalized.includes(pattern.required)) {
      return false;
    }
    // If no additional terms required, the required term is sufficient
    if (!pattern.additional) {
      return true;
    }
    // At least one additional term must match
    return pattern.additional.some(term => normalized.includes(term));
  });
}

/**
 * Clear the in-memory capability cache
 * Useful for testing or when model data is known to have changed
 */
export function clearCapabilityCache(): void {
  capabilityCache.clear();
}
