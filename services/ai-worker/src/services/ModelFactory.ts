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
      return requestedModel || process.env.DEFAULT_AI_MODEL || 'google/gemini-2.0-flash-exp:free';
    }

    case 'openai': {
      // Use requested model or default to GPT-5 Mini
      return requestedModel || process.env.DEFAULT_AI_MODEL || 'gpt-5-mini';
    }

    default:
      return requestedModel || 'gpt-3.5-turbo';
  }
}

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

      // Validate and get appropriate Gemini model
      const requestedModel = config.modelName || process.env.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, 'gemini');

      if (requestedModel && requestedModel !== modelName) {
        logger.info(
          `[ModelFactory] Personality requested "${requestedModel}", using validated model: ${modelName}`
        );
      } else {
        logger.info(`[ModelFactory] Creating Gemini model: ${modelName}`);
      }

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

      const requestedModel = config.modelName || process.env.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, 'openrouter');
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

      const requestedModel = config.modelName || process.env.DEFAULT_AI_MODEL;
      const modelName = validateModelForProvider(requestedModel, 'openai');

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
