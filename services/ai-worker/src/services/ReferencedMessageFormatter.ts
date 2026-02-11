/**
 * Referenced Message Formatter
 *
 * Formats referenced messages (from replies or message links) for inclusion in AI prompts.
 * Wraps output in <contextual_references> XML tags for better LLM context separation.
 * Delegates attachment processing to AttachmentProcessor for parallel image/voice handling.
 */

import {
  createLogger,
  type ReferencedMessage,
  type LoadedPersonality,
  TEXT_LIMITS,
  formatTimestampWithDelta,
} from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import {
  formatQuoteElement,
  formatForwardedQuote,
  type ForwardedMessageContent,
} from './prompt/QuoteFormatter.js';
import { processAttachmentsParallel } from './AttachmentProcessor.js';
import { extractXmlTextContent } from '../utils/xmlTextExtractor.js';

const logger = createLogger('ReferencedMessageFormatter');

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
    return extractXmlTextContent(formattedReferences);
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
      // Forwarded messages use the shared QuoteFormatter for consistency
      if (ref.isForwarded === true) {
        const forwardedElement = await this.formatForwardedReference(
          ref,
          personality,
          isGuestMode,
          preprocessedAttachments?.[ref.referenceNumber],
          userApiKey
        );
        referenceElements.push(forwardedElement);
        continue;
      }

      // Non-forwarded messages: standard quote format
      const standardElement = await this.formatStandardReference(
        ref,
        personality,
        isGuestMode,
        preprocessedAttachments?.[ref.referenceNumber],
        userApiKey
      );
      referenceElements.push(standardElement);
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
   * Format a standard (non-forwarded) reference as XML.
   */
  private async formatStandardReference(
    ref: ReferencedMessage,
    personality: LoadedPersonality,
    isGuestMode: boolean,
    preprocessedForRef?: ProcessedAttachment[],
    userApiKey?: string
  ): Promise<string> {
    const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);

    let attachmentLines: string[] = [];
    if (ref.attachments && ref.attachments.length > 0) {
      attachmentLines = await processAttachmentsParallel({
        attachments: ref.attachments,
        referenceNumber: ref.referenceNumber,
        personality,
        isGuestMode,
        preprocessedAttachments: preprocessedForRef,
        userApiKey,
      });
    }

    return formatQuoteElement({
      number: ref.referenceNumber,
      from: ref.authorDisplayName,
      username: ref.authorUsername,
      timestamp: absolute.length > 0 && relative.length > 0 ? { absolute, relative } : undefined,
      content: ref.content || undefined,
      locationContext: ref.locationContext,
      embedsXml: ref.embeds ? [ref.embeds] : undefined,
      attachmentLines: attachmentLines.length > 0 ? attachmentLines : undefined,
    });
  }

  /**
   * Format a forwarded reference using the shared QuoteFormatter.
   * Ensures consistent XML output between the message link path and chat history path.
   */
  private async formatForwardedReference(
    ref: ReferencedMessage,
    personality: LoadedPersonality,
    isGuestMode: boolean,
    preprocessedForRef?: ProcessedAttachment[],
    userApiKey?: string
  ): Promise<string> {
    const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);

    const forwardedContent: ForwardedMessageContent = {
      textContent: ref.content ?? undefined,
      timestamp: absolute.length > 0 && relative.length > 0 ? { absolute, relative } : undefined,
      embedsXml: ref.embeds ? [ref.embeds] : undefined,
    };

    // Process attachments if present
    if (ref.attachments && ref.attachments.length > 0) {
      const attachmentLines = await processAttachmentsParallel({
        attachments: ref.attachments,
        referenceNumber: ref.referenceNumber,
        personality,
        isGuestMode,
        preprocessedAttachments: preprocessedForRef,
        userApiKey,
      });

      if (attachmentLines.length > 0) {
        forwardedContent.attachmentLines = attachmentLines;
      }
    }

    return formatForwardedQuote(forwardedContent);
  }
}
