/**
 * Referenced Message Formatter
 *
 * Formats referenced messages (from replies or message links) for inclusion in AI prompts.
 * Processes attachments (images, voice messages) in parallel for better performance.
 */

import { createLogger, type ReferencedMessage, type LoadedPersonality, CONTENT_TYPES, TEXT_LIMITS, RETRY_CONFIG } from '@tzurot/common-types';
import { describeImage, transcribeAudio } from './MultimodalProcessor.js';
import { withRetry } from '../utils/retryService.js';

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
 * Referenced Message Formatter
 *
 * Handles formatting of referenced messages with parallel attachment processing
 */
export class ReferencedMessageFormatter {
  /**
   * Format referenced messages for inclusion in prompt
   *
   * Processes all attachments (images, voice messages) in parallel for better performance.
   *
   * @param references - Referenced messages to format
   * @param personality - Personality configuration for vision/transcription models
   * @returns Formatted string ready for prompt
   */
  async formatReferencedMessages(
    references: ReferencedMessage[],
    personality: LoadedPersonality
  ): Promise<string> {
    const lines: string[] = [];
    lines.push('## Referenced Messages\n');
    lines.push('The user is referencing the following messages:\n');

    // Process each reference
    for (const ref of references) {
      // Add forwarded indicator if this is a forwarded message
      const forwardedLabel = ref.isForwarded ? ' [FORWARDED MESSAGE]' : '';
      lines.push(`[Reference ${ref.referenceNumber}]${forwardedLabel}`);

      if (ref.isForwarded) {
        // For forwarded messages, author info is unavailable
        lines.push(`From: [Author unavailable - this message was forwarded]`);
      } else {
        lines.push(`From: ${ref.authorDisplayName} (@${ref.authorUsername})`);
      }

      lines.push(`Location:\n${ref.locationContext}`);
      lines.push(`Time: ${ref.timestamp}`);

      if (ref.content) {
        lines.push(`\nMessage Text:\n${ref.content}`);
      }

      if (ref.embeds) {
        lines.push(`\nMessage Embeds (structured data from Discord):\n${ref.embeds}`);
      }

      // Process attachments in parallel
      if (ref.attachments && ref.attachments.length > 0) {
        lines.push('\nAttachments:');

        const attachmentLines = await this.processAttachmentsParallel(
          ref.attachments,
          ref.referenceNumber,
          personality
        );

        lines.push(...attachmentLines);
      }

      lines.push(''); // Empty line between references
    }

    const formattedText = lines.join('\n');

    logger.info(
      `[ReferencedMessageFormatter] Formatted ${references.length} referenced message(s) for prompt`
    );

    // Log preview for debugging
    if (formattedText.length > 0) {
      logger.info(
        {
          preview: formattedText.substring(0, TEXT_LIMITS.REFERENCE_PREVIEW) + (formattedText.length > TEXT_LIMITS.REFERENCE_PREVIEW ? '...' : ''),
          totalLength: formattedText.length,
        },
        '[ReferencedMessageFormatter] Reference formatting preview'
      );
    }

    return formattedText;
  }

  /**
   * Process all attachments in parallel
   *
   * Uses Promise.allSettled to process images and voice messages concurrently,
   * significantly reducing latency when multiple attachments are present.
   *
   * @param attachments - Attachments to process
   * @param referenceNumber - Reference number for logging
   * @param personality - Personality configuration
   * @returns Array of formatted attachment lines
   */
  private async processAttachmentsParallel(
    attachments: ReferencedMessage['attachments'],
    referenceNumber: number,
    personality: LoadedPersonality
  ): Promise<string[]> {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    // Create promises for all attachments that need processing
    const processingPromises = attachments.map((attachment, index) =>
      this.processSingleAttachment(attachment, index, referenceNumber, personality)
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
   * Process a single attachment (image or voice message)
   *
   * Handles vision model or transcription processing with graceful error handling.
   *
   * @param attachment - Attachment to process
   * @param index - Index in the attachments array
   * @param referenceNumber - Reference number for logging
   * @param personality - Personality configuration
   * @returns Processed attachment result
   */
  private async processSingleAttachment(
    attachment: NonNullable<ReferencedMessage['attachments']>[0],
    index: number,
    referenceNumber: number,
    personality: LoadedPersonality
  ): Promise<ProcessedAttachmentResult> {
    // Handle voice messages - transcribe them for AI context
    if (attachment.isVoiceMessage) {
      try {
        logger.info(
          {
            referenceNumber,
            url: attachment.url,
            duration: attachment.duration,
          },
          '[ReferencedMessageFormatter] Transcribing voice message in referenced message'
        );

        const result = await withRetry(
          () => transcribeAudio(attachment, personality),
          {
            maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
            logger,
            operationName: `Voice transcription (reference ${referenceNumber})`,
          }
        );

        return {
          index,
          line: `- Voice Message (${attachment.duration}s): "${result.value}"`,
        };
      } catch (error) {
        logger.error(
          {
            err: error,
            referenceNumber,
            url: attachment.url,
          },
          '[ReferencedMessageFormatter] Failed to transcribe voice message in referenced message after retries'
        );

        return {
          index,
          line: `- Voice Message (${attachment.duration}s) [transcription failed]`,
        };
      }
    }

    // Process images through vision model
    if (attachment.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX)) {
      try {
        logger.info(
          {
            referenceNumber,
            url: attachment.url,
            name: attachment.name,
          },
          '[ReferencedMessageFormatter] Processing image in referenced message through vision model'
        );

        const result = await withRetry(
          () => describeImage(attachment, personality),
          {
            maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
            logger,
            operationName: `Image description (reference ${referenceNumber})`,
          }
        );

        return {
          index,
          line: `- Image (${attachment.name}): ${result.value}`,
        };
      } catch (error) {
        logger.error(
          {
            err: error,
            referenceNumber,
            url: attachment.url,
          },
          '[ReferencedMessageFormatter] Failed to process image in referenced message after retries'
        );

        return {
          index,
          line: `- Image (${attachment.name}) [vision processing failed]`,
        };
      }
    }

    // For other attachments, just note them
    return {
      index,
      line: `- File: ${attachment.name} (${attachment.contentType})`,
    };
  }
}
