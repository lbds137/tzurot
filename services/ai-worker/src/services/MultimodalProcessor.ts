/**
 * Multimodal Content Processor (Orchestrator)
 *
 * Coordinates processing of images and audio to extract text descriptions/transcriptions.
 * Delegates to specialized processors:
 * - VisionProcessor: Image descriptions using vision models
 * - AudioProcessor: Audio transcriptions using Whisper
 *
 * This allows multimodal content to be:
 * 1. Stored as text in conversation history (for long-term context)
 * 2. Embedded and retrieved in RAG/LTM systems
 * 3. Used with personality's system prompt (including jailbreaks)
 */

import {
  createLogger,
  AttachmentType,
  CONTENT_TYPES,
  RETRY_CONFIG,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { withParallelRetry } from '../utils/retry.js';
import { describeImage } from './multimodal/VisionProcessor.js';
import { transcribeAudio } from './multimodal/AudioProcessor.js';

const logger = createLogger('MultimodalProcessor');

// Re-export public functions for backwards compatibility
export { describeImage } from './multimodal/VisionProcessor.js';
export { transcribeAudio } from './multimodal/AudioProcessor.js';

export interface ProcessedAttachment {
  type: AttachmentType;
  description: string; // Text description/transcription for history
  originalUrl: string; // For current turn (send raw media)
  metadata: AttachmentMetadata;
}

/**
 * Process a single attachment (helper function for retry logic)
 *
 * @param attachment - Attachment metadata to process
 * @param personality - Personality configuration for vision/transcription
 * @param isGuestMode - Whether user is in guest mode (uses free models)
 * @param userApiKey - User's BYOK API key (for BYOK users)
 */
async function processSingleAttachment(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  isGuestMode: boolean,
  userApiKey?: string
): Promise<ProcessedAttachment | null> {
  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    const description = await describeImage(attachment, personality, isGuestMode, userApiKey);
    logger.info({ name: attachment.name }, 'Processed image attachment');
    return {
      type: AttachmentType.Image,
      description,
      originalUrl: attachment.url,
      metadata: attachment,
    };
  } else if (
    attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ||
    attachment.isVoiceMessage === true
  ) {
    const description = await transcribeAudio(attachment, personality);
    logger.info({ name: attachment.name }, 'Processed audio attachment');
    return {
      type: AttachmentType.Audio,
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
 * Uses retryService for consistent parallel retry behavior (RETRY_CONFIG.MAX_ATTEMPTS = 3)
 *
 * @param attachments - Attachments to process
 * @param personality - Personality configuration for vision/transcription
 * @param isGuestMode - Whether user is in guest mode (uses free models)
 * @param userApiKey - User's BYOK API key (for BYOK users)
 */
export async function processAttachments(
  attachments: AttachmentMetadata[],
  personality: LoadedPersonality,
  isGuestMode = false,
  userApiKey?: string
): Promise<ProcessedAttachment[]> {
  logger.info(
    {
      attachmentCount: attachments.length,
      personalityModel: personality.model,
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      isGuestMode,
      hasUserApiKey: userApiKey !== undefined,
    },
    '[MultimodalProcessor] Processing attachments in parallel'
  );

  // Use retryService for consistent retry behavior
  const results = await withParallelRetry(
    attachments,
    attachment => processSingleAttachment(attachment, personality, isGuestMode, userApiKey),
    {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: 'Attachment processing',
    }
  );

  // Separate successes from failures and add fallback descriptions for failures
  const processed: ProcessedAttachment[] = results.map((result, index) => {
    const attachment = attachments[index];

    if (result.status === 'success' && result.value) {
      return result.value;
    }

    // Failed after all retries - provide fallback description
    const isImage = attachment?.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX) ?? false;
    const fallbackDescription = isImage
      ? `Image processing failed after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts`
      : `Audio transcription failed after ${RETRY_CONFIG.MAX_ATTEMPTS} attempts`;

    logger.warn(
      {
        attachment: attachment?.name ?? 'unknown',
        attempts: result.attempts,
        error: result.error,
      },
      '[MultimodalProcessor] Using fallback description after all retries failed'
    );

    return {
      type: isImage ? AttachmentType.Image : AttachmentType.Audio,
      description: fallbackDescription,
      originalUrl: attachment?.url ?? '',
      metadata: attachment,
    };
  });

  const successCount = results.filter(r => r.status === 'success').length;
  logger.info(
    {
      total: attachments.length,
      succeeded: successCount,
      failed: attachments.length - successCount,
    },
    '[MultimodalProcessor] Parallel processing complete'
  );

  return processed;
}
