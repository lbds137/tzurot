/**
 * Referenced Message Formatter
 *
 * Formats referenced messages (from replies or message links) for inclusion in AI prompts.
 * Wraps output in <contextual_references> XML tags for better LLM context separation.
 * Delegates attachment processing to AttachmentProcessor for parallel image/voice handling.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { formatTimestampWithDelta } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import {
  formatQuoteElement,
  formatForwardedQuote,
  formatDedupedQuote,
  type ForwardedMessageContent,
} from './prompt/QuoteFormatter.js';
import { deriveRefRole } from './prompt/referenceRole.js';
import { processAttachmentsParallel } from './AttachmentProcessor.js';
import { extractXmlTextContent } from '../utils/xmlTextExtractor.js';

const logger = createLogger('ReferencedMessageFormatter');

/**
 * Instruction prepended inside <contextual_references> (mirrors the
 * <participants>/<memory_archive> instruction pattern). Order-agnostic, positive,
 * role-aware: the self-authored reply-target is the structural trap — a quote of the
 * bot's own words read as a turn to continue. Kept as a named constant so the wording
 * is visible alongside the other prompt-text constants instead of buried inline.
 */
const CONTEXTUAL_REFERENCES_INSTRUCTION = `<instruction>Messages the user's current message is replying to or quoting — read them only to understand what the user is responding to. A quote's role says who wrote it: role="assistant" is one of your own earlier lines (context, never a turn to continue or extend); role="user" is a person; role="character" is a different AI character — a conversation peer, not you and not the human you're replying to; role="bot" is a non-character bot or automated webhook. Respond to the user's current message. A stubbed quote's full text appears in <chat_log>.</instruction>`;

/**
 * Context for reference formatting. `userApiKey` is the key for
 * the VISION provider (resolved upstream), and `visionProvider`/`visionModel`
 * carry the cross-provider vision resolution so reference images use the correct
 * key+model instead of the raw main-model key. `sttDispatch` drives voice
 * transcription independently. `allPersonalityNames` (personalities seen in the
 * visible history) enables the sibling-persona quote demotion in `deriveRefRole`
 * — without it a sibling's stamped-assistant quote renders as the responding
 * persona's own line. All fields optional — legacy callers degrade.
 */
interface ReferenceVisionAuth {
  userApiKey?: string;
  sttDispatch?: SttDispatch;
  visionProvider?: AIProvider;
  visionModel?: string;
  allPersonalityNames?: Set<string>;
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
   * @param sttDispatch - Resolved STT dispatch (provider + matching BYOK key)
   * @returns Formatted string ready for prompt
   */
  async formatReferencedMessages(
    references: ReferencedMessage[],
    personality: LoadedPersonality,
    isGuestMode = false,
    preprocessedAttachments?: Record<number, ProcessedAttachment[]>,
    apiKeys?: ReferenceVisionAuth
  ): Promise<string> {
    const referenceElements: string[] = [];

    // Process each reference into XML
    for (const ref of references) {
      // Deduped stubs: lightweight quote with reply-target note (no attachment processing)
      if (ref.isDeduplicated === true) {
        const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);
        referenceElements.push(
          formatDedupedQuote({
            number: ref.referenceNumber,
            from: ref.authorDisplayName,
            username: ref.authorUsername,
            role: deriveRefRole(
              ref.authorRole,
              ref.authorDisplayName || ref.authorUsername,
              personality.displayName,
              apiKeys?.allPersonalityNames
            ),
            timestamp:
              absolute.length > 0 && relative.length > 0 ? { absolute, relative } : undefined,
            content: ref.content,
          })
        );
        continue;
      }

      // Forwarded messages use the shared QuoteFormatter for consistency
      if (ref.isForwarded === true) {
        const forwardedElement = await this.formatForwardedReference(
          ref,
          personality,
          isGuestMode,
          preprocessedAttachments?.[ref.referenceNumber],
          apiKeys
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
        apiKeys
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

    // Wrap in outer XML tag.
    return `<contextual_references>\n${CONTEXTUAL_REFERENCES_INSTRUCTION}\n${formattedText}\n</contextual_references>`;
  }

  /**
   * Format a standard (non-forwarded) reference as XML.
   */
  private async formatStandardReference(
    ref: ReferencedMessage,
    personality: LoadedPersonality,
    isGuestMode: boolean,
    preprocessedForRef?: ProcessedAttachment[],
    apiKeys?: ReferenceVisionAuth
  ): Promise<string> {
    const { userApiKey, sttDispatch, visionProvider, visionModel } = apiKeys ?? {};
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
        sttDispatch,
        visionProvider,
        model: visionModel,
      });
    }

    return formatQuoteElement({
      number: ref.referenceNumber,
      from: ref.authorDisplayName,
      username: ref.authorUsername,
      role: deriveRefRole(
        ref.authorRole,
        ref.authorDisplayName || ref.authorUsername,
        personality.displayName,
        apiKeys?.allPersonalityNames
      ),
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
    apiKeys?: ReferenceVisionAuth
  ): Promise<string> {
    const { userApiKey, sttDispatch, visionProvider, visionModel } = apiKeys ?? {};
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
        sttDispatch,
        visionProvider,
        model: visionModel,
      });

      if (attachmentLines.length > 0) {
        forwardedContent.attachmentLines = attachmentLines;
      }
    }

    return formatForwardedQuote(forwardedContent);
  }
}
