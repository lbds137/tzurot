/**
 * Multimodal Content Formatter
 *
 * Provider-specific formatting for multimodal content (images, audio, etc)
 * Abstracts the differences between LLM providers:
 * - Gemini/LangChain: base64 inline data with media type
 * - OpenAI: image_url format (native vision support)
 * - OpenRouter: varies by underlying model
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('MultimodalFormatter');

export interface AttachmentMetadata {
  url: string;
  contentType: string;
  name?: string;
  size?: number;
  isVoiceMessage?: boolean;
  duration?: number;
  waveform?: string;
}

/**
 * LangChain multimodal content format (for Gemini, some OpenRouter models)
 */
export interface LangChainMediaContent {
  type: 'media';
  data: string; // base64 encoded
  mime_type: string;
}

/**
 * Fetch attachment data and convert to base64
 */
async function fetchAttachmentAsBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch attachment: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  } catch (error) {
    logger.error({ err: error, url }, 'Failed to fetch attachment');
    throw error;
  }
}

/**
 * Determine if content type is supported for multimodal
 */
function isSupportedMediaType(contentType: string): boolean {
  const supportedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/webm',
  ];

  return supportedTypes.some(type => contentType.toLowerCase().includes(type));
}

/**
 * Format attachments for Gemini/LangChain (base64 inline data)
 */
export async function formatForGemini(
  attachments: AttachmentMetadata[]
): Promise<LangChainMediaContent[]> {
  const mediaContent: LangChainMediaContent[] = [];

  for (const attachment of attachments) {
    if (!isSupportedMediaType(attachment.contentType)) {
      logger.warn(
        { contentType: attachment.contentType, name: attachment.name },
        'Skipping unsupported media type'
      );
      continue;
    }

    try {
      const base64Data = await fetchAttachmentAsBase64(attachment.url);

      mediaContent.push({
        type: 'media',
        data: base64Data,
        mime_type: attachment.contentType,
      });

      logger.info(
        {
          name: attachment.name,
          type: attachment.contentType,
          isVoiceMessage: attachment.isVoiceMessage,
        },
        'Formatted attachment for Gemini'
      );
    } catch (error) {
      logger.error(
        { err: error, attachment },
        'Failed to format attachment, skipping'
      );
      // Continue with other attachments even if one fails
    }
  }

  return mediaContent;
}

/**
 * Format attachments for OpenAI (image_url format)
 * OpenAI supports direct URLs for images, no base64 needed
 */
export function formatForOpenAI(
  attachments: AttachmentMetadata[]
): Array<{ type: 'image_url'; image_url: { url: string } }> {
  return attachments
    .filter(a => a.contentType.startsWith('image/'))
    .map(attachment => ({
      type: 'image_url' as const,
      image_url: {
        url: attachment.url,
      },
    }));
}

/**
 * Format attachments for OpenRouter
 * Falls back to Gemini format (most OpenRouter models support it)
 */
export async function formatForOpenRouter(
  attachments: AttachmentMetadata[]
): Promise<LangChainMediaContent[]> {
  // Most OpenRouter models support the same format as Gemini
  return formatForGemini(attachments);
}

/**
 * Main formatter - routes to appropriate provider
 */
export async function formatAttachments(
  attachments: AttachmentMetadata[] | undefined,
  provider: string
): Promise<LangChainMediaContent[] | Array<{ type: 'image_url'; image_url: { url: string } }> | null> {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  logger.info(
    { provider, count: attachments.length },
    'Formatting attachments for provider'
  );

  switch (provider.toLowerCase()) {
    case 'gemini':
      return formatForGemini(attachments);

    case 'openai':
      return formatForOpenAI(attachments);

    case 'openrouter':
      return formatForOpenRouter(attachments);

    default:
      logger.warn({ provider }, 'Unknown provider, using Gemini format as fallback');
      return formatForGemini(attachments);
  }
}
