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
import { createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';

const logger = createLogger('MultimodalProcessor');

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
  const modelName = personality.model;

  if (!modelName) {
    throw new Error('Personality model is not configured');
  }

  try {
    if (hasVisionSupport(modelName)) {
      // Use personality's model with their system prompt
      logger.info({ model: modelName }, 'Using personality model for image description');
      return await describeWithPersonalityModel(attachment, personality);
    } else {
      // Use uncensored OpenRouter vision model
      logger.info({ model: modelName }, 'Using OpenRouter fallback for image description');
      return await describeWithOpenRouter(attachment, personality.systemPrompt || '');
    }
  } catch (error) {
    logger.error({ err: error, attachment }, 'Failed to describe image');
    // Fallback to basic description
    return `[Image: ${attachment.name || 'attachment'}]`;
  }
}

/**
 * Describe image using personality's own model (includes system prompt/jailbreak)
 */
async function describeWithPersonalityModel(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality
): Promise<string> {
  const modelName = personality.model;

  // Determine API key and base URL based on model
  let apiKey: string | undefined;
  let baseURL: string | undefined;

  if (modelName.includes('gpt-') || modelName.includes('openai')) {
    apiKey = process.env.OPENAI_API_KEY;
  } else if (modelName.includes('claude')) {
    apiKey = process.env.ANTHROPIC_API_KEY;
  } else {
    // Use OpenRouter for other models
    apiKey = process.env.OPENROUTER_API_KEY;
    baseURL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  }

  const model = new ChatOpenAI({
    modelName,
    apiKey,
    configuration: baseURL ? { baseURL } : undefined,
    temperature: 0.3, // Lower temperature for objective descriptions
  });

  const messages = [];

  // Include personality's system prompt (with jailbreak)
  if (personality.systemPrompt) {
    messages.push(new SystemMessage(personality.systemPrompt));
  }

  // Request detailed, objective description
  messages.push(
    new HumanMessage({
      content: [
        {
          type: 'image_url',
          image_url: { url: attachment.url },
        },
        {
          type: 'text',
          text: 'Provide a detailed, objective description of this image for archival purposes. Focus on visual details without making value judgments. Describe what you see clearly and thoroughly.',
        },
      ],
    })
  );

  const response = await model.invoke(messages);
  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
}

/**
 * Describe image using uncensored OpenRouter vision model
 */
async function describeWithOpenRouter(
  attachment: AttachmentMetadata,
  systemPrompt: string
): Promise<string> {
  // Use Llama 3.2 90B Vision - uncensored and powerful
  const model = new ChatOpenAI({
    modelName: 'meta-llama/llama-3.2-90b-vision-instruct',
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    },
    temperature: 0.3,
  });

  const messages = [];

  // Include personality's system prompt (jailbreak applies here too)
  if (systemPrompt) {
    messages.push(new SystemMessage(systemPrompt));
  }

  // Fetch image and convert to base64 (OpenRouter requires base64)
  const base64Image = await fetchAsBase64(attachment.url);

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

  const response = await model.invoke(messages);
  return typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);
}

/**
 * Transcribe audio (voice message or audio file)
 */
export async function transcribeAudio(
  attachment: AttachmentMetadata,
  _personality: LoadedPersonality
): Promise<string> {
  try {
    // Use Gemini for audio transcription (native support)
    // Or could use Whisper API - both work well
    logger.info({ attachment }, 'Transcribing audio');

    // For now, return placeholder - will implement Gemini/Whisper transcription
    return `[Voice message: ${attachment.duration || 0}s - transcription pending]`;
  } catch (error) {
    logger.error({ err: error, attachment }, 'Failed to transcribe audio');
    return `[Voice message: ${attachment.duration || 0}s]`;
  }
}

/**
 * Fetch URL content as base64
 */
async function fetchAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

/**
 * Process all attachments to extract text descriptions
 */
export async function processAttachments(
  attachments: AttachmentMetadata[],
  personality: LoadedPersonality
): Promise<ProcessedAttachment[]> {
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
