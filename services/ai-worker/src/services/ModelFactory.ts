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
  AI_DEFAULTS,
  AI_ENDPOINTS,
  type ConvertedLlmParams,
} from '@tzurot/common-types';
import { isReasoningModel } from '../utils/reasoningModelUtils.js';
import { createOpenRouterFetch } from './modelFactory/OpenRouterFetch.js';
import type { OpenRouterExtraParams } from './modelFactory/OpenRouterFetch.js';

// Re-export extracted modules for backward compatibility
export { getModelCacheKey } from './modelFactory/CacheKeyBuilder.js';

const logger = createLogger('ModelFactory');
const config = getConfig();

/**
 * Models with restricted parameter sets.
 * Some providers only support a subset of sampling parameters.
 * Sending unsupported params causes 400 "Provider returned error" from OpenRouter.
 *
 * Maps model patterns to sets of unsupported parameter names (snake_case API keys).
 * Filtering covers both first-class ChatOpenAI params and modelKwargs.
 */
const RESTRICTED_PARAM_MODELS: { pattern: RegExp; unsupported: ReadonlySet<string> }[] = [
  {
    // GLM 4.5 Air supports only: temperature, top_p, top_k, max_tokens,
    // repetition_penalty, reasoning, tools, tool_choice
    // frequency_penalty confirmed to cause 400 errors in production
    pattern: /glm-4\.5-air/i,
    unsupported: new Set(['frequency_penalty', 'presence_penalty', 'seed']),
  },
];

/**
 * Filter unsupported sampling params for models with restricted parameter sets.
 * Mutates modelKwargs in place and returns cleaned first-class params.
 *
 * @returns Object with filtered first-class params (frequency_penalty, presence_penalty)
 */
function filterRestrictedParams(
  modelName: string,
  firstClassParams: { frequencyPenalty?: number; presencePenalty?: number },
  modelKwargs: Record<string, unknown>
): { frequencyPenalty?: number; presencePenalty?: number } {
  // Find restricted param set for this model
  let unsupported: ReadonlySet<string> | null = null;
  for (const entry of RESTRICTED_PARAM_MODELS) {
    if (entry.pattern.test(modelName)) {
      unsupported = entry.unsupported;
      break;
    }
  }
  if (unsupported === null) {
    return firstClassParams;
  }

  const filtered: string[] = [];
  let { frequencyPenalty, presencePenalty } = firstClassParams;

  if (frequencyPenalty !== undefined && unsupported.has('frequency_penalty')) {
    frequencyPenalty = undefined;
    filtered.push('frequency_penalty');
  }
  if (presencePenalty !== undefined && unsupported.has('presence_penalty')) {
    presencePenalty = undefined;
    filtered.push('presence_penalty');
  }
  // Filter from modelKwargs (keys are already snake_case)
  for (const key of Object.keys(modelKwargs)) {
    if (unsupported.has(key)) {
      delete modelKwargs[key];
      filtered.push(key);
    }
  }
  if (filtered.length > 0) {
    logger.warn(
      { modelName, filteredParams: filtered },
      '[ModelFactory] Filtered unsupported params for restricted model to prevent 400 errors'
    );
  }

  return { frequencyPenalty, presencePenalty };
}

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

/** Add a value to kwargs if defined */
function addIfDefined<T>(kwargs: Record<string, unknown>, key: string, value: T | undefined): void {
  if (value !== undefined) {
    kwargs[key] = value;
  }
}

/** Add an array to kwargs if non-empty */
function addIfNonEmpty(
  kwargs: Record<string, unknown>,
  key: string,
  value: unknown[] | undefined
): void {
  if (value !== undefined && value.length > 0) {
    kwargs[key] = value;
  }
}

/** Add an object to kwargs if it has keys */
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
 * Build reasoning params object from ModelConfig reasoning.
 *
 * IMPORTANT: OpenRouter only accepts ONE of `effort` OR `max_tokens`, not both.
 * When both are specified, we prefer `effort` since it's the simpler user-friendly option.
 */
function buildReasoningParams(
  reasoning: ModelConfig['reasoning']
): Record<string, unknown> | undefined {
  if (reasoning === undefined) {
    return undefined;
  }

  const params: Record<string, unknown> = {};

  // OpenRouter constraint: only ONE of effort or max_tokens can be specified
  if (reasoning.effort !== undefined) {
    params.effort = reasoning.effort;
    if (reasoning.maxTokens !== undefined) {
      logger.warn(
        { effort: reasoning.effort, maxTokens: reasoning.maxTokens },
        '[ModelFactory] Both reasoning.effort and reasoning.maxTokens set, using effort (maxTokens ignored - OpenRouter constraint)'
      );
    }
  } else if (reasoning.maxTokens !== undefined) {
    params.max_tokens = reasoning.maxTokens;
  }

  addIfDefined(params, 'exclude', reasoning.exclude);
  addIfDefined(params, 'enabled', reasoning.enabled);

  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Build model kwargs for provider-specific parameters.
 * These are params that LangChain doesn't have first-class support for,
 * but OpenRouter/OpenAI accept via the API.
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

  return kwargs;
}

/**
 * Build OpenRouter-specific parameters that are injected via custom fetch.
 */
function buildOpenRouterExtraParams(modelConfig: ModelConfig): OpenRouterExtraParams {
  const params: OpenRouterExtraParams = {};

  if (modelConfig.transforms !== undefined && modelConfig.transforms.length > 0) {
    params.transforms = modelConfig.transforms;
  }
  if (modelConfig.route !== undefined) {
    params.route = modelConfig.route;
  }
  if (modelConfig.verbosity !== undefined) {
    params.verbosity = modelConfig.verbosity;
  }

  return params;
}

/** Type for reasoning effort levels */
type ReasoningEffort = 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';

/**
 * Calculate effective maxTokens for a model based on reasoning configuration.
 *
 * For reasoning models: scales maxTokens based on reasoning.effort level.
 * For standard models: uses the config maxTokens as-is.
 */
function getEffectiveMaxTokens(
  modelName: string,
  configMaxTokens: number | undefined,
  reasoningEffort: ReasoningEffort | undefined
): number | undefined {
  if (configMaxTokens !== undefined) {
    return configMaxTokens;
  }

  if (!isReasoningModel(modelName) || reasoningEffort === undefined) {
    return configMaxTokens;
  }

  const scaledMaxTokens = AI_DEFAULTS.REASONING_MODEL_MAX_TOKENS[reasoningEffort];

  logger.info(
    {
      modelName,
      reasoningEffort,
      scaledMaxTokens,
      defaultMaxTokens: AI_DEFAULTS.MAX_TOKENS,
    },
    '[ModelFactory] Scaling maxTokens for reasoning model based on effort level'
  );

  return scaledMaxTokens;
}

/**
 * Create a chat model based on configured AI provider
 *
 * Currently only OpenRouter is supported. OpenRouter can route to any provider
 * including OpenAI, Anthropic, Google, etc. models.
 */
export function createChatModel(modelConfig: ModelConfig = {}): ChatModelResult {
  const provider = config.AI_PROVIDER;
  const modelName = validateModelName(modelConfig.modelName);

  const temperature = modelConfig.temperature;
  const topP = modelConfig.topP;

  const maxTokens = getEffectiveMaxTokens(
    modelName,
    modelConfig.maxTokens,
    modelConfig.reasoning?.effort
  );

  const modelKwargs = buildModelKwargs(modelConfig);

  const { frequencyPenalty, presencePenalty } = filterRestrictedParams(
    modelName,
    {
      frequencyPenalty: modelConfig.frequencyPenalty,
      presencePenalty: modelConfig.presencePenalty,
    },
    modelKwargs
  );

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

      const extraParams = buildOpenRouterExtraParams(modelConfig);
      const hasExtraParams = Object.keys(extraParams).length > 0;

      const hasReasoning = modelConfig.reasoning !== undefined;
      const needsCustomFetch = hasExtraParams || hasReasoning;

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
          extraParams: hasExtraParams ? extraParams : undefined,
          reasoningEnabled: hasReasoning,
          customFetch: needsCustomFetch,
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
            fetch: needsCustomFetch ? createOpenRouterFetch(extraParams) : undefined,
          },
        }),
        modelName,
      };
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported AI provider: ${String(_exhaustive)}`);
    }
  }
}
