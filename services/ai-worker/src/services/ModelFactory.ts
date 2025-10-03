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
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ModelFactory');

export interface ModelConfig {
  modelName?: string;
  temperature?: number;
  apiKey?: string; // User-provided key (BYOK)
}

/**
 * Create a chat model based on environment configuration
 */
export function createChatModel(config: ModelConfig = {}): BaseChatModel {
  const provider = process.env.AI_PROVIDER || 'openrouter';
  const temperature = config.temperature ?? 0.7;

  logger.debug(`[ModelFactory] Creating model for provider: ${provider}`);

  switch (provider) {
    case 'gemini': {
      const apiKey = config.apiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
      }

      const modelName = config.modelName || process.env.DEFAULT_AI_MODEL || 'gemini-1.5-pro';

      logger.info(`[ModelFactory] Creating Gemini model: ${modelName}`);

      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey,
        temperature,
      });
    }

    case 'openrouter': {
      const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter');
      }

      const modelName = config.modelName || process.env.DEFAULT_AI_MODEL || 'google/gemini-2.0-flash-exp:free';
      const baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

      logger.info(`[ModelFactory] Creating OpenRouter model: ${modelName}`);

      return new ChatOpenAI({
        modelName,
        openAIApiKey: apiKey,
        temperature,
        configuration: {
          baseURL,
        },
      });
    }

    case 'openai': {
      const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
      }

      const modelName = config.modelName || process.env.DEFAULT_AI_MODEL || 'gpt-4';

      logger.info(`[ModelFactory] Creating OpenAI model: ${modelName}`);

      return new ChatOpenAI({
        modelName,
        openAIApiKey: apiKey,
        temperature,
      });
    }

    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: gemini, openrouter, openai`);
  }
}

/**
 * Get a cache key for model instances
 */
export function getModelCacheKey(config: ModelConfig): string {
  const provider = process.env.AI_PROVIDER || 'openrouter';
  const modelName = config.modelName || process.env.DEFAULT_AI_MODEL || 'default';
  const apiKeyPrefix = config.apiKey?.substring(0, 10) || 'env';
  return `${provider}-${modelName}-${apiKeyPrefix}`;
}
