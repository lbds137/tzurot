/**
 * Model Factory - Creates appropriate LangChain chat models based on environment configuration
 *
 * Supports:
 * - OpenRouter - via AI_PROVIDER=openrouter or OPENROUTER_API_KEY
 * - OpenAI - via AI_PROVIDER=openai or OPENAI_API_KEY
 */

import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger, getConfig, AIProvider, AI_ENDPOINTS } from '@tzurot/common-types';

const logger = createLogger('ModelFactory');
const config = getConfig();

/**
 * Validate and normalize model name for the current provider
 */
function validateModelForProvider(requestedModel: string | undefined, provider: AIProvider): string {
  switch (provider) {
    case AIProvider.OpenRouter: {
      // OpenRouter supports many models, use DEFAULT_AI_MODEL or requested model
      return requestedModel !== undefined && requestedModel.length > 0
        ? requestedModel
        : config.DEFAULT_AI_MODEL;
    }

    case AIProvider.OpenAI: {
      // Use requested model or default
      return requestedModel !== undefined && requestedModel.length > 0
        ? requestedModel
        : config.DEFAULT_AI_MODEL;
    }

    default:
      return requestedModel !== undefined && requestedModel.length > 0
        ? requestedModel
        : config.DEFAULT_AI_MODEL;
  }
}

export interface ModelConfig {
  modelName?: string;
  temperature?: number;
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
 * Create a chat model based on environment configuration
 */
export function createChatModel(modelConfig: ModelConfig = {}): ChatModelResult {
  const provider = config.AI_PROVIDER;
  const temperature = modelConfig.temperature ?? 0.7;

  logger.debug(`[ModelFactory] Creating model for provider: ${provider}`);

  switch (provider) {
    case AIProvider.OpenRouter: {
      const apiKey =
        modelConfig.apiKey !== undefined && modelConfig.apiKey.length > 0
          ? modelConfig.apiKey
          : config.OPENROUTER_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error('OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter');
      }

      const requestedModel =
        modelConfig.modelName !== undefined && modelConfig.modelName.length > 0
          ? modelConfig.modelName
          : config.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, AIProvider.OpenRouter);

      logger.info(`[ModelFactory] Creating OpenRouter model: ${modelName}`);

      return {
        model: new ChatOpenAI({
          modelName,
          apiKey,
          temperature,
          configuration: {
            baseURL: AI_ENDPOINTS.OPENROUTER_BASE_URL,
          },
        }),
        modelName,
      };
    }

    case AIProvider.OpenAI: {
      const apiKey =
        modelConfig.apiKey !== undefined && modelConfig.apiKey.length > 0
          ? modelConfig.apiKey
          : config.OPENAI_API_KEY;
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
      }

      const requestedModel =
        modelConfig.modelName !== undefined && modelConfig.modelName.length > 0
          ? modelConfig.modelName
          : config.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, AIProvider.OpenAI);

      logger.info(`[ModelFactory] Creating OpenAI model: ${modelName}`);

      return {
        model: new ChatOpenAI({
          modelName,
          apiKey,
          temperature,
        }),
        modelName,
      };
    }

    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: openrouter, openai`);
  }
}

/**
 * Get a cache key for model instances
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
  return `${provider}-${modelName}-${apiKeyPrefix}`;
}
