/**
 * Referenced Message Formatter
 *
 * Formats referenced messages (from replies or message links) for inclusion in AI prompts.
 * Wraps output in <contextual_references> XML tags for better LLM context separation.
 * Processes attachments (images, voice messages) in parallel for better performance.
 */

import {
  createLogger,
  type ReferencedMessage,
  type LoadedPersonality,
  CONTENT_TYPES,
  TEXT_LIMITS,
  RETRY_CONFIG,
  formatTimestampWithDelta,
  escapeXml,
  escapeXmlContent,
} from '@tzurot/common-types';
import { describeImage, transcribeAudio, type ProcessedAttachment } from './MultimodalProcessor.js';
import { withRetry } from '../utils/retry.js';

const logger = createLogger('ReferencedMessageFormatter');

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
 * Referenced Message Formatter
 *
 * Handles formatting of referenced messages with parallel attachment processing
 */
export class ReferencedMessageFormatter {
  /**
   * Extract plain text content from formatted referenced messages
   *
   * Strips markdown headers and metadata, keeping only the actual message content,
   * transcriptions, and image descriptions for semantic search.
   *
   * @param formattedReferences - Formatted reference string from formatReferencedMessages
   * @returns Plain text content suitable for LTM search query
   */
  extractTextForSearch(formattedReferences: string): string {
    const lines = formattedReferences.split('\n');
    const contentLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip XML tags, markdown headers, reference labels, metadata, and introductory text
      if (
        trimmed.startsWith('<contextual_references') ||
        trimmed.startsWith('</contextual_references') ||
        trimmed.startsWith('##') ||
        trimmed.startsWith('[Reference') ||
        trimmed.startsWith('From:') ||
        trimmed.startsWith('Location:') ||
        trimmed.startsWith('Time:') ||
        trimmed.startsWith('Message Text:') ||
        trimmed.startsWith('Message Embeds') ||
        trimmed.startsWith('Attachments:') ||
        trimmed === 'The user is referencing the following messages:' ||
        trimmed.length === 0
      ) {
        continue;
      }
      contentLines.push(trimmed);
    }

    return contentLines.join('\n');
  }

  /**
   * Format referenced messages for inclusion in prompt
   *
   * Processes all attachments (images, voice messages) in parallel for better performance.
   * If preprocessed attachments are provided, uses them instead of making inline API calls.
   *
   * @param references - Referenced messages to format
   * @param personality - Personality configuration for vision/transcription models
   * @param isGuestMode - Whether the user is in guest mode (no BYOK API key)
   * @param preprocessedAttachments - Pre-processed attachments keyed by reference number (avoids inline API calls)
   * @param userApiKey - User's BYOK API key (for BYOK users)
   * @returns Formatted string ready for prompt
   */
  async formatReferencedMessages(
    references: ReferencedMessage[],
    personality: LoadedPersonality,
    isGuestMode = false,
    preprocessedAttachments?: Record<number, ProcessedAttachment[]>,
    userApiKey?: string
  ): Promise<string> {
    const referenceElements: string[] = [];

    // Process each reference into XML
    for (const ref of references) {
      const refLines: string[] = [];

      // Build quote attributes
      const forwardedAttr = ref.isForwarded === true ? ' forwarded="true"' : '';
      refLines.push(`<quote number="${ref.referenceNumber}"${forwardedAttr}>`);

      // Author info
      if (ref.isForwarded === true) {
        refLines.push(`<author unavailable="true">Author unavailable - forwarded message</author>`);
      } else {
        refLines.push(
          `<author display_name="${escapeXml(ref.authorDisplayName)}" username="${escapeXml(ref.authorUsername)}"/>`
        );
      }

      // Location
      refLines.push(`<location>${escapeXmlContent(ref.locationContext)}</location>`);

      // Timestamp with both absolute date and relative time
      const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);
      if (absolute.length > 0 && relative.length > 0) {
        refLines.push(
          `<time absolute="${escapeXml(absolute)}" relative="${escapeXml(relative)}"/>`
        );
      } else {
        refLines.push(`<time>${escapeXmlContent(ref.timestamp)}</time>`);
      }

      // Message content
      if (ref.content) {
        refLines.push(`<content>${escapeXmlContent(ref.content)}</content>`);
      }

      // Embeds (structured data from Discord)
      if (ref.embeds) {
        refLines.push(`<embeds>${escapeXmlContent(ref.embeds)}</embeds>`);
      }

      // Process attachments in parallel (or use preprocessed data if available)
      if (ref.attachments && ref.attachments.length > 0) {
        const preprocessedForRef = preprocessedAttachments?.[ref.referenceNumber];

        const attachmentLines = await this.processAttachmentsParallel(
          ref.attachments,
          ref.referenceNumber,
          personality,
          isGuestMode,
          preprocessedForRef,
          userApiKey
        );

        if (attachmentLines.length > 0) {
          refLines.push('<attachments>');
          refLines.push(...attachmentLines);
          refLines.push('</attachments>');
        }
      }

      refLines.push('</quote>');
      referenceElements.push(refLines.join('\n'));
    }

    const formattedText = referenceElements.join('\n');

    logger.info(
      {
        count: references.length,
        preview:
          formattedText.length > 0
            ? formattedText.substring(0, TEXT_LIMITS.REFERENCE_PREVIEW) +
              (formattedText.length > TEXT_LIMITS.REFERENCE_PREVIEW ? '...' : '')
            : undefined,
        totalLength: formattedText.length,
      },
      '[ReferencedMessageFormatter] Formatted referenced messages for prompt'
    );

    // Wrap in outer XML tag
    return `<contextual_references>\n${formattedText}\n</contextual_references>`;
  }

  /**
   * Process all attachments in parallel
   *
   * Uses Promise.allSettled to process images and voice messages concurrently,
   * significantly reducing latency when multiple attachments are present.
   * If preprocessed attachments are provided, uses them instead of making API calls.
   *
   * @param attachments - Attachments to process
   * @param referenceNumber - Reference number for logging
   * @param personality - Personality configuration
   * @param isGuestMode - Whether the user is in guest mode (no BYOK API key)
   * @param preprocessedAttachments - Pre-processed attachments for this reference (optional)
   * @param userApiKey - User's BYOK API key (for BYOK users)
   * @returns Array of formatted attachment lines
   */
  private async processAttachmentsParallel(
    attachments: ReferencedMessage['attachments'],
    referenceNumber: number,
    personality: LoadedPersonality,
    isGuestMode: boolean,
    preprocessedAttachments?: ProcessedAttachment[],
    userApiKey?: string
  ): Promise<string[]> {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    // Create promises for all attachments that need processing
    const processingPromises = attachments.map((attachment, index) =>
      this.processSingleAttachment({
        attachment,
        index,
        referenceNumber,
        personality,
        isGuestMode,
        preprocessedAttachments,
        userApiKey,
      })
    );

    // Process all attachments in parallel
    const results = await Promise.allSettled(processingPromises);

    // Extract successful results and maintain order
    const attachmentLines: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        attachmentLines.push(result.value.line);
      } else {
        // This should never happen since we handle errors inside processSingleAttachment,
        // but handle it gracefully just in case
        logger.error(
          { err: result.reason, index: i, referenceNumber },
          '[ReferencedMessageFormatter] Unexpected error in attachment processing'
        );
        attachmentLines.push(`- Attachment [processing error]`);
      }
    }

    return attachmentLines;
  }

  /**
   * Find preprocessed result for an attachment by URL
   */
  private findPreprocessedByUrl(
    url: string,
    preprocessedAttachments?: ProcessedAttachment[]
  ): ProcessedAttachment | undefined {
    if (!preprocessedAttachments || preprocessedAttachments.length === 0) {
      return undefined;
    }
    return preprocessedAttachments.find(p => p.originalUrl === url);
  }

  /** Process voice message attachment */
  private async processVoiceAttachment(
    attachment: ProcessSingleAttachmentOptions['attachment'],
    index: number,
    referenceNumber: number,
    personality: LoadedPersonality,
    preprocessed?: ProcessedAttachment
  ): Promise<ProcessedAttachmentResult> {
    if (preprocessed?.description !== undefined && preprocessed.description !== '') {
      logger.debug(
        { referenceNumber, url: attachment.url },
        '[ReferencedMessageFormatter] Using preprocessed voice transcription'
      );
      return {
        index,
        line: `- Voice Message (${attachment.duration}s): "${preprocessed.description}"`,
      };
    }

    try {
      logger.info(
        { referenceNumber, url: attachment.url, duration: attachment.duration },
        '[ReferencedMessageFormatter] Transcribing voice message'
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
        '[ReferencedMessageFormatter] Voice transcription failed'
      );
      return { index, line: `- Voice Message (${attachment.duration}s) [transcription failed]` };
    }
  }

  /** Process image attachment */
  private async processImageAttachment(
    options: ProcessImageOptions
  ): Promise<ProcessedAttachmentResult> {
    const {
      attachment,
      index,
      referenceNumber,
      personality,
      isGuestMode,
      preprocessed,
      userApiKey,
    } = options;
    if (preprocessed?.description !== undefined && preprocessed.description !== '') {
      logger.debug(
        { referenceNumber, url: attachment.url },
        '[ReferencedMessageFormatter] Using preprocessed image description'
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
        '[ReferencedMessageFormatter] Processing image (inline fallback)'
      );
      const result = await withRetry(
        () => describeImage(attachment, personality, isGuestMode, userApiKey),
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
        '[ReferencedMessageFormatter] Image processing failed'
      );
      return { index, line: `- Image (${attachment.name}) [vision processing failed]` };
    }
  }

  /**
   * Process a single attachment (image or voice message)
   *
   * Handles vision model or transcription processing with graceful error handling.
   * If preprocessed data is available, uses it instead of making API calls.
   */
  private async processSingleAttachment(
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
    const preprocessed = this.findPreprocessedByUrl(attachment.url, preprocessedAttachments);

    if (attachment.isVoiceMessage === true) {
      return this.processVoiceAttachment(
        attachment,
        index,
        referenceNumber,
        personality,
        preprocessed
      );
    }

    if (attachment.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
      return this.processImageAttachment({
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
}
