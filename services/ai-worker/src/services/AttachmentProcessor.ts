/**
 * Attachment Processor
 *
 * Processes reference message attachments (images, voice messages, files)
 * with parallel processing and graceful error handling.
 * Extracted from ReferencedMessageFormatter for maintainability.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { describeImage, transcribeAudio, type ProcessedAttachment } from './MultimodalProcessor.js';
import type { VisionLoggingContext } from './multimodal/VisionProcessor.js';
import { classifyAttachment, type RenderableAttachment } from './prompt/QuoteFormatter.js';
import { withRetry } from '../utils/retry.js';

const logger = createLogger('AttachmentProcessor');

/**
 * Processed attachment result for a single attachment
 */
interface ProcessedAttachmentResult {
  /** The attachment in renderable form — structured, never a pre-rendered line. */
  attachment: RenderableAttachment;
}

/**
 * Options for processing a single attachment
 */
interface ProcessSingleAttachmentOptions {
  /** Attachment to process */
  attachment: NonNullable<ReferencedMessage['attachments']>[0];
  /** Reference number for logging */
  referenceNumber: number;
  /** Personality configuration */
  personality: LoadedPersonality;
  /** Whether the user is in guest mode (no BYOK API key) */
  isGuestMode: boolean;
  /** Pre-processed attachments for this reference (optional) */
  preprocessedAttachments?: ProcessedAttachment[];
  /** User's BYOK API key (resolved for the **vision provider**) */
  userApiKey?: string;
  /** Resolved STT dispatch (provider + matching BYOK key when applicable). */
  sttDispatch?: SttDispatch;
  /** Diagnostic context for vision-failure logging (see VisionLoggingContext in VisionProcessor.ts) */
  loggingContext?: VisionLoggingContext;
  /** Explicit provider for vision calls (from `detectVisionProvider` on the personality's vision model) */
  visionProvider?: AIProvider;
  /** Pre-resolved vision model (from `resolveVisionConfig`); honored over `selectVisionModel`. */
  model?: string;
}

/**
 * Options for processing an image attachment (internal)
 */
interface ProcessImageOptions {
  attachment: ProcessSingleAttachmentOptions['attachment'];
  referenceNumber: number;
  personality: LoadedPersonality;
  isGuestMode: boolean;
  preprocessed?: ProcessedAttachment;
  /** User's BYOK API key (resolved for the **vision provider**) */
  userApiKey?: string;
  /** Diagnostic context for vision-failure logging */
  loggingContext?: VisionLoggingContext;
  /** Explicit provider for vision calls */
  visionProvider?: AIProvider;
  /** Pre-resolved vision model (from `resolveVisionConfig`); honored over `selectVisionModel`. */
  model?: string;
}

/**
 * Options for processing all attachments in parallel
 */
export interface ProcessAttachmentsOptions {
  attachments: ReferencedMessage['attachments'];
  referenceNumber: number;
  personality: LoadedPersonality;
  isGuestMode: boolean;
  preprocessedAttachments?: ProcessedAttachment[];
  /** User's BYOK API key (resolved for the **vision provider**) */
  userApiKey?: string;
  /** Resolved STT dispatch (provider + matching BYOK key when applicable). */
  sttDispatch?: SttDispatch;
  /** Diagnostic context for vision-failure logging */
  loggingContext?: VisionLoggingContext;
  /** Explicit provider for vision calls (from `detectVisionProvider` on the personality's vision model) */
  visionProvider?: AIProvider;
  /** Pre-resolved vision model (from `resolveVisionConfig`); honored over `selectVisionModel`. */
  model?: string;
}

/**
 * Process all attachments in parallel.
 *
 * Uses Promise.allSettled to process images and voice messages concurrently,
 * significantly reducing latency when multiple attachments are present.
 * If preprocessed attachments are provided, uses them instead of making API calls.
 */
export async function processAttachmentsParallel(
  options: ProcessAttachmentsOptions
): Promise<RenderableAttachment[]> {
  const {
    attachments,
    referenceNumber,
    personality,
    isGuestMode,
    preprocessedAttachments,
    userApiKey,
    sttDispatch,
    loggingContext,
    visionProvider,
    model,
  } = options;
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const processingPromises = attachments.map(attachment =>
    processSingleAttachment({
      attachment,
      referenceNumber,
      personality,
      isGuestMode,
      preprocessedAttachments,
      userApiKey,
      sttDispatch,
      loggingContext,
      visionProvider,
      model,
    })
  );

  const results = await Promise.allSettled(processingPromises);

  const rendered: RenderableAttachment[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      rendered.push(result.value.attachment);
    } else {
      logger.error(
        { err: result.reason, index: i, referenceNumber },
        'Unexpected error in attachment processing'
      );
      const attachment = attachments[i];
      if (attachment !== undefined) {
        rendered.push(unprocessedAttachment(attachment));
      }
    }
  }

  return rendered;
}

/**
 * Render an attachment whose processing threw before it could classify its own
 * failure. Keeps the modality and identity — degrading everything to a nameless
 * `<file/>` would make a blown-up image indistinguishable from an ordinary
 * document, and losing the element entirely is the drop class this shape closes.
 */
function unprocessedAttachment(
  attachment: ProcessSingleAttachmentOptions['attachment']
): RenderableAttachment {
  const identity = {
    filename: attachment.name,
    contentType: attachment.contentType,
    status: 'unprocessed',
  } as const;

  switch (classifyAttachment(attachment)) {
    case 'voice':
      // Duration survives the failure. It comes from Discord's own metadata, not
      // from the transcription that just blew up, so there is no reason to lose
      // it — and "a 4-second clip we could not process" is more useful to the
      // model than "some voice message we could not process".
      return { kind: 'voice', ...identity, durationSeconds: attachment.duration };
    case 'image':
      return { kind: 'image', ...identity };
    case 'file':
      return { kind: 'file', ...identity };
  }
}

/** Find preprocessed result for an attachment by URL */
function findPreprocessedByUrl(
  url: string,
  preprocessedAttachments?: ProcessedAttachment[]
): ProcessedAttachment | undefined {
  if (!preprocessedAttachments || preprocessedAttachments.length === 0) {
    return undefined;
  }
  return preprocessedAttachments.find(p => p.originalUrl === url);
}

/** Process voice message attachment */
async function processVoiceAttachment(
  attachment: ProcessSingleAttachmentOptions['attachment'],
  referenceNumber: number,
  preprocessed?: ProcessedAttachment,
  sttDispatch?: SttDispatch
): Promise<ProcessedAttachmentResult> {
  // Identity only — NOT a whole RenderableVoice. `kind` and the enrichment are
  // supplied per return site, because the type makes description and status
  // mutually exclusive and a pre-built object cannot commit to either arm.
  const identity = {
    kind: 'voice',
    filename: attachment.name,
    contentType: attachment.contentType,
    durationSeconds: attachment.duration,
  } as const;

  if (preprocessed?.description !== undefined && preprocessed.description !== '') {
    logger.debug(
      { referenceNumber, url: attachment.url },
      'Using preprocessed voice transcription'
    );
    return { attachment: { ...identity, description: preprocessed.description } };
  }

  try {
    logger.info(
      {
        referenceNumber,
        url: attachment.url,
        duration: attachment.duration,
        sttProvider: sttDispatch?.provider ?? 'voice-engine',
      },
      'Transcribing voice message'
    );
    const result = await withRetry(
      () => transcribeAudio(attachment, sttDispatch ?? { provider: 'voice-engine' }),
      {
        maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
        logger,
        operationName: `Voice transcription (reference ${referenceNumber})`,
      }
    );
    return { attachment: { ...identity, description: result.value.text } };
  } catch (error) {
    logger.error(
      { err: error, referenceNumber, url: attachment.url },
      'Voice transcription failed'
    );
    return { attachment: { ...identity, status: 'untranscribed' } };
  }
}

/** Process image attachment */
async function processImageAttachment(
  options: ProcessImageOptions
): Promise<ProcessedAttachmentResult> {
  const {
    attachment,
    referenceNumber,
    personality,
    isGuestMode,
    preprocessed,
    userApiKey,
    loggingContext = {},
    visionProvider,
    model,
  } = options;
  // Identity only — see the note in processVoiceAttachment.
  const identity = {
    kind: 'image',
    filename: attachment.name,
    contentType: attachment.contentType,
  } as const;

  if (preprocessed?.description !== undefined && preprocessed.description !== '') {
    logger.debug({ referenceNumber, url: attachment.url }, 'Using preprocessed image description');
    return { attachment: { ...identity, description: preprocessed.description } };
  }

  try {
    logger.info(
      {
        referenceNumber,
        url: attachment.url,
        name: attachment.name,
        hasUserApiKey: userApiKey !== undefined,
      },
      'Processing image (inline fallback)'
    );
    const result = await withRetry(
      () =>
        describeImage(attachment, personality, isGuestMode, userApiKey, {
          skipNegativeCache: true,
          loggingContext,
          provider: visionProvider,
          model,
        }),
      {
        maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
        logger,
        operationName: `Image description (reference ${referenceNumber})`,
      }
    );
    return { attachment: { ...identity, description: result.value } };
  } catch (error) {
    logger.error({ err: error, referenceNumber, url: attachment.url }, 'Image processing failed');
    return { attachment: { ...identity, status: 'undescribed' } };
  }
}

/**
 * Process a single attachment (image or voice message).
 * Handles vision model or transcription processing with graceful error handling.
 */
async function processSingleAttachment(
  options: ProcessSingleAttachmentOptions
): Promise<ProcessedAttachmentResult> {
  const {
    attachment,
    referenceNumber,
    personality,
    isGuestMode,
    preprocessedAttachments,
    userApiKey,
    sttDispatch,
    loggingContext,
    visionProvider,
    model,
  } = options;
  const preprocessed = findPreprocessedByUrl(attachment.url, preprocessedAttachments);

  switch (classifyAttachment(attachment)) {
    case 'voice':
      return processVoiceAttachment(attachment, referenceNumber, preprocessed, sttDispatch);
    case 'image':
      return processImageAttachment({
        attachment,
        referenceNumber,
        personality,
        isGuestMode,
        preprocessed,
        userApiKey,
        loggingContext,
        visionProvider,
        model,
      });
    case 'file':
      return {
        attachment: {
          kind: 'file',
          filename: attachment.name,
          contentType: attachment.contentType,
        },
      };
  }
}
