/**
 * Multimodal Content Processor
 *
 * Processes images and audio to extract text descriptions/transcriptions.
 * This allows multimodal content to be:
 * 1. Stored as text in conversation history (for long-term context)
 * 2. Embedded and retrieved in RAG/LTM systems
 * 3. Used with personality's system prompt (including jailbreaks)
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLogger, getConfig, AI_DEFAULTS, TIMEOUTS } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import OpenAI from 'openai';

const logger = createLogger('MultimodalProcessor');
const config = getConfig();

export interface AttachmentMetadata {
  url: string;
  originalUrl?: string; // Discord CDN URL (preserved for caching lookups)
  contentType: string;
  name?: string;
  size?: number;
  isVoiceMessage?: boolean;
  duration?: number;
  waveform?: string;
}

export interface ProcessedAttachment {
  type: 'image' | 'audio';
  description: string; // Text description/transcription for history
  originalUrl: string; // For current turn (send raw media)
  metadata: AttachmentMetadata;
}

/**
 * Error details structure for logging API errors
 */
interface ErrorDetails {
  modelName?: string;
  errorType?: string;
  errorMessage: string;
  apiKeyPrefix?: string;
  apiResponse?: unknown;
  statusCode?: unknown;
  statusText?: unknown;
}

/**
 * Check if a model has vision support
 * Uses flexible pattern matching instead of hardcoded lists
 * to avoid outdated model names as vendors release new versions
 */
function hasVisionSupport(modelName: string): boolean {
  const normalized = modelName.toLowerCase();

  // OpenAI vision models (gpt-4o, gpt-4-turbo, gpt-4-vision, etc.)
  if (normalized.includes('gpt-4') && (
    normalized.includes('vision') ||
    normalized.includes('4o') ||
    normalized.includes('turbo')
  )) {
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
    if (normalized.includes('1.5') ||
        normalized.includes('2.') ||
        normalized.includes('vision')) {
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
  // Priority 1: Use personality's configured vision model if specified
  if (personality.visionModel) {
    logger.info(
      { visionModel: personality.visionModel },
      'Using configured vision model (personality override)'
    );
    return await describeWithVisionModel(attachment, personality, personality.visionModel);
  }

  // Priority 2: Use personality's main model if it has native vision support
  if (hasVisionSupport(personality.model)) {
    logger.info(
      { model: personality.model },
      'Using main LLM for vision (native vision support detected)'
    );
    return await describeWithVisionModel(attachment, personality, personality.model);
  }

  // Priority 3: Use default vision model (Qwen3-VL)
  logger.info(
    { mainModel: personality.model },
    'Using default vision model (Qwen3-VL) - main LLM lacks vision support'
  );
  return await describeWithFallbackVision(attachment, personality.systemPrompt || '');
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
    apiKey = config.OPENAI_API_KEY;
  } else if (modelName.includes('claude')) {
    apiKey = config.ANTHROPIC_API_KEY;
  } else {
    // Use OpenRouter for other models
    apiKey = config.OPENROUTER_API_KEY;
    baseURL = 'https://openrouter.ai/api/v1';
  }

  const model = new ChatOpenAI({
    modelName,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
    temperature: AI_DEFAULTS.VISION_TEMPERATURE,
  });

  const messages = [];

  // Include personality's system prompt (with jailbreak)
  if (personality.systemPrompt) {
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
    logger.info({ modelName }, 'Invoking vision model with 30s timeout');
    // Timeout must be passed to invoke(), not constructor (LangChain requirement)
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    // Extract detailed error information
    const errorDetails: ErrorDetails = {
      modelName,
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };

    // Try to extract API response details if available
    if (error && typeof error === 'object') {
      if ('response' in error) {
        errorDetails.apiResponse = error.response;
      }
      if ('status' in error) {
        errorDetails.statusCode = error.status;
      }
      if ('statusText' in error) {
        errorDetails.statusText = error.statusText;
      }
    }

    logger.error({
      err: error,
      ...errorDetails
    }, 'Vision model invocation failed');
    throw error;
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
      baseURL: 'https://openrouter.ai/api/v1',
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
    logger.info({ model: config.VISION_FALLBACK_MODEL }, 'Invoking fallback vision model with 30s timeout');
    // Timeout must be passed to invoke(), not constructor (LangChain requirement)
    const response = await model.invoke(messages, { timeout: TIMEOUTS.VISION_MODEL });
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    // Extract detailed error information
    const errorDetails: ErrorDetails = {
      modelName: config.VISION_FALLBACK_MODEL,
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      apiKeyPrefix: config.OPENROUTER_API_KEY?.substring(0, 15) + '...'
    };

    // Try to extract API response details if available
    if (error && typeof error === 'object') {
      if ('response' in error) {
        errorDetails.apiResponse = error.response;
      }
      if ('status' in error) {
        errorDetails.statusCode = error.status;
      }
      if ('statusText' in error) {
        errorDetails.statusText = error.statusText;
      }
    }

    logger.error({
      err: error,
      ...errorDetails
    }, 'Fallback vision model invocation failed');
    throw error;
  }
}

/**
 * Transcribe audio (voice message or audio file) using Whisper
 * Throws errors to allow retry logic to handle them
 */
export async function transcribeAudio(
  attachment: AttachmentMetadata,
  _personality: LoadedPersonality
): Promise<string> {
  // Check Redis cache first (if originalUrl is available)
  if (attachment.originalUrl) {
    try {
      const { getVoiceTranscript } = await import('../redis.js');
      const cachedTranscript = await getVoiceTranscript(attachment.originalUrl);

      if (cachedTranscript) {
        logger.info({
          originalUrl: attachment.originalUrl,
          transcriptLength: cachedTranscript.length
        }, 'Using cached voice transcript from Redis');
        return cachedTranscript;
      }
    } catch (error) {
      // Redis errors shouldn't break transcription - just log and continue
      logger.warn({ err: error }, 'Failed to check Redis cache, proceeding with transcription');
    }
  }

  logger.info({
    url: attachment.url,
    originalUrl: attachment.originalUrl,
    duration: attachment.duration,
    contentType: attachment.contentType
  }, 'Transcribing audio with Whisper (no cache)');

  // Initialize OpenAI client for Whisper
  const openai = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
  });

  // Fetch the audio file
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.statusText}`);
  }

  // Convert to buffer and create File object
  const audioBuffer = await response.arrayBuffer();
  const blob = new Blob([audioBuffer], { type: attachment.contentType });
  const audioFile = new File(
    [blob],
    attachment.name || 'audio.ogg',
    { type: attachment.contentType }
  );

  // Transcribe using Whisper
  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: config.WHISPER_MODEL,
    language: AI_DEFAULTS.WHISPER_LANGUAGE,
    response_format: 'text',
  });

  logger.info({
    duration: attachment.duration,
    transcriptionLength: transcription.length
  }, 'Audio transcribed successfully');

  return transcription;
}

/**
 * Process a single attachment (helper function for retry logic)
 */
async function processSingleAttachment(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality
): Promise<ProcessedAttachment | null> {
  if (attachment.contentType.startsWith('image/')) {
    const description = await describeImage(attachment, personality);
    logger.info({ name: attachment.name }, 'Processed image attachment');
    return {
      type: 'image' as const,
      description,
      originalUrl: attachment.url,
      metadata: attachment,
    };
  } else if (
    attachment.contentType.startsWith('audio/') ||
    attachment.isVoiceMessage
  ) {
    const description = await transcribeAudio(attachment, personality);
    logger.info({ name: attachment.name }, 'Processed audio attachment');
    return {
      type: 'audio' as const,
      description,
      originalUrl: attachment.url,
      metadata: attachment,
    };
  }
  // Unsupported type
  return null;
}

/**
 * Process all attachments to extract text descriptions
 * Processes attachments in parallel with up to 2 retries (3 total attempts)
 */
export async function processAttachments(
  attachments: AttachmentMetadata[],
  personality: LoadedPersonality
): Promise<ProcessedAttachment[]> {
  const MAX_ATTEMPTS = 3;
  logger.info(
    {
      attachmentCount: attachments.length,
      personalityModel: personality.model,
      maxAttempts: MAX_ATTEMPTS
    },
    '[MultimodalProcessor] Processing attachments in parallel'
  );

  const succeeded: ProcessedAttachment[] = [];
  let failedIndices = Array.from({ length: attachments.length }, (_, i) => i);

  // Retry loop: up to MAX_ATTEMPTS passes
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (failedIndices.length === 0) break;

    logger.info(
      {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        failedCount: failedIndices.length,
        succeededCount: succeeded.length
      },
      `[MultimodalProcessor] Pass ${attempt}: Processing ${failedIndices.length} attachment(s)`
    );

    // Process all failed attachments in parallel
    const promises = failedIndices.map((index) =>
      processSingleAttachment(attachments[index], personality)
    );

    const results = await Promise.allSettled(promises);

    // Separate successes from failures for next iteration
    const stillFailing: number[] = [];

    results.forEach((result, i) => {
      const originalIndex = failedIndices[i];
      const attachment = attachments[originalIndex];

      if (result.status === 'fulfilled' && result.value !== null) {
        succeeded.push(result.value);
        logger.info(
          {
            attachment: attachment.name,
            attempt
          },
          `[MultimodalProcessor] Pass ${attempt} succeeded`
        );
      } else {
        stillFailing.push(originalIndex);
        const error = result.status === 'rejected' ? result.reason : 'Unknown error';

        if (attempt < MAX_ATTEMPTS) {
          logger.warn(
            {
              err: error,
              attachment: attachment.name,
              attempt,
              willRetry: true
            },
            `[MultimodalProcessor] Pass ${attempt} failed, will retry`
          );
        } else {
          logger.error(
            {
              err: error,
              attachment: attachment.name,
              attempt
            },
            `[MultimodalProcessor] Pass ${attempt} failed, giving up after ${MAX_ATTEMPTS} attempts`
          );
        }
      }
    });

    failedIndices = stillFailing;
  }

  // Add fallback placeholders for attachments that failed all attempts
  for (const index of failedIndices) {
    const attachment = attachments[index];
    const fallbackDescription = attachment.contentType.startsWith('image/')
      ? `Image processing failed after ${MAX_ATTEMPTS} attempts`
      : `Audio transcription failed after ${MAX_ATTEMPTS} attempts`;

    succeeded.push({
      type: attachment.contentType.startsWith('image/') ? 'image' : 'audio',
      description: fallbackDescription,
      originalUrl: attachment.url,
      metadata: attachment,
    });

    logger.info(
      { attachment: attachment.name },
      '[MultimodalProcessor] Using fallback description after all retries failed'
    );
  }

  logger.info(
    {
      total: attachments.length,
      succeeded: succeeded.length,
      failed: failedIndices.length
    },
    '[MultimodalProcessor] Parallel processing complete'
  );

  return succeeded;
}
