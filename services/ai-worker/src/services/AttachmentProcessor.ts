/**
 * Attachment Processor
 *
 * Processes reference message attachments (images, voice messages, files)
 * with parallel processing and graceful error handling.
 * Extracted from ReferencedMessageFormatter for maintainability.
 */

import {
  createLogger,
  type ReferencedMessage,
  type LoadedPersonality,
  CONTENT_TYPES,
  RETRY_CONFIG,
} from '@tzurot/common-types';
import { describeImage, transcribeAudio, type ProcessedAttachment } from './MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';

const logger = createLogger('AttachmentProcessor');

/**
 * Processed attachment result for a single attachment
 */
interface ProcessedAttachmentResult {
  /** Index of the attachment in the original array */
  index: number;
  /** Formatted line for the prompt */
  line: string;
}

/**
 * Options for processing a single attachment
 */
interface ProcessSingleAttachmentOptions {
  /** Attachment to process */
  attachment: NonNullable<ReferencedMessage['attachments']>[0];
  /** Index in the attachments array */
  index: number;
  /** Reference number for logging */
  referenceNumber: number;
  /** Personality configuration */
  personality: LoadedPersonality;
  /** Whether the user is in guest mode (no BYOK API key) */
  isGuestMode: boolean;
  /** Pre-processed attachments for this reference (optional) */
  preprocessedAttachments?: ProcessedAttachment[];
  /** User's BYOK API key (for BYOK users) */
  userApiKey?: string;
}

/**
 * Options for processing an image attachment (internal)
 */
interface ProcessImageOptions {
  attachment: ProcessSingleAttachmentOptions['attachment'];
  index: number;
  referenceNumber: number;
  personality: LoadedPersonality;
  isGuestMode: boolean;
  preprocessed?: ProcessedAttachment;
  /** User's BYOK API key (for BYOK users) */
  userApiKey?: string;
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
  userApiKey?: string;
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
): Promise<string[]> {
  const {
    attachments,
    referenceNumber,
    personality,
    isGuestMode,
    preprocessedAttachments,
    userApiKey,
  } = options;
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const processingPromises = attachments.map((attachment, index) =>
    processSingleAttachment({
      attachment,
      index,
      referenceNumber,
      personality,
      isGuestMode,
      preprocessedAttachments,
      userApiKey,
    })
  );

  const results = await Promise.allSettled(processingPromises);

  const attachmentLines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      attachmentLines.push(result.value.line);
    } else {
      logger.error(
        { err: result.reason, index: i, referenceNumber },
        '[AttachmentProcessor] Unexpected error in attachment processing'
      );
      attachmentLines.push(`- Attachment [processing error]`);
    }
  }

  return attachmentLines;
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
  index: number,
  referenceNumber: number,
  personality: LoadedPersonality,
  preprocessed?: ProcessedAttachment
): Promise<ProcessedAttachmentResult> {
  if (preprocessed?.description !== undefined && preprocessed.description !== '') {
    logger.debug(
      { referenceNumber, url: attachment.url },
      '[AttachmentProcessor] Using preprocessed voice transcription'
    );
    return {
      index,
      line: `- Voice Message (${attachment.duration}s): "${preprocessed.description}"`,
    };
  }

  try {
    logger.info(
      { referenceNumber, url: attachment.url, duration: attachment.duration },
      '[AttachmentProcessor] Transcribing voice message'
    );
    const result = await withRetry(() => transcribeAudio(attachment, personality), {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: `Voice transcription (reference ${referenceNumber})`,
    });
    return { index, line: `- Voice Message (${attachment.duration}s): "${result.value}"` };
  } catch (error) {
    logger.error(
      { err: error, referenceNumber, url: attachment.url },
      '[AttachmentProcessor] Voice transcription failed'
    );
    return { index, line: `- Voice Message (${attachment.duration}s) [transcription failed]` };
  }
}

/** Process image attachment */
async function processImageAttachment(
  options: ProcessImageOptions
): Promise<ProcessedAttachmentResult> {
  const { attachment, index, referenceNumber, personality, isGuestMode, preprocessed, userApiKey } =
    options;
  if (preprocessed?.description !== undefined && preprocessed.description !== '') {
    logger.debug(
      { referenceNumber, url: attachment.url },
      '[AttachmentProcessor] Using preprocessed image description'
    );
    return { index, line: `- Image (${attachment.name}): ${preprocessed.description}` };
  }

  try {
    logger.info(
      {
        referenceNumber,
        url: attachment.url,
        name: attachment.name,
        hasUserApiKey: userApiKey !== undefined,
      },
      '[AttachmentProcessor] Processing image (inline fallback)'
    );
    const result = await withRetry(
      () =>
        describeImage(attachment, personality, isGuestMode, userApiKey, {
          skipNegativeCache: true,
        }),
      {
        maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
        logger,
        operationName: `Image description (reference ${referenceNumber})`,
      }
    );
    return { index, line: `- Image (${attachment.name}): ${result.value}` };
  } catch (error) {
    logger.error(
      { err: error, referenceNumber, url: attachment.url },
      '[AttachmentProcessor] Image processing failed'
    );
    return { index, line: `- Image (${attachment.name}) [vision processing failed]` };
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
    index,
    referenceNumber,
    personality,
    isGuestMode,
    preprocessedAttachments,
    userApiKey,
  } = options;
  const preprocessed = findPreprocessedByUrl(attachment.url, preprocessedAttachments);

  if (attachment.isVoiceMessage === true) {
    return processVoiceAttachment(attachment, index, referenceNumber, personality, preprocessed);
  }

  if (attachment.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
    return processImageAttachment({
      attachment,
      index,
      referenceNumber,
      personality,
      isGuestMode,
      preprocessed,
      userApiKey,
    });
  }

  return { index, line: `- File: ${attachment.name} (${attachment.contentType})` };
}
