/**
 * Vision Processor
 *
 * Processes images to extract text descriptions using vision models.
 * Supports personality's configured vision model, main LLM with vision support,
 * or fallback to default vision model (Qwen3-VL).
 *
 * Vision capability detection uses OpenRouter's cached model data from Redis
 * for accurate, dynamic capability checking rather than hardcoded model lists.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  createLogger,
  getConfig,
  AI_DEFAULTS,
  TIMEOUTS,
  AI_ENDPOINTS,
  MODEL_DEFAULTS,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { logErrorWithDetails } from '../../utils/errorHandling.js';
import { checkModelVisionSupport, visionDescriptionCache } from '../../redis.js';

const logger = createLogger('VisionProcessor');
const config = getConfig();

/**
 * Check if a model has vision support using OpenRouter's cached model data.
 *
 * This queries the Redis cache populated by api-gateway's OpenRouterModelCache,
 * which contains accurate capability information from OpenRouter's /models API.
 *
 * @param modelName - The model ID to check (e.g., "google/gemma-3-27b-it:free")
 * @returns true if the model supports image input
 */
export async function hasVisionSupport(modelName: string): Promise<boolean> {
  return checkModelVisionSupport(modelName);
}

/**
 * Describe an image using vision model
 * Uses personality's model if it has vision, otherwise uses uncensored fallback
 * Throws errors to allow retry logic to handle them
 *
 * @param attachment - Image attachment to describe
 * @param personality - Personality configuration for vision model selection
 * @param isGuestMode - Whether the user is in guest mode (no BYOK API key)
 *                      Guest users use free vision models, BYOK users use paid models
 * @param userApiKey - Optional user's BYOK API key (for BYOK users, this should be passed
 *                     so their API key is used instead of the bot's primary key)
 */
export async function describeImage(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  isGuestMode = false,
  userApiKey?: string
): Promise<string> {
  logger.info(
    {
      personalityName: personality.name,
      mainModel: personality.model,
      visionModel: personality.visionModel,
      visionModelType: typeof personality.visionModel,
    },
    'describeImage called - checking vision model configuration'
  );

  // Check cache first to avoid duplicate vision API calls
  // This is especially important for referenced message images which may be processed
  // both inline (ReferencedMessageFormatter) and via preprocessing (ImageDescriptionJob)
  const cacheKeyOptions = { attachmentId: attachment.id, url: attachment.url };
  const cachedDescription = await visionDescriptionCache.get(cacheKeyOptions);
  if (cachedDescription !== null) {
    logger.info(
      { attachmentName: attachment.name, attachmentId: attachment.id },
      'Using cached vision description - avoiding duplicate API call'
    );
    return cachedDescription;
  }

  let description: string;
  let usedModel: string;

  // Priority 1: Use personality's configured vision model if specified
  if (
    personality.visionModel !== undefined &&
    personality.visionModel !== null &&
    personality.visionModel.length > 0
  ) {
    logger.info(
      { visionModel: personality.visionModel },
      'Using configured vision model (personality override)'
    );
    usedModel = personality.visionModel;
    description = await describeWithVisionModel(attachment, personality, usedModel, userApiKey);
  } else {
    // Priority 2: Use personality's main model if it has native vision support
    const mainModelHasVision = await hasVisionSupport(personality.model);
    if (mainModelHasVision) {
      logger.info(
        { model: personality.model },
        'Using main LLM for vision (native vision support detected)'
      );
      usedModel = personality.model;
      description = await describeWithVisionModel(attachment, personality, usedModel, userApiKey);
    } else {
      // Priority 3: Use fallback vision model
      // Guest users (no BYOK API key) use Gemma 3 27b (free), BYOK users use Qwen3-VL (paid)
      usedModel = isGuestMode ? MODEL_DEFAULTS.VISION_FALLBACK_FREE : config.VISION_FALLBACK_MODEL;

      logger.info(
        { mainModel: personality.model, fallbackModel: usedModel, isGuestMode },
        'Using fallback vision model - main LLM lacks vision support'
      );
      description = await describeWithFallbackVision(
        attachment,
        personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
          ? personality.systemPrompt
          : '',
        usedModel,
        userApiKey
      );
    }
  }

  // Cache the description for future use (both L1 Redis and L2 PostgreSQL)
  await visionDescriptionCache.store(
    { attachmentId: attachment.id, url: attachment.url, model: usedModel },
    description
  );

  return description;
}

/**
 * Describe image using specified vision model (includes system prompt/jailbreak)
 */
async function describeWithVisionModel(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  modelName: string,
  userApiKey?: string
): Promise<string> {
  // Determine API key and base URL based on model
  let apiKey: string | undefined;
  let baseURL: string | undefined;

  if (modelName.includes('gpt-') || modelName.includes('openai')) {
    // Use direct OpenAI API for OpenAI models
    // BYOK users use their own key, otherwise fall back to system key
    apiKey = userApiKey ?? config.OPENAI_API_KEY;
  } else {
    // Use OpenRouter for all other models (including Claude, Gemini, Llama, etc.)
    // BYOK users use their own key, otherwise fall back to system key
    apiKey = userApiKey ?? config.OPENROUTER_API_KEY;
    baseURL = AI_ENDPOINTS.OPENROUTER_BASE_URL;
  }

  if (userApiKey !== undefined) {
    logger.info({ modelName }, 'Using user BYOK API key for vision processing');
  }

  const model = new ChatOpenAI({
    modelName,
    apiKey,
    configuration: baseURL !== undefined && baseURL.length > 0 ? { baseURL } : undefined,
    temperature: AI_DEFAULTS.VISION_TEMPERATURE,
  });

  const messages = [];

  // Include personality's system prompt (with jailbreak)
  if (personality.systemPrompt !== undefined && personality.systemPrompt.length > 0) {
    messages.push(new SystemMessage(personality.systemPrompt));
  }

  // Use direct URL (attachment is already downloaded and resized by api-gateway)
  logger.info({ url: attachment.url, modelName }, 'Using direct attachment URL');

  // Request detailed, objective description
  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: {
            url: attachment.url,
          },
        },
        {
          type: 'text',
          text: 'Provide a detailed, objective description of this image for archival purposes. Focus on visual details without making value judgments. Describe what you see clearly and thoroughly.',
        },
      ],
    })
  );

  try {
    logger.info({ modelName }, 'Invoking vision model with 90s timeout');
    // Timeout must be passed to invoke(), not constructor (LangChain requirement)
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    const context: Record<string, unknown> = { modelName };

    // Extract API response details if available
    if (error !== null && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>;
      if ('response' in errorObj) {
        context.apiResponse = errorObj.response;
      }
      if ('status' in errorObj) {
        context.statusCode = errorObj.status;
      }
      if ('statusText' in errorObj) {
        context.statusText = errorObj.statusText;
      }
    }

    logErrorWithDetails(logger, 'Vision model invocation failed', error, context);
    throw error; // Re-throw to allow retry logic to handle
  }
}

/**
 * Describe image using fallback vision model
 * Uses Gemma 3 27b for guest users (no BYOK), Qwen3-VL for BYOK users
 */
async function describeWithFallbackVision(
  attachment: AttachmentMetadata,
  systemPrompt: string,
  fallbackModelName: string,
  userApiKey?: string
): Promise<string> {
  // BYOK users use their own key, otherwise fall back to system key
  const apiKey = userApiKey ?? config.OPENROUTER_API_KEY;

  if (userApiKey !== undefined) {
    logger.info({ fallbackModelName }, 'Using user BYOK API key for fallback vision processing');
  }

  const model = new ChatOpenAI({
    modelName: fallbackModelName,
    apiKey,
    configuration: {
      baseURL: AI_ENDPOINTS.OPENROUTER_BASE_URL,
    },
    temperature: AI_DEFAULTS.VISION_TEMPERATURE,
  });

  const messages = [];

  // Include personality's system prompt (jailbreak applies here too)
  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }

  // Use direct URL (attachment is already downloaded and resized by api-gateway)
  logger.info(
    { url: attachment.url, fallbackModelName },
    'Using direct attachment URL for fallback vision model'
  );

  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: {
            url: attachment.url,
          },
        },
        {
          type: 'text',
          text: 'Provide a detailed, objective description of this image for archival purposes. Focus on visual details without making value judgments. Describe what you see clearly and thoroughly.',
        },
      ],
    })
  );

  try {
    logger.info({ model: fallbackModelName }, 'Invoking fallback vision model with 90s timeout');
    // Timeout must be passed to invoke(), not constructor (LangChain requirement)
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    const context: Record<string, unknown> = {
      modelName: fallbackModelName,
      apiKeyPrefix: config.OPENROUTER_API_KEY?.substring(0, 15) + '...',
    };

    // Extract API response details if available
    if (error !== null && typeof error === 'object') {
      const errorObj = error as Record<string, unknown>;
      if ('response' in errorObj) {
        context.apiResponse = errorObj.response;
      }
      if ('status' in errorObj) {
        context.statusCode = errorObj.status;
      }
      if ('statusText' in errorObj) {
        context.statusText = errorObj.statusText;
      }
    }

    logErrorWithDetails(logger, 'Fallback vision model invocation failed', error, context);
    throw error; // Re-throw to allow retry logic to handle
  }
}
