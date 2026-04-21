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
  supportsReasoning: boolean;
  timestamp: number;
}

const capabilityCache = new Map<string, CachedCapabilities>();

/** Normalize model ID for cache key (strip :free suffix) */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/:free$/, '');
}

/**
 * Resolve model capabilities from Redis cache, returning null on miss/error.
 * Shared between vision and reasoning checks to avoid duplicate Redis reads.
 *
 * @param modelId - Original model ID (for logging and fallback matching)
 * @param normalizedId - :free-stripped ID (for cache key and primary model lookup)
 * @param redis - Redis client instance
 */
async function resolveFromRedis(
  modelId: string,
  normalizedId: string,
  redis: Redis
): Promise<CachedCapabilities | null> {
  try {
    const modelsJson = await redis.get(REDIS_KEY_PREFIXES.OPENROUTER_MODELS);
    if (modelsJson === null || modelsJson === '') {
      return null;
    }

    let models: OpenRouterModel[];
    try {
      models = JSON.parse(modelsJson) as OpenRouterModel[];
    } catch (parseError) {
      logger.warn({ err: parseError, modelId }, 'Failed to parse Redis cache data, using fallback');
      return null;
    }

    const model = models.find(m => m.id === normalizedId || m.id === modelId);
    if (!model) {
      return null;
    }

    const capabilities: CachedCapabilities = {
      supportsVision: model.architecture.input_modalities.includes('image'),
      supportsReasoning: model.supported_parameters.includes('reasoning'),
      timestamp: Date.now(),
    };

    capabilityCache.set(normalizedId, capabilities);
    logger.debug(
      {
        modelId,
        supportsVision: capabilities.supportsVision,
        supportsReasoning: capabilities.supportsReasoning,
        source: 'redis-cache',
      },
      '[ModelCapabilityChecker] Resolved capabilities from cache'
    );
    return capabilities;
  } catch (error) {
    logger.warn({ err: error, modelId }, 'Failed to read from Redis, using fallback');
    return null;
  }
}

/**
 * Get cached capabilities or resolve from Redis + fallback.
 * Returns the full capabilities object (vision + reasoning).
 */
async function getCapabilities(modelId: string, redis: Redis): Promise<CachedCapabilities> {
  const normalizedId = normalizeModelId(modelId);

  // Check in-memory cache first
  const cached = capabilityCache.get(normalizedId);
  if (cached && Date.now() - cached.timestamp < AI_DEFAULTS.MODEL_CAPABILITY_CACHE_TTL_MS) {
    return cached;
  }

  // Try Redis
  const fromRedis = await resolveFromRedis(modelId, normalizedId, redis);
  if (fromRedis !== null) {
    return fromRedis;
  }

  // Fallback to pattern matching
  const capabilities: CachedCapabilities = {
    supportsVision: hasVisionSupportFallback(modelId),
    supportsReasoning: hasReasoningSupportFallback(modelId),
    timestamp: Date.now(),
  };

  capabilityCache.set(normalizedId, capabilities);
  logger.debug(
    {
      modelId,
      supportsVision: capabilities.supportsVision,
      supportsReasoning: capabilities.supportsReasoning,
      source: 'pattern-fallback',
    },
    '[ModelCapabilityChecker] Using pattern matching fallback'
  );
  return capabilities;
}

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
  const capabilities = await getCapabilities(modelId, redis);
  return capabilities.supportsVision;
}

/**
 * Check if a model supports reasoning/thinking parameters using OpenRouter's model data
 *
 * Resolution order:
 * 1. In-memory cache (5 min TTL)
 * 2. Redis cache (populated by api-gateway) — checks `supported_parameters.includes('reasoning')`
 * 3. Fallback to pattern matching for known reasoning-capable models
 *
 * This is a **capability gate** to prevent sending reasoning params to models that
 * don't support them at all. Models that intermittently glitch (producing raw
 * chain-of-thought) are handled separately by the glitch detection in ResponsePostProcessor.
 *
 * @param modelId - The model ID to check
 * @param redis - Redis client instance
 * @returns true if the model supports reasoning parameters
 */
export async function modelSupportsReasoning(modelId: string, redis: Redis): Promise<boolean> {
  const capabilities = await getCapabilities(modelId, redis);
  return capabilities.supportsReasoning;
}

// ===================================
// Vision fallback patterns
// ===================================

/**
 * Vision model patterns for fallback detection.
 * Each pattern has a required term and optional additional terms (any must match).
 *
 * Source of truth: OpenRouter /api/v1/models `architecture.input_modalities` field.
 * These fallbacks only fire when Redis cache (primary path) is unavailable.
 */
const VISION_MODEL_PATTERNS: { required: string; additional?: string[] }[] = [
  // OpenAI vision models (gpt-4 + vision/4o/turbo)
  { required: 'gpt-4', additional: ['vision', '4o', 'turbo'] },
  // Anthropic Claude 3+ models
  { required: 'claude-3' },
  { required: 'claude-4' },
  // Google Gemini models — '2.' matches dot-separated (gemini-2.0-flash),
  // '2-' matches hyphen-separated (gemini-2-flash) alternate naming
  { required: 'gemini', additional: ['1.5', '2.', '2-', 'vision'] },
  // Google Gemma 3 models
  { required: 'gemma-3' },
  { required: 'gemma3' },
  // Llama vision models
  { required: 'llama', additional: ['vision'] },
  // Qwen VL models + Qwen 3.5 (natively multimodal; qwen3 base models are text-only)
  // Note: qwen3-vl is already matched by { required: 'qwen', additional: ['vl'] }
  { required: 'qwen', additional: ['vl', 'vision'] },
  { required: 'qwen3.5' },
  // Mistral vision models
  { required: 'pixtral' },
  // InternVL models
  { required: 'internvl' },
];

/** Check patterns against a normalized model name */
function matchesPatterns(
  normalized: string,
  patterns: { required: string; additional?: string[] }[]
): boolean {
  return patterns.some(pattern => {
    if (!normalized.includes(pattern.required)) {
      return false;
    }
    if (!pattern.additional) {
      return true;
    }
    return pattern.additional.some(term => normalized.includes(term));
  });
}

/**
 * Fallback pattern matching for vision support detection
 * Used when Redis cache is unavailable
 */
function hasVisionSupportFallback(modelName: string): boolean {
  return matchesPatterns(modelName.toLowerCase(), VISION_MODEL_PATTERNS);
}

// ===================================
// Reasoning fallback patterns
// ===================================

/**
 * Reasoning model patterns for fallback detection.
 * Used when Redis cache is unavailable.
 *
 * Based on OpenRouter /api/v1/models `supported_parameters` data (March 2026).
 * These are conservative fallbacks — a false positive sends reasoning params
 * to a model that rejects them at the API level (recoverable), not data corruption.
 */
const REASONING_MODEL_PATTERNS: { required: string; additional?: string[] }[] = [
  // DeepSeek R1 + V3 series (reasoning-capable per OpenRouter)
  { required: 'deepseek-r1' },
  { required: 'deepseek-reasoner' },
  { required: 'deepseek-v3' },
  { required: 'deepseek-chat-v3' },
  // Qwen QwQ (dedicated reasoning) + Qwen 3+ (all support reasoning per OpenRouter)
  // Note: 'qwen3' intentionally broad — matches qwen3, qwen3.5, qwen3-coder, etc.
  { required: 'qwq' },
  { required: 'qwen3' },
  // OpenAI GPT-5 family + GPT-OSS
  { required: 'gpt-5' },
  { required: 'gpt-oss' },
  // Anthropic Claude 3.7+ (model IDs: claude-3.7-sonnet, claude-sonnet-4.x, etc.)
  { required: 'claude-3.7' },
  { required: 'claude-sonnet-4' },
  { required: 'claude-opus-4' },
  { required: 'claude-haiku-4' },
  // Google Gemini 1.5+ — '2.' matches dot-separated, '2-' matches hyphen-separated
  { required: 'gemini', additional: ['1.5', '2.', '2-', '3'] },
  // Kimi K2 (confirmed reasoning-capable)
  { required: 'kimi-k2' },
  // GLM 4+/5 (Z.AI, confirmed reasoning-capable)
  { required: 'glm-4' },
  { required: 'glm-5' },
  // xAI Grok 3+ (reasoning-capable per OpenRouter)
  { required: 'grok-3' },
  { required: 'grok-4' },
];

/**
 * Fallback pattern matching for reasoning support detection
 * Used when Redis cache is unavailable
 */
function hasReasoningSupportFallback(modelName: string): boolean {
  return matchesPatterns(modelName.toLowerCase(), REASONING_MODEL_PATTERNS);
}

/**
 * Clear the in-memory capability cache
 * Useful for testing or when model data is known to have changed
 */
export function clearCapabilityCache(): void {
  capabilityCache.clear();
}
