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
import { createLogger, getConfig, MEDIA_LIMITS, AI_DEFAULTS } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import sharp from 'sharp';
import OpenAI from 'openai';

const logger = createLogger('MultimodalProcessor');
const config = getConfig();

export interface AttachmentMetadata {
  url: string;
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
 */
export async function describeImage(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality
): Promise<string> {
  try {
    // Priority 1: Use personality's configured vision model if specified
    if (personality.visionModel) {
      logger.info({ visionModel: personality.visionModel }, 'Using personality vision model for image description');
      return await describeWithVisionModel(attachment, personality, personality.visionModel);
    }

    // Priority 2: Use personality's main model if it has native vision support
    if (hasVisionSupport(personality.model)) {
      logger.info({ model: personality.model }, 'Using personality main model for image description');
      return await describeWithVisionModel(attachment, personality, personality.model);
    }

    // Priority 3: Fallback to uncensored Qwen3-VL
    logger.info('Using fallback Qwen3-VL for image description');
    return await describeWithFallbackVision(attachment, personality.systemPrompt || '');
  } catch (error) {
    logger.error({ err: error, attachment }, 'Failed to describe image');
    // Fallback to basic description
    return `[Image: ${attachment.name || 'attachment'}]`;
  }
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
    baseURL = config.OPENROUTER_BASE_URL;
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

  // Fetch image and convert to base64 (more reliable than external URLs)
  logger.info({ size: attachment.size, url: attachment.url, modelName }, 'Fetching image for vision processing');
  const base64Image = await fetchAsBase64(attachment.url);
  logger.info({ originalSize: attachment.size, base64Size: base64Image.length, modelName }, 'Image converted to base64');

  // Request detailed, objective description
  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${attachment.contentType};base64,${base64Image}`,
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
    logger.info({ modelName }, 'Invoking vision model');
    const response = await model.invoke(messages);
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    // Extract detailed error information
    const errorDetails: any = {
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
      baseURL: config.OPENROUTER_BASE_URL,
    },
    temperature: AI_DEFAULTS.VISION_TEMPERATURE,
  });

  const messages = [];

  // Include personality's system prompt (jailbreak applies here too)
  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }

  // Fetch image and convert to base64 (OpenRouter requires base64)
  logger.info({ size: attachment.size, url: attachment.url }, 'Fetching image for vision processing');
  const base64Image = await fetchAsBase64(attachment.url);
  const base64Size = base64Image.length;
  logger.info({ originalSize: attachment.size, base64Size }, 'Image converted to base64');

  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${attachment.contentType};base64,${base64Image}`,
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
    logger.info({ model: config.VISION_FALLBACK_MODEL }, 'Invoking fallback vision model');
    const response = await model.invoke(messages);
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  } catch (error) {
    // Extract detailed error information
    const errorDetails: any = {
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
 */
export async function transcribeAudio(
  attachment: AttachmentMetadata,
  _personality: LoadedPersonality
): Promise<string> {
  try {
    logger.info({
      url: attachment.url,
      duration: attachment.duration,
      contentType: attachment.contentType
    }, 'Transcribing audio with Whisper');

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
  } catch (error) {
    logger.error({
      err: error,
      url: attachment.url,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    }, 'Failed to transcribe audio');

    // Fallback to basic description
    return `[Voice message: ${attachment.duration || 0}s]`;
  }
}

/**
 * Fetch URL content as base64
 * Resizes images larger than 10MB to fit within API limits
 */
async function fetchAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const originalSize = arrayBuffer.byteLength;

  // If image is larger than configured max size, resize it
  // Base64 encoding adds ~33% overhead, so 10MB → ~13.3MB base64
  // Most vision APIs have limits around 20MB, but we'll be conservative
  let imageBuffer = Buffer.from(arrayBuffer);

  if (originalSize > MEDIA_LIMITS.MAX_IMAGE_SIZE) {
    logger.info({
      originalSize,
      maxSize: MEDIA_LIMITS.MAX_IMAGE_SIZE,
      sizeMB: (originalSize / 1024 / 1024).toFixed(2)
    }, 'Image exceeds size limit, resizing...');

    // Resize image while maintaining aspect ratio
    // Target size leaves headroom for base64 encoding
    const scaleFactor = Math.sqrt(MEDIA_LIMITS.IMAGE_TARGET_SIZE / originalSize);

    const metadata = await sharp(imageBuffer).metadata();
    const newWidth = Math.floor((metadata.width || 2048) * scaleFactor);

    const resized = await sharp(imageBuffer)
      .resize(newWidth, null, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: MEDIA_LIMITS.IMAGE_QUALITY })
      .toBuffer();

    imageBuffer = Buffer.from(resized);

    logger.info({
      originalSize,
      resizedSize: imageBuffer.length,
      reduction: ((1 - imageBuffer.length / originalSize) * 100).toFixed(1) + '%',
      newWidth
    }, 'Image resized successfully');
  }

  const base64 = imageBuffer.toString('base64');
  logger.info({
    originalSize,
    finalSize: imageBuffer.length,
    base64Size: base64.length,
    compressionRatio: (base64.length / originalSize).toFixed(2)
  }, 'Image converted to base64');

  return base64;
}

/**
 * Process all attachments to extract text descriptions
 */
export async function processAttachments(
  attachments: AttachmentMetadata[],
  personality: LoadedPersonality
): Promise<ProcessedAttachment[]> {
  logger.info({ attachmentCount: attachments.length, personalityModel: personality.model }, '[MultimodalProcessor] Processing attachments');

  const processed: ProcessedAttachment[] = [];

  for (const attachment of attachments) {
    try {
      if (attachment.contentType.startsWith('image/')) {
        const description = await describeImage(attachment, personality);
        processed.push({
          type: 'image',
          description,
          originalUrl: attachment.url,
          metadata: attachment,
        });
        logger.info({ name: attachment.name }, 'Processed image attachment');
      } else if (
        attachment.contentType.startsWith('audio/') ||
        attachment.isVoiceMessage
      ) {
        const description = await transcribeAudio(attachment, personality);
        processed.push({
          type: 'audio',
          description,
          originalUrl: attachment.url,
          metadata: attachment,
        });
        logger.info({ name: attachment.name }, 'Processed audio attachment');
      }
    } catch (error) {
      logger.error({ err: error, attachment }, 'Failed to process attachment');
      // Continue with other attachments
    }
  }

  return processed;
}
