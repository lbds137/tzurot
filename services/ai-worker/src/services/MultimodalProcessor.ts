/**
 * Multimodal Content Processor (Orchestrator)
 *
 * Coordinates processing of images and audio to extract text descriptions/transcriptions.
 * Delegates to specialized processors:
 * - VisionProcessor: Image descriptions using vision models
 * - AudioProcessor: Audio transcriptions via ElevenLabs STT or voice-engine
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
  AIProvider,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { withParallelRetry } from '../utils/parallelRetry.js';
import { shouldRetryError, parseApiError } from '../utils/apiErrorParser.js';
import { describeImage, type VisionLoggingContext } from './multimodal/VisionProcessor.js';
import { transcribeAudio } from './multimodal/AudioProcessor.js';

const logger = createLogger('MultimodalProcessor');

// Re-export public functions for backwards compatibility
export { describeImage, deriveApiKeySource } from './multimodal/VisionProcessor.js';
export { transcribeAudio } from './multimodal/AudioProcessor.js';

export interface ProcessedAttachment {
  type: AttachmentType;
  description: string; // Text description/transcription for history
  originalUrl: string; // For current turn (send raw media)
  metadata: AttachmentMetadata;
}

/**
 * Auth + diagnostic options for vision/audio processing — bundled to keep param count
 * within max-params and mirror the per-call-site context plumbing.
 */
export interface ProcessAttachmentOptions {
  /** Whether user is in guest mode (uses free models) */
  isGuestMode: boolean;
  /**
   * User's BYOK API key, resolved for the **vision provider** (not the main-model
   * provider). Cross-provider personalities (e.g., main=z.ai-coding, vision=OpenRouter)
   * require the caller to re-resolve the key for the vision provider before invoking
   * `processAttachments` — passing the main-model key here will result in a 401 from
   * the vision provider's API.
   */
  userApiKey?: string;
  /** Optional ElevenLabs BYOK key for premium STT */
  elevenlabsApiKey?: string;
  /** Diagnostic context for vision-failure logging + source-aware fallback strings */
  loggingContext?: VisionLoggingContext;
  /**
   * Explicit provider for vision calls, derived from the personality's vision model
   * name by the caller (typically via `detectVisionProvider` in `ProviderRouter`).
   * Threaded down to `createChatModel` so cross-provider personalities route correctly.
   */
  visionProvider?: AIProvider;
}

/**
 * Process a single attachment (helper function for retry logic)
 */
async function processSingleAttachment(
  attachment: AttachmentMetadata,
  personality: LoadedPersonality,
  options: ProcessAttachmentOptions
): Promise<ProcessedAttachment | null> {
  const {
    isGuestMode,
    userApiKey,
    elevenlabsApiKey,
    loggingContext = {},
    visionProvider,
  } = options;
  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    const description = await describeImage(attachment, personality, isGuestMode, userApiKey, {
      skipNegativeCache: true,
      loggingContext,
      provider: visionProvider,
    });
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
    // In-band attachment STT preserves prior shape (ElevenLabs-or-voice-engine).
    // Full SttResolver wiring for this path is a future enhancement — the PR
    // 2 STT cutover only flows through the dedicated AudioTranscriptionJob.
    const description = await transcribeAudio(attachment, {
      provider: elevenlabsApiKey !== undefined ? 'elevenlabs' : 'voice-engine',
      apiKey: elevenlabsApiKey,
    });
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
 * Process all attachments to extract text descriptions.
 * Uses retryService for consistent parallel retry behavior (RETRY_CONFIG.MAX_ATTEMPTS = 3).
 */
export async function processAttachments(
  attachments: AttachmentMetadata[],
  personality: LoadedPersonality,
  options: ProcessAttachmentOptions
): Promise<ProcessedAttachment[]> {
  const {
    isGuestMode,
    userApiKey,
    elevenlabsApiKey,
    loggingContext = {},
    visionProvider,
  } = options;
  logger.info(
    {
      attachmentCount: attachments.length,
      personalityModel: personality.model,
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      isGuestMode,
      hasUserApiKey: userApiKey !== undefined,
      userId: loggingContext.userId,
      apiKeySource: loggingContext.apiKeySource,
      visionProvider,
    },
    'Processing attachments in parallel'
  );

  // Use retryService for consistent retry behavior
  const results = await withParallelRetry(
    attachments,
    attachment =>
      processSingleAttachment(attachment, personality, {
        isGuestMode,
        userApiKey,
        elevenlabsApiKey,
        loggingContext,
        visionProvider,
      }),
    {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: 'Attachment processing',
      shouldRetry: shouldRetryError,
    }
  );

  // Separate successes from failures and add fallback descriptions for failures
  const processed: ProcessedAttachment[] = results.map((result, index) => {
    const attachment = attachments[index];

    if (result.status === 'success' && result.value) {
      return result.value;
    }

    // Failed after all retries - provide fallback description with error category
    const isImage = attachment?.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX) ?? false;
    const errorCategory =
      result.error !== undefined ? parseApiError(result.error).category : 'unknown';
    const fallbackDescription = isImage
      ? `Image processing failed after ${result.attempts} attempts (${errorCategory})`
      : `Audio transcription failed after ${result.attempts} attempts (${errorCategory})`;

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
    'Parallel processing complete'
  );

  return processed;
}
