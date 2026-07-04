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

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { AttachmentType, CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { withParallelRetry } from '../utils/parallelRetry.js';
import { shouldRetryError, parseApiError } from '../utils/apiErrorParser.js';
import { describeImage, type VisionLoggingContext } from './multimodal/VisionProcessor.js';
import { describeImageWithFallback } from './multimodal/describeImageWithFallback.js';
import type { ResolveVisionConfigOptions } from './multimodal/visionAuthResolver.js';
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
  /**
   * Resolved STT dispatch (provider + matching BYOK key when applicable).
   * Computed once at the pipeline-step level via SttResolver so per-user
   * preferences are honored on in-band attachment transcription, not just
   * on the dedicated AudioTranscriptionJob path.
   */
  sttDispatch?: SttDispatch;
  /** Diagnostic context for vision-failure logging + source-aware fallback strings */
  loggingContext?: VisionLoggingContext;
  /**
   * Explicit provider for vision calls, derived from the personality's vision model
   * name by the caller (typically via `detectVisionProvider` in `ProviderRouter`).
   * Threaded down to `createChatModel` so cross-provider personalities route correctly.
   */
  visionProvider?: AIProvider;
  /**
   * Pre-resolved vision model name from `resolveVisionConfig`. Forwarded to
   * `describeImage` so the unified resolver's chosen model (which may be a
   * forced free-tier downgrade for a downgraded authenticated user) flows
   * through instead of being re-selected by `selectVisionModel`. Optional; when
   * omitted, `describeImage` self-selects (legacy behavior).
   */
  model?: string;
  /**
   * Phase-4 vision fallback: the auth INPUTS (not a pre-resolved config). When present,
   * image attachments route through `describeImageWithFallback`, which resolves auth
   * per fallback tier and retries down the chain on a retryable failure. When absent
   * (legacy / no-`apiKeyResolver` paths), images use the single-model `describeImage`
   * with the pre-resolved `model`/`visionProvider`/`userApiKey` fields above.
   */
  visionAuth?: ResolveVisionConfigOptions;
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
    sttDispatch,
    loggingContext = {},
    visionProvider,
    model,
    visionAuth,
  } = options;
  if (attachment.contentType.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    // Phase-4 path: when the caller supplied auth inputs, retry down the fallback chain
    // (the wrapper resolves per-tier auth + never throws). Otherwise fall back to the
    // single-model describeImage with the pre-resolved config (legacy / no-resolver path).
    const description =
      visionAuth !== undefined
        ? await describeImageWithFallback(attachment, personality, visionAuth, {
            loggingContext,
          })
        : await describeImage(attachment, personality, isGuestMode, userApiKey, {
            skipNegativeCache: true,
            loggingContext,
            provider: visionProvider,
            model,
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
    // In-band attachment STT honors the user's resolved STT preference (or
    // the voice-engine fallback when no caller computed one).
    const transcribed = await transcribeAudio(
      attachment,
      sttDispatch ?? { provider: 'voice-engine' }
    );
    logger.info(
      {
        name: attachment.name,
        requestedSttProvider: sttDispatch?.provider ?? 'voice-engine',
        actualSttProvider: transcribed.actualProvider,
      },
      'Processed audio attachment'
    );
    return {
      type: AttachmentType.Audio,
      description: transcribed.text,
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
    sttDispatch,
    loggingContext = {},
    visionProvider,
    model,
    visionAuth,
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
      visionModel: model,
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
        sttDispatch,
        loggingContext,
        visionProvider,
        model,
        visionAuth,
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
