/**
 * Cache key generation for model instances.
 *
 * Different reasoning/sampling configs should produce different model instances
 * to ensure correct behavior for each user's configuration.
 */

import { getConfig } from '@tzurot/common-types';
import type { ModelConfig } from '../ModelFactory.js';

const config = getConfig();

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
  const provider = config.AI_PROVIDER;

  // Resolve model name with fallback chain
  const modelName = modelConfig.modelName ?? (config.DEFAULT_AI_MODEL || 'default');

  // Use API key prefix for cache isolation (different keys = different instances)
  const apiKey = modelConfig.apiKey;
  const apiKeyPrefix =
    apiKey !== undefined && apiKey.length >= 10 ? apiKey.substring(0, 10) : 'env';

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
    cacheArr(modelConfig.stop),
    cacheVal(modelConfig.responseFormat?.type),
    cacheVal(modelConfig.showThinking),
    // Reasoning - all fields affect reasoning param in modelKwargs
    cacheVal(modelConfig.reasoning?.enabled),
    cacheVal(modelConfig.reasoning?.exclude),
    cacheVal(modelConfig.reasoning?.effort),
    cacheVal(modelConfig.reasoning?.maxTokens),
    // OpenRouter
    cacheArr(modelConfig.transforms),
    cacheVal(modelConfig.route),
  ].join(':');

  return `${provider}-${modelName}-${apiKeyPrefix}-${paramsKey}`;
}
