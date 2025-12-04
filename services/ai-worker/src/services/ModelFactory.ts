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
import { createLogger, getConfig, AIProvider, AI_ENDPOINTS } from '@tzurot/common-types';

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

export interface ModelConfig {
  modelName?: string;
  apiKey?: string; // User-provided key (BYOK)
  // LLM sampling parameters
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  maxTokens?: number;
}

/**
 * Result of creating a chat model
 */
export interface ChatModelResult {
  model: BaseChatModel;
  modelName: string;
}

/**
 * Build model kwargs for provider-specific parameters.
 * These are params that LangChain doesn't have first-class support for,
 * but OpenRouter/OpenAI accept via the API.
 */
function buildModelKwargs(modelConfig: ModelConfig): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};

  // top_k is supported by OpenRouter but not a standard OpenAI param
  if (modelConfig.topK !== undefined) {
    kwargs.top_k = modelConfig.topK;
  }

  // repetition_penalty is supported by OpenRouter (alternative to frequency/presence penalty)
  if (modelConfig.repetitionPenalty !== undefined) {
    kwargs.repetition_penalty = modelConfig.repetitionPenalty;
  }

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

/**
 * Get a cache key for model instances.
 * Includes all sampling params so different configs get different cached instances.
 */
export function getModelCacheKey(modelConfig: ModelConfig): string {
  const provider = config.AI_PROVIDER;
  const modelName =
    modelConfig.modelName !== undefined && modelConfig.modelName.length > 0
      ? modelConfig.modelName
      : config.DEFAULT_AI_MODEL.length > 0
        ? config.DEFAULT_AI_MODEL
        : 'default';
  const apiKeyPrefix =
    modelConfig.apiKey !== undefined && modelConfig.apiKey.length >= 10
      ? modelConfig.apiKey.substring(0, 10)
      : 'env';

  // Include sampling params in cache key so different configs get different instances
  const paramsKey = [
    modelConfig.temperature ?? 0.7,
    modelConfig.topP ?? '-',
    modelConfig.topK ?? '-',
    modelConfig.frequencyPenalty ?? '-',
    modelConfig.presencePenalty ?? '-',
    modelConfig.repetitionPenalty ?? '-',
    modelConfig.maxTokens ?? '-',
  ].join(':');

  return `${provider}-${modelName}-${apiKeyPrefix}-${paramsKey}`;
}
