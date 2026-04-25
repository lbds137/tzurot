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
  ERROR_MESSAGES,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { createChatModel } from '../ModelFactory.js';
import { parseApiError } from '../../utils/apiErrorParser.js';
import { checkModelVisionSupport, visionDescriptionCache } from '../../redis.js';
import { isDataUrl } from '../../utils/attachmentFetch.js';

const logger = createLogger('VisionProcessor');
const config = getConfig();

/** User-friendly labels for error categories in fallback descriptions */
const FAILURE_LABELS: Record<string, string> = {
  authentication: 'API key issue',
  quota_exceeded: 'quota exceeded',
  content_policy: 'content filtered',
  bad_request: 'invalid request',
  model_not_found: 'model unavailable',
  media_not_found: 'image unavailable',
  rate_limit: 'rate limited',
  server_error: 'server error',
  timeout: 'timed out',
  network: 'network error',
  empty_response: 'empty response',
  censored: 'content filtered',
};

/** Minimum length for a vision description to be considered valid for caching */
const VISION_MIN_DESCRIPTION_LENGTH = 10;

/**
 * Patterns that indicate a vision model returned an error message as text content
 * rather than an actual image description. These bypass HTTP error handling and
 * would otherwise be cached as "valid" descriptions, blocking retries permanently.
 */
const ERROR_DESCRIPTION_PATTERNS = [
  'cannot access',
  'unable to access',
  'unable to view',
  'unable to process',
  'not accessible',
  'cannot be accessed',
  'cannot view',
  'cannot process',
  'cannot see the image',
  'cannot see this image',
  'failed to load',
  'error loading',
  'url has expired',
  'url is expired',
  'url is invalid',
  'image is not available',
  'image is unavailable',
  'image url',
  'provided url',
];

/** Check if a description looks like an error message from the vision model */
function isLikelyErrorDescription(description: string): boolean {
  const lower = description.toLowerCase();
  return ERROR_DESCRIPTION_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Validate that a vision description is a genuine image description, not an error message.
 * Used both when storing new descriptions and when reading cached ones.
 */
function isValidVisionDescription(description: string): boolean {
  const trimmed = description.trim();
  return (
    trimmed.length >= VISION_MIN_DESCRIPTION_LENGTH &&
    !trimmed.startsWith('[Image') &&
    !isLikelyErrorDescription(trimmed)
  );
}

/**
 * Options for describeImage behavior
 */
export interface DescribeImageOptions {
  /** Skip negative cache check — set to true when called within a retry loop */
  skipNegativeCache?: boolean;
  /** Skip positive cache check — set to true to force re-processing */
  skipCache?: boolean;
}

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

  // The URL flows through LangChain to the upstream LLM provider, which fetches
  // it on their server with their own SSRF defenses. We don't make the network
  // request here — only the provider does. Apply minimal well-formedness so a
  // literally-malformed URL fails fast in our stack instead of theirs; full
  // SSRF defense for URLs WE fetch lives in DownloadAttachmentsStep
  // (LLM-generation pipeline) and is bypassed here precisely because the
  // bytes never enter our process. Data URLs short-circuit unchanged.
  //
  // ImageDescriptionJob path: this function is also reached from the
  // preprocessing job, which receives raw user-controlled URLs from
  // jobChainOrchestrator.createImageDescriptionJob (api-gateway, line ~181)
  // WITHOUT prior DownloadAttachmentsStep validation. We deliberately accept
  // the residual side-channel risk (provider error responses could echo back
  // internal-IP probes if an attacker submitted such a URL) because (a) we
  // do not initiate the fetch — the provider does, on their hardened infra —
  // so there is no SSRF execution surface on our stack; and (b) the only
  // attacker-controlled URL injection vector is via Discord embed/attachment
  // shapes, which limits practical exploitation. Council-reviewed 2026-04-25.
  //
  // Behavior note: `new URL().toString()` is NOT equivalent to
  // `validateAttachmentUrl` minus the allowlist — that helper also stripped
  // DNS absolute-form trailing dots via `hostname.replace(/\.{1,16}$/, '')`.
  // `new URL()` preserves them. In practice neither LLM providers nor Discord
  // CDN ever emit trailing-dot hostnames, so the difference is academic, but
  // it's a real semantic divergence worth noting if either ever changes.
  const imageUrl = isDataUrl(attachment.url) ? attachment.url : new URL(attachment.url).toString();

  // Redact data URLs in logs: after DownloadAttachmentsStep runs, attachment.url
  // is a 1-2 MiB base64 string. Emitting that at info level saturates log
  // aggregators and buries other messages. Remote URLs are log-safe (short,
  // useful forensically).
  const logUrl = isDataUrl(attachment.url) ? '<data-url>' : imageUrl;

  logger.info({ url: logUrl, modelName }, 'Invoking vision model');

  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: {
            url: imageUrl,
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
    const content =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Guard: empty response (matches LLMInvoker pattern)
    if (content.trim().length === 0) {
      throw new Error(ERROR_MESSAGES.EMPTY_RESPONSE);
    }

    // Guard: censored response — Gemini "ext" bug (matches LLMInvoker pattern)
    if (content.trim() === ERROR_MESSAGES.CENSORED_RESPONSE_TEXT) {
      throw new Error(ERROR_MESSAGES.CENSORED_RESPONSE);
    }

    // Warn on suspiciously short descriptions (don't throw — some images may be simple)
    if (content.trim().length < VISION_MIN_DESCRIPTION_LENGTH) {
      logger.warn(
        { modelName, contentLength: content.trim().length, content: content.trim() },
        'Vision model returned suspiciously short description'
      );
    }

    return content;
  } catch (error) {
    const errorInfo = parseApiError(error);
    logger.error(
      {
        err: error,
        modelName,
        errorCategory: errorInfo.category,
        errorType: errorInfo.type,
        statusCode: errorInfo.statusCode,
        shouldRetry: errorInfo.shouldRetry,
        technicalMessage: errorInfo.technicalMessage,
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
 * Check negative cache for a previous failure.
 * Returns a fallback string if a failure is cached, or null to proceed with the API call.
 */
async function checkNegativeCache(
  cacheKeyOptions: { attachmentId?: string; url: string },
  attachmentId: string | undefined
): Promise<string | null> {
  const failureEntry = await visionDescriptionCache.getFailure(cacheKeyOptions);
  if (failureEntry === null) {
    return null;
  }
  if (failureEntry.permanent) {
    logger.info(
      { attachmentId, category: failureEntry.category },
      'Skipping vision API call - permanent failure cached'
    );
    const label = FAILURE_LABELS[failureEntry.category] ?? failureEntry.category;
    return `[Image unavailable: ${label}]`;
  }
  logger.info(
    { attachmentId, category: failureEntry.category },
    'Skipping vision API call - transient failure cooldown active'
  );
  return '[Image temporarily unavailable]';
}

/**
 * Select the vision model to use based on personality config and model capabilities.
 * Priority: personality.visionModel > main model with vision > fallback model.
 */
async function selectVisionModel(
  personality: LoadedPersonality,
  isGuestMode: boolean
): Promise<string> {
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
    return personality.visionModel;
  }

  // Priority 2: Use personality's main model if it has native vision support
  const mainModelHasVision = await hasVisionSupport(personality.model);
  if (mainModelHasVision) {
    logger.info(
      { model: personality.model, source: 'main-model-vision' },
      'Using main LLM for vision (native vision support detected via cache/pattern)'
    );
    return personality.model;
  }

  // Priority 3: Use fallback vision model
  // Guest users (no BYOK API key) use VISION_FALLBACK_FREE, BYOK users use VISION_FALLBACK (paid)
  const fallback = isGuestMode ? MODEL_DEFAULTS.VISION_FALLBACK_FREE : config.VISION_FALLBACK_MODEL;
  logger.info(
    { mainModel: personality.model, fallbackModel: fallback, isGuestMode, source: 'fallback' },
    'Using fallback vision model - main LLM lacks vision support'
  );
  return fallback;
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
  userApiKey?: string,
  options?: DescribeImageOptions
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
  if (options?.skipCache !== true) {
    const cachedDescription = await visionDescriptionCache.get(cacheKeyOptions);
    if (cachedDescription !== null) {
      // Validate cached description quality — some models cache error text
      // (e.g., "I cannot access the image URL") that looks valid but isn't useful.
      // Re-processing gives the vision model a chance to succeed with a fresh attempt.
      if (isValidVisionDescription(cachedDescription)) {
        logger.info(
          { attachmentName: attachment.name, attachmentId: attachment.id },
          'Using cached vision description - avoiding duplicate API call'
        );
        return cachedDescription;
      }
      logger.warn(
        {
          attachmentId: attachment.id,
          cachedLength: cachedDescription.length,
          preview: cachedDescription.substring(0, 80),
        },
        'Cached vision description appears invalid — re-processing image'
      );
    }
  }

  // Check negative cache to avoid re-hammering failed images
  // Skip when called within a retry loop — the negative cache would defeat retries
  if (options?.skipNegativeCache !== true) {
    const failureFallback = await checkNegativeCache(cacheKeyOptions, attachment.id);
    if (failureFallback !== null) {
      return failureFallback;
    }
  }

  const systemPrompt =
    personality.systemPrompt !== undefined && personality.systemPrompt.length > 0
      ? personality.systemPrompt
      : undefined;

  const usedModel = await selectVisionModel(personality, isGuestMode);
  const description = await invokeVisionModel(attachment, usedModel, systemPrompt, userApiKey);

  // Cache the description for future use (both L1 Redis and L2 PostgreSQL)
  // Uses shared validation to prevent error-like descriptions from polluting the cache
  if (isValidVisionDescription(description)) {
    await visionDescriptionCache.store(
      { attachmentId: attachment.id, url: attachment.url, model: usedModel },
      description
    );
  }

  return description;
}
