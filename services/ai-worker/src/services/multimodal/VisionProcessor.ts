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

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  createLogger,
  getConfig,
  AI_DEFAULTS,
  TIMEOUTS,
  MODEL_DEFAULTS,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { createChatModel } from '../ModelFactory.js';
import { parseApiError } from '../../utils/apiErrorParser.js';
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
 * Invoke a vision model with the given attachment and optional system prompt.
 * Uses ModelFactory's createChatModel for consistent API key routing,
 * parameter filtering, and OpenRouter integration.
 *
 * @param attachment - Image attachment to describe
 * @param modelName - Model identifier (e.g., "gpt-4o", "qwen/qwen3-vl")
 * @param systemPrompt - Optional system prompt (personality's system prompt with jailbreak)
 * @param userApiKey - Optional user's BYOK API key
 */
async function invokeVisionModel(
  attachment: AttachmentMetadata,
  modelName: string,
  systemPrompt: string | undefined,
  userApiKey?: string
): Promise<string> {
  const { model } = createChatModel({
    modelName,
    apiKey: userApiKey,
    temperature: AI_DEFAULTS.VISION_TEMPERATURE,
  });

  const messages = [];

  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    messages.push(new SystemMessage(systemPrompt));
  }

  logger.info({ url: attachment.url, modelName }, 'Invoking vision model');

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
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    const errorInfo = parseApiError(error);
    logger.error(
      {
        modelName,
        errorCategory: errorInfo.category,
        errorType: errorInfo.type,
        statusCode: errorInfo.statusCode,
        shouldRetry: errorInfo.shouldRetry,
      },
      'Vision model invocation failed'
    );

    // Store failure in negative cache to prevent re-hammering
    await visionDescriptionCache.storeFailure({
      attachmentId: attachment.id,
      url: attachment.url,
      category: errorInfo.category,
      permanent: !errorInfo.shouldRetry,
    });

    throw error;
  }
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
  const cacheKeyOptions = { attachmentId: attachment.id, url: attachment.url };
  const cachedDescription = await visionDescriptionCache.get(cacheKeyOptions);
  if (cachedDescription !== null) {
    logger.info(
      { attachmentName: attachment.name, attachmentId: attachment.id },
      'Using cached vision description - avoiding duplicate API call'
    );
    return cachedDescription;
  }

  // Check negative cache to avoid re-hammering failed images
  const failureEntry = await visionDescriptionCache.getFailure(cacheKeyOptions);
  if (failureEntry !== null) {
    if (failureEntry.permanent) {
      logger.info(
        { attachmentId: attachment.id, category: failureEntry.category },
        'Skipping vision API call - permanent failure cached'
      );
      return `[Image unavailable: ${failureEntry.category}]`;
    }
    logger.info(
      { attachmentId: attachment.id, category: failureEntry.category },
      'Skipping vision API call - transient failure cooldown active'
    );
    return '[Image temporarily unavailable]';
  }

  let description: string;
  let usedModel: string;
  const systemPrompt =
    personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
      ? personality.systemPrompt
      : undefined;

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
    description = await invokeVisionModel(attachment, usedModel, systemPrompt, userApiKey);
  } else {
    // Priority 2: Use personality's main model if it has native vision support
    const mainModelHasVision = await hasVisionSupport(personality.model);
    if (mainModelHasVision) {
      logger.info(
        { model: personality.model },
        'Using main LLM for vision (native vision support detected)'
      );
      usedModel = personality.model;
      description = await invokeVisionModel(attachment, usedModel, systemPrompt, userApiKey);
    } else {
      // Priority 3: Use fallback vision model
      // Guest users (no BYOK API key) use Gemma 3 27b (free), BYOK users use Qwen3-VL (paid)
      usedModel = isGuestMode ? MODEL_DEFAULTS.VISION_FALLBACK_FREE : config.VISION_FALLBACK_MODEL;

      logger.info(
        { mainModel: personality.model, fallbackModel: usedModel, isGuestMode },
        'Using fallback vision model - main LLM lacks vision support'
      );
      description = await invokeVisionModel(attachment, usedModel, systemPrompt, userApiKey);
    }
  }

  // Cache the description for future use (both L1 Redis and L2 PostgreSQL)
  await visionDescriptionCache.store(
    { attachmentId: attachment.id, url: attachment.url, model: usedModel },
    description
  );

  return description;
}
