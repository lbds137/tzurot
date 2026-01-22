/**
 * Model Factory - Creates appropriate LangChain chat models based on environment configuration
 *
 * Supports:
 * - OpenRouter - via AI_PROVIDER=openrouter or OPENROUTER_API_KEY
 *
 * Note: OpenAI API key is used internally for embeddings/whisper, but not for chat models.
 * All chat/generation goes through OpenRouter which can route to any provider including OpenAI models.
 */

import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createLogger,
  getConfig,
  AIProvider,
  AI_ENDPOINTS,
  type ConvertedLlmParams,
} from '@tzurot/common-types';

const logger = createLogger('ModelFactory');
const config = getConfig();

/**
 * Validate and normalize model name
 */
function validateModelName(requestedModel: string | undefined): string {
  return requestedModel !== undefined && requestedModel.length > 0
    ? requestedModel
    : config.DEFAULT_AI_MODEL;
}

/**
 * Model configuration for creating chat models.
 * Extends ConvertedLlmParams to include ALL parameters from advancedParameters JSONB.
 *
 * Parameter categories:
 * - Sampling (basic): temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty
 * - Sampling (advanced): minP, topA, seed
 * - Output: maxTokens, stop, logitBias, responseFormat, showThinking
 * - Reasoning: reasoning object (for thinking models: o1/o3, Claude, Gemini, DeepSeek R1)
 * - OpenRouter-specific: transforms, route, verbosity
 */
export interface ModelConfig extends ConvertedLlmParams {
  modelName?: string;
  apiKey?: string; // User-provided key (BYOK)
}

/**
 * Result of creating a chat model
 */
export interface ChatModelResult {
  model: BaseChatModel;
  modelName: string;
}

/**
 * Add a value to kwargs if defined
 */
function addIfDefined<T>(kwargs: Record<string, unknown>, key: string, value: T | undefined): void {
  if (value !== undefined) {
    kwargs[key] = value;
  }
}

/**
 * Add an array to kwargs if non-empty
 */
function addIfNonEmpty(
  kwargs: Record<string, unknown>,
  key: string,
  value: unknown[] | undefined
): void {
  if (value !== undefined && value.length > 0) {
    kwargs[key] = value;
  }
}

/**
 * Add an object to kwargs if it has keys
 */
function addIfHasKeys(
  kwargs: Record<string, unknown>,
  key: string,
  value: Record<string, unknown> | undefined
): void {
  if (value !== undefined && Object.keys(value).length > 0) {
    kwargs[key] = value;
  }
}

/**
 * Build reasoning params object from ModelConfig reasoning
 */
function buildReasoningParams(
  reasoning: ModelConfig['reasoning']
): Record<string, unknown> | undefined {
  if (reasoning === undefined) {
    return undefined;
  }

  const params: Record<string, unknown> = {};
  addIfDefined(params, 'effort', reasoning.effort);
  addIfDefined(params, 'max_tokens', reasoning.maxTokens);
  addIfDefined(params, 'exclude', reasoning.exclude);
  addIfDefined(params, 'enabled', reasoning.enabled);

  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Build model kwargs for provider-specific parameters.
 * These are params that LangChain doesn't have first-class support for,
 * but OpenRouter/OpenAI accept via the API.
 *
 * Handles:
 * - Sampling (advanced): top_k, repetition_penalty, min_p, top_a, seed
 * - Output: stop, logit_bias, response_format
 * - Reasoning: reasoning object (CRITICAL for thinking models)
 * - OpenRouter-specific: transforms, route, verbosity
 *
 * @see https://openrouter.ai/docs/parameters for full parameter documentation
 */
function buildModelKwargs(modelConfig: ModelConfig): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};

  // Sampling (advanced) - OpenRouter-specific
  addIfDefined(kwargs, 'top_k', modelConfig.topK);
  addIfDefined(kwargs, 'repetition_penalty', modelConfig.repetitionPenalty);
  addIfDefined(kwargs, 'min_p', modelConfig.minP);
  addIfDefined(kwargs, 'top_a', modelConfig.topA);
  addIfDefined(kwargs, 'seed', modelConfig.seed);

  // Output control
  addIfNonEmpty(kwargs, 'stop', modelConfig.stop);
  addIfHasKeys(kwargs, 'logit_bias', modelConfig.logitBias);
  addIfDefined(kwargs, 'response_format', modelConfig.responseFormat);

  // Reasoning (CRITICAL for thinking models: o1/o3, Claude, Gemini, DeepSeek R1)
  addIfHasKeys(kwargs, 'reasoning', buildReasoningParams(modelConfig.reasoning));

  // OpenRouter-specific routing/transform
  addIfNonEmpty(kwargs, 'transforms', modelConfig.transforms);
  addIfDefined(kwargs, 'route', modelConfig.route);
  addIfDefined(kwargs, 'verbosity', modelConfig.verbosity);

  return kwargs;
}

/**
 * Create a chat model based on configured AI provider
 *
 * Currently only OpenRouter is supported. OpenRouter can route to any provider
 * including OpenAI, Anthropic, Google, etc. models.
 */
export function createChatModel(modelConfig: ModelConfig = {}): ChatModelResult {
  const provider = config.AI_PROVIDER;

  // Extract sampling parameters with defaults
  const temperature = modelConfig.temperature ?? 0.7;
  const topP = modelConfig.topP;
  const frequencyPenalty = modelConfig.frequencyPenalty;
  const presencePenalty = modelConfig.presencePenalty;
  const maxTokens = modelConfig.maxTokens;

  // Build kwargs for provider-specific params (top_k, repetition_penalty)
  const modelKwargs = buildModelKwargs(modelConfig);
  const hasModelKwargs = Object.keys(modelKwargs).length > 0;

  switch (provider) {
    case AIProvider.OpenRouter: {
      const apiKey =
        modelConfig.apiKey !== undefined && modelConfig.apiKey.length > 0
          ? modelConfig.apiKey
          : config.OPENROUTER_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error('OPENROUTER_API_KEY is required for AI generation');
      }

      const modelName = validateModelName(modelConfig.modelName);

      logger.debug(
        {
          provider,
          modelName,
          temperature,
          topP,
          frequencyPenalty,
          presencePenalty,
          maxTokens,
          modelKwargs: hasModelKwargs ? modelKwargs : undefined,
        },
        '[ModelFactory] Creating model'
      );

      return {
        model: new ChatOpenAI({
          modelName,
          apiKey,
          temperature,
          topP,
          frequencyPenalty,
          presencePenalty,
          maxTokens,
          modelKwargs: hasModelKwargs ? modelKwargs : undefined,
          configuration: {
            baseURL: AI_ENDPOINTS.OPENROUTER_BASE_URL,
          },
        }),
        modelName,
      };
    }

    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      throw new Error(`Unsupported AI provider: ${String(_exhaustive)}`);
    }
  }
}

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
 *
 * Important: Different reasoning/sampling configs should produce different model instances
 * to ensure correct behavior for each user's configuration.
 */
export function getModelCacheKey(modelConfig: ModelConfig): string {
  const provider = config.AI_PROVIDER;

  // Resolve model name with fallback chain
  const modelName = modelConfig.modelName ?? (config.DEFAULT_AI_MODEL || 'default');

  // Use API key prefix for cache isolation (different keys = different instances)
  const apiKey = modelConfig.apiKey;
  const apiKeyPrefix =
    apiKey !== undefined && apiKey.length >= 10 ? apiKey.substring(0, 10) : 'env';

  // Build params key from all config values
  const paramsKey = [
    // Basic sampling
    cacheVal(modelConfig.temperature, 0.7),
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
    // Reasoning
    cacheVal(modelConfig.reasoning?.effort),
    cacheVal(modelConfig.reasoning?.maxTokens),
    // OpenRouter
    cacheArr(modelConfig.transforms),
    cacheVal(modelConfig.route),
  ].join(':');

  return `${provider}-${modelName}-${apiKeyPrefix}-${paramsKey}`;
}
