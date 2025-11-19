/**
 * Vision Processor
 *
 * Processes images to extract text descriptions using vision models.
 * Supports personality's configured vision model, main LLM with vision support,
 * or fallback to default vision model (Qwen3-VL).
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  createLogger,
  getConfig,
  AI_DEFAULTS,
  TIMEOUTS,
  AI_ENDPOINTS,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { logErrorWithDetails } from '../../utils/errorHandling.js';

const logger = createLogger('VisionProcessor');
const config = getConfig();

/**
 * Check if a model has vision support
 * Uses flexible pattern matching instead of hardcoded lists
 * to avoid outdated model names as vendors release new versions
 */
export function hasVisionSupport(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  // OpenAI vision models (gpt-4o, gpt-4-turbo, gpt-4-vision, etc.)
  if (
    normalized.includes('gpt-4') &&
    (normalized.includes('vision') || normalized.includes('4o') || normalized.includes('turbo'))
  ) {
    return true;
  }

  // Anthropic Claude 3+ models (all have vision)
  if (normalized.includes('claude-3') || normalized.includes('claude-4')) {
    return true;
  }

  // Google Gemini models (1.5+, 2.0+, 2.5+ all have vision)
  if (normalized.includes('gemini')) {
    // Match gemini-1.5+, gemini-2.0+, gemini-2.5+, etc.
    // Exclude old gemini-pro without vision
    if (normalized.includes('1.5') || normalized.includes('2.') || normalized.includes('vision')) {
      return true;
    }
  }

  // Add more providers as needed
  // Llama vision models
  if (normalized.includes('llama') && normalized.includes('vision')) {
    return true;
  }

  return false;
}

/**
 * Describe an image using vision model
 * Uses personality's model if it has vision, otherwise uses uncensored fallback
 * Throws errors to allow retry logic to handle them
 */
export async function describeImage(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality
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
    return describeWithVisionModel(attachment, personality, personality.visionModel);
  }

  // Priority 2: Use personality's main model if it has native vision support
  if (hasVisionSupport(personality.model)) {
    logger.info(
      { model: personality.model },
      'Using main LLM for vision (native vision support detected)'
    );
    return describeWithVisionModel(attachment, personality, personality.model);
  }

  // Priority 3: Use default vision model (Qwen3-VL)
  logger.info(
    { mainModel: personality.model },
    'Using default vision model (Qwen3-VL) - main LLM lacks vision support'
  );
  return describeWithFallbackVision(
    attachment,
    personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
      ? personality.systemPrompt
      : ''
  );
}

/**
 * Describe image using specified vision model (includes system prompt/jailbreak)
 */
async function describeWithVisionModel(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  modelName: string
): Promise<string> {
  // Determine API key and base URL based on model
  let apiKey: string | undefined;
  let baseURL: string | undefined;

  if (modelName.includes('gpt-') || modelName.includes('openai')) {
    // Use direct OpenAI API for OpenAI models
    apiKey = config.OPENAI_API_KEY;
  } else {
    // Use OpenRouter for all other models (including Claude, Gemini, Llama, etc.)
    apiKey = config.OPENROUTER_API_KEY;
    baseURL = AI_ENDPOINTS.OPENROUTER_BASE_URL;
  }

  const model = new ChatOpenAI({
    modelName,
    apiKey,
    configuration:
      baseURL !== undefined && baseURL.length > 0 ? { baseURL } : undefined,
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
 * Describe image using uncensored Qwen3-VL fallback model
 */
async function describeWithFallbackVision(
  attachment: AttachmentMetadata,
  systemPrompt: string
): Promise<string> {
  // Use Qwen3-VL-235B-A22B-Instruct - state-of-the-art, jailbreak-friendly
  const model = new ChatOpenAI({
    modelName: config.VISION_FALLBACK_MODEL,
    apiKey: config.OPENROUTER_API_KEY,
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
  logger.info({ url: attachment.url }, 'Using direct attachment URL for fallback vision model');

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
    logger.info(
      { model: config.VISION_FALLBACK_MODEL },
      'Invoking fallback vision model with 90s timeout'
    );
    // Timeout must be passed to invoke(), not constructor (LangChain requirement)
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    const context: Record<string, unknown> = {
      modelName: config.VISION_FALLBACK_MODEL,
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
