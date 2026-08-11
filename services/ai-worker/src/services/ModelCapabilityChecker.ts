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
import { AI_DEFAULTS, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { type OpenRouterModel } from '@tzurot/common-types/types/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import {
  hasVisionSupportFallback,
  hasReasoningSupportFallback,
} from './modelCapabilityPatterns.js';

const logger = createLogger('ModelCapabilityChecker');

/**
 * In-memory cache for model capabilities to avoid repeated Redis lookups
 * within the same request cycle
 */
interface CachedCapabilities {
  supportsVision: boolean;
  supportsReasoning: boolean;
  /** The model's real context length in tokens; null when no limit is known (catalog does not list the model, or a transient miss with nothing memoized). */
  contextLength: number | null;
}

/**
 * The outcome of a catalog lookup, split so callers can tell a settled answer
 * from a temporary one:
 * - `resolved` — the catalog listed the model
 * - `transient` — the catalog itself was unavailable, so we do not know
 * - `absent` — the catalog loaded and genuinely does not list this model
 *   (the normal case for non-OpenRouter providers)
 */
type CatalogLookup =
  | { kind: 'resolved'; capabilities: CachedCapabilities }
  | { kind: 'transient'; cause?: unknown }
  | { kind: 'absent' };

// TTLCache bounds memory (LRU) and expires entries on access, replacing an
// unbounded Map + manual timestamp checks. maxSize 500 comfortably covers the
// OpenRouter catalog (~300 models, plus `:free` variants) with headroom.
const capabilityCache = new TTLCache<CachedCapabilities>({
  ttl: AI_DEFAULTS.MODEL_CAPABILITY_CACHE_TTL_MS,
  maxSize: 500,
});

// A model's context length is effectively static, so a value we have already
// resolved stays valid across a catalog outage. This long-lived memo is what
// keeps a transient miss from unclamping a model whose real limit we have seen.
const lastKnownContextLength = new TTLCache<number>({
  ttl: AI_DEFAULTS.MODEL_CONTEXT_LENGTH_MEMO_TTL_MS,
  maxSize: 500,
});

/** Normalize model ID for cache key (strip :free suffix) */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/:free$/, '');
}

/**
 * Resolve model capabilities from the Redis catalog cache.
 * Shared between vision and reasoning checks to avoid duplicate Redis reads.
 *
 * An absent/empty key, an unparseable payload, and a Redis error are all
 * `transient` — in each case the catalog is unavailable, so a missing model
 * proves nothing about the model. Only a successfully-loaded catalog that
 * does not list the model yields `absent`.
 *
 * @param modelId - Original model ID (for logging and fallback matching)
 * @param normalizedId - :free-stripped ID (for cache key and primary model lookup)
 * @param redis - Redis client instance
 */
async function resolveFromRedis(
  modelId: string,
  normalizedId: string,
  redis: Redis
): Promise<CatalogLookup> {
  try {
    const modelsJson = await redis.get(REDIS_KEY_PREFIXES.OPENROUTER_MODELS);
    if (modelsJson === null || modelsJson === '') {
      return { kind: 'transient' };
    }

    let models: OpenRouterModel[];
    try {
      models = JSON.parse(modelsJson) as OpenRouterModel[];
    } catch (parseError) {
      // The caller emits the single warn for every transient cause; returning
      // the error rather than logging it here keeps one line per failure.
      return { kind: 'transient', cause: parseError };
    }

    const model = models.find(m => m.id === normalizedId || m.id === modelId);
    if (!model) {
      return { kind: 'absent' };
    }

    const capabilities: CachedCapabilities = {
      supportsVision: model.architecture.input_modalities.includes('image'),
      supportsReasoning: model.supported_parameters.includes('reasoning'),
      // Normalize at the parse boundary, not at each consumer. `OpenRouterModel`
      // declares context_length as a number, but this catalog arrives through an
      // unchecked cast, so a missing or non-numeric field would otherwise flow on
      // as `undefined` — past every `!== null` guard downstream, including
      // clampContextWindow's, and into `Math.floor(undefined * fraction)`.
      contextLength: typeof model.context_length === 'number' ? model.context_length : null,
    };

    capabilityCache.set(normalizedId, capabilities);
    logger.debug(
      {
        modelId,
        supportsVision: capabilities.supportsVision,
        supportsReasoning: capabilities.supportsReasoning,
        contextLength: capabilities.contextLength,
        source: 'redis-cache',
      },
      '[ModelCapabilityChecker] Resolved capabilities from cache'
    );
    return { kind: 'resolved', capabilities };
  } catch (error) {
    return { kind: 'transient', cause: error };
  }
}

/**
 * Build capabilities from pattern matching, carrying whatever context length
 * the caller was able to establish (null when none is known).
 */
function buildFallbackCapabilities(
  modelId: string,
  contextLength: number | null
): CachedCapabilities {
  return {
    supportsVision: hasVisionSupportFallback(modelId),
    supportsReasoning: hasReasoningSupportFallback(modelId),
    contextLength,
  };
}

/**
 * Get cached capabilities or resolve from Redis + fallback.
 * Returns the full capabilities object (vision + reasoning).
 */
async function getCapabilities(modelId: string, redis: Redis): Promise<CachedCapabilities> {
  const normalizedId = normalizeModelId(modelId);

  // Check in-memory cache first (TTLCache returns null on miss/expiry)
  const cached = capabilityCache.get(normalizedId);
  if (cached !== null) {
    return cached;
  }

  const lookup = await resolveFromRedis(modelId, normalizedId, redis);

  if (lookup.kind === 'resolved') {
    // Track the last settled answer in BOTH directions. `OpenRouterModel`
    // declares context_length as a number, but the catalog is JSON.parse'd
    // through an unchecked cast, so a wire-level null reaches here as one —
    // and a memo from an earlier read must not outlive that.
    if (lookup.capabilities.contextLength !== null) {
      lastKnownContextLength.set(normalizedId, lookup.capabilities.contextLength);
    } else {
      lastKnownContextLength.delete(normalizedId);
    }
    return lookup.capabilities;
  }

  if (lookup.kind === 'absent') {
    // A settled answer: the catalog loaded and does not list this model, so
    // null context length means "no limit is known to exist" — correct for
    // non-OpenRouter providers. Safe to cache for the normal TTL.
    //
    // Drop any memo too. This observation is newer than whatever the memo
    // holds, so a model deprecated or renamed out of the catalog must not keep
    // serving its old length to a later transient miss. Pinned by "drops the
    // memo once the catalog confirms the model is absent".
    lastKnownContextLength.delete(normalizedId);
    const capabilities = buildFallbackCapabilities(modelId, null);
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

  if (lookup.kind === 'transient') {
    // The catalog was unavailable, so this is not an answer worth freezing for
    // the capability-cache TTL — deliberately NOT written to capabilityCache so
    // the next generation retries Redis. Cost: this function backs the vision,
    // reasoning, and context-length checks, which are separate calls, so a
    // sustained outage costs one failing `redis.get` per consumer per
    // generation — up to three — rather than one. Still bounded, not a loop.
    //
    // This is the ONLY warn on the transient path: resolveFromRedis hands back
    // its cause instead of logging it, so each failure produces one line
    // carrying both the error and the memo state a triager needs.
    const memoizedContextLength = lastKnownContextLength.get(normalizedId);
    const capabilities = buildFallbackCapabilities(modelId, memoizedContextLength);
    logger.warn(
      {
        ...(lookup.cause !== undefined && { err: lookup.cause }),
        modelId,
        supportsVision: capabilities.supportsVision,
        supportsReasoning: capabilities.supportsReasoning,
        contextLength: memoizedContextLength,
        hasMemoizedContextLength: memoizedContextLength !== null,
        source: 'pattern-fallback',
      },
      '[ModelCapabilityChecker] Model catalog unavailable — running on degraded capability data'
    );
    return capabilities;
  }

  // A new CatalogLookup variant must choose its own handling rather than
  // silently inheriting the degraded-transient path.
  const _exhaustive: never = lookup;
  throw new Error(`Unhandled catalog lookup kind: ${String(_exhaustive)}`);
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
 * @param modelId - The model ID to check (e.g., "google/gemma-4-31b-it:free")
 * @param redis - Redis client instance
 * @returns true if the model supports image input
 */
export async function modelSupportsVision(modelId: string, redis: Redis): Promise<boolean> {
  // The free-model router is vision-capable BY DESIGN — selectVisionModel
  // assigns it directly as the guest/free vision fallback, so a capability
  // query must never misreport it. Authoritative override, not a fallback:
  // no VISION_MODEL_PATTERNS substring matches 'openrouter/free', and the
  // router's own catalog row (if any) wouldn't describe the vision-capable
  // models it routes to.
  if (normalizeModelId(modelId) === FREE_ROUTER_MODEL) {
    return true;
  }
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

/**
 * Get a model's real context length from OpenRouter's cached model data.
 *
 * Same resolution order as the other capability checks (in-memory cache →
 * Redis cache → fallback), plus a 24h memo of the last successfully-resolved
 * length so a catalog outage returns the real limit instead of "unknown".
 * Returns null when the catalog does not list the model (e.g., non-OpenRouter
 * providers), or when the catalog is unavailable and the model was never
 * resolved — callers must degrade gracefully rather than assume a limit.
 *
 * @param modelId - The model ID to look up
 * @param redis - Redis client instance
 * @returns The context length in tokens, or null when unknown
 */
export async function getModelContextLength(modelId: string, redis: Redis): Promise<number | null> {
  const capabilities = await getCapabilities(modelId, redis);
  return capabilities.contextLength;
}

/**
 * Clear the in-memory capability caches, including the long-lived context-length
 * memo — the memo is part of the same capability state, so a caller asking for a
 * clean slate must not be left with a stale remembered limit.
 * Useful for testing or when model data is known to have changed
 */
export function clearCapabilityCache(): void {
  capabilityCache.clear();
  lastKnownContextLength.clear();
}
