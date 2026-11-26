/**
 * Cache key generation for model instances.
 *
 * Different thinking/sampling configs should produce different model instances
 * to ensure correct behavior for each user's configuration.
 */

import { sha256Hex } from '@tzurot/common-types/utils/sha256Hex';
import type { ModelConfig } from './types.js';
import { resolveModelName, resolveProvider } from './modelResolution.js';
import { promptCacheGateFires } from './promptCacheGate.js';

/** Serialize a value for cache key, using '-' for undefined/null */
function cacheVal<T>(value: T | undefined | null, defaultVal?: T): string {
  if (value === undefined || value === null) {
    return defaultVal !== undefined ? String(defaultVal) : '-';
  }
  return String(value);
}

/** Serialize an array for cache key */
function cacheArr(value: unknown[] | undefined): string {
  return value !== undefined && value.length > 0 ? value.join(',') : '-';
}

/**
 * Get a cache key for model instances.
 * Includes ALL params so different configs get different cached instances.
 */
export function getModelCacheKey(modelConfig: ModelConfig): string {
  // Per-request provider override wins over env-level default. Required so
  // requests routed to different providers (e.g. zai-coding vs openrouter)
  // for the same model name don't share a cached ChatOpenAI instance with
  // the wrong baseURL.
  const provider = resolveProvider(modelConfig.provider);

  // Same resolution the factory uses, so the caching gate below sees the id
  // the factory gates on (an empty modelName resolves to the fallback setting).
  const modelName = resolveModelName(modelConfig.modelName);
  const cachingGateFires = promptCacheGateFires({
    provider,
    promptCaching: modelConfig.promptCaching,
    modelName,
  });

  // Whole-key digest, never a substring: vendor keys share a long prefix.
  const apiKey = modelConfig.apiKey;
  const apiKeyDigest =
    apiKey !== undefined && apiKey.length > 0 ? sha256Hex(apiKey, { length: 16 }) : 'env';

  // Build params key from all config values (no defaults - undefined is a valid state)
  const paramsKey = [
    // Basic sampling
    cacheVal(modelConfig.temperature),
    cacheVal(modelConfig.topP),
    cacheVal(modelConfig.topK),
    cacheVal(modelConfig.frequencyPenalty),
    cacheVal(modelConfig.presencePenalty),
    cacheVal(modelConfig.repetitionPenalty),
    // Advanced sampling
    cacheVal(modelConfig.minP),
    cacheVal(modelConfig.topA),
    cacheVal(modelConfig.seed),
    // Output
    cacheVal(modelConfig.maxTokens),
    cacheVal(modelConfig.responseFormat?.type),
    // Thinking - the canonical level drives the reasoning param in modelKwargs
    cacheVal(modelConfig.thinking),
    cacheVal(modelConfig.supportsReasoning),
    // Prompt caching - the gate result, not the raw flag: the factory reads
    // promptCaching only through promptCacheGateFires, so the flag changes the
    // instance only when the gate fires. A GLM conversation call and a one-shot
    // GLM call with the same params share one instance.
    cacheVal(cachingGateFires),
    // Per-conversation stickiness id (OpenRouter `session_id`): ModelFactory
    // bakes it into the instance's fetch closure only when
    // promptCacheGateFires is true, so only then must each sessionId get its
    // own instance. Elsewhere the row stays '-' and a GLM/Gemini/GPT
    // conversation shares one instance across channels.
    cacheVal(cachingGateFires ? modelConfig.sessionId : undefined),
    // OpenRouter
    cacheArr(modelConfig.transforms),
    cacheVal(modelConfig.route),
  ].join(':');

  return `${provider}-${modelName}-${apiKeyDigest}-${paramsKey}`;
}
