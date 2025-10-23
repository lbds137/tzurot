/**
 * Model Factory - Creates appropriate LangChain chat models based on environment configuration
 *
 * Supports:
 * - Gemini (Google AI) - via AI_PROVIDER=gemini
 * - OpenRouter - via AI_PROVIDER=openrouter or OPENROUTER_API_KEY
 * - OpenAI - via AI_PROVIDER=openai or OPENAI_API_KEY
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createLogger, getConfig } from '@tzurot/common-types';

const logger = createLogger('ModelFactory');
const config = getConfig();

/**
 * Available Gemini models (2025 - only 2.5+ models)
 * Using 2.5 Flash as default for cost-effectiveness
 */
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'; // Fast, cheap, and stable

/**
 * Validate and normalize model name for the current provider
 */
function validateModelForProvider(requestedModel: string | undefined, provider: string): string {
  switch (provider) {
    case 'gemini': {
      // If no model requested, use default
      if (!requestedModel) {
        return GEMINI_DEFAULT_MODEL;
      }

      // Check if requested model is available for Gemini
      const normalizedModel = requestedModel.toLowerCase();
      const isGeminiModel = GEMINI_MODELS.some(m => normalizedModel.includes(m.toLowerCase()));

      if (isGeminiModel) {
        // Find the exact match from our list
        const exactModel = GEMINI_MODELS.find(m => normalizedModel.includes(m.toLowerCase()));
        return exactModel || GEMINI_DEFAULT_MODEL;
      }

      // Requested model is not a Gemini model
      logger.warn(
        `[ModelFactory] Model "${requestedModel}" not available for Gemini, using ${GEMINI_DEFAULT_MODEL}`
      );
      return GEMINI_DEFAULT_MODEL;
    }

    case 'openrouter': {
      // OpenRouter supports many models, use DEFAULT_AI_MODEL or requested model
      return requestedModel || config.DEFAULT_AI_MODEL;
    }

    case 'openai': {
      // Use requested model or default
      return requestedModel || config.DEFAULT_AI_MODEL;
    }

    default:
      return requestedModel || config.DEFAULT_AI_MODEL;
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
    case 'gemini': {
      const apiKey = modelConfig.apiKey || config.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
      }

      // Validate and get appropriate Gemini model
      const requestedModel = modelConfig.modelName || config.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, 'gemini');

      if (requestedModel && requestedModel !== modelName) {
        logger.info(
          `[ModelFactory] Personality requested "${requestedModel}", using validated model: ${modelName}`
        );
      } else {
        logger.info(`[ModelFactory] Creating Gemini model: ${modelName}`);
      }

      return {
        model: new ChatGoogleGenerativeAI({
          model: modelName,
          apiKey,
          temperature,
        }),
        modelName
      };
    }

    case 'openrouter': {
      const apiKey = modelConfig.apiKey || config.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter');
      }

      const requestedModel = modelConfig.modelName || config.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, 'openrouter');

      logger.info(`[ModelFactory] Creating OpenRouter model: ${modelName}`);

      return {
        model: new ChatOpenAI({
          modelName,
          apiKey,
          temperature,
          configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
          },
        }),
        modelName
      };
    }

    case 'openai': {
      const apiKey = modelConfig.apiKey || config.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
      }

      const requestedModel = modelConfig.modelName || config.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, 'openai');

      logger.info(`[ModelFactory] Creating OpenAI model: ${modelName}`);

      return {
        model: new ChatOpenAI({
          modelName,
          apiKey,
          temperature,
        }),
        modelName
      };
    }

    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: gemini, openrouter, openai`);
  }
}

/**
 * Get a cache key for model instances
 */
export function getModelCacheKey(modelConfig: ModelConfig): string {
  const provider = config.AI_PROVIDER;
  const modelName = modelConfig.modelName || config.DEFAULT_AI_MODEL || 'default';
  const apiKeyPrefix = modelConfig.apiKey?.substring(0, 10) || 'env';
  return `${provider}-${modelName}-${apiKeyPrefix}`;
}
