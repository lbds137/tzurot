/**
 * Referenced Message Formatter
 *
 * Formats referenced messages (from replies or message links) for inclusion in AI prompts.
 * Wraps output in <contextual_references> XML tags for better LLM context separation.
 * Delegates attachment processing to AttachmentProcessor for parallel image/voice handling.
 */

import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { AttachmentType } from '@tzurot/common-types/constants/media';
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
  attachmentEnrichment,
  type ForwardedMessageContent,
  type RenderableAttachment,
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
const CONTEXTUAL_REFERENCES_INSTRUCTION = `<instruction>Messages the user's current message is replying to or quoting — read them only to understand what the user is responding to. A quote's role says who wrote it: role="assistant" is one of your own earlier lines (context, never a turn to continue or extend); role="user" is a person; role="character" is a different AI character — a conversation peer, not you and not the human you're replying to; role="bot" is a non-character bot or automated webhook. Respond to the user's current message. A stubbed quote's full text appears in <chat_log>; any media it describes appears only in the quote itself.</instruction>`;

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
 * The formatter's two parallel renderings of the same references:
 * `formatted` is the XML block for the prompt; `searchText` is the plain
 * semantic content (message text, attachment descriptions/transcriptions,
 * embed text) for the memory/fact retrieval query. searchText is built from
 * the RAW pieces, never by re-parsing the XML — tag-stripping the formatted
 * block leaked the <instruction> boilerplate and dedup-stub placeholders
 * into every reply-shaped embedding query.
 */
export interface FormattedReferences {
  formatted: string;
  searchText: string;
}

/** The renderable enrichment children a reference's preprocessed results yield. */
interface SplitEnrichment {
  attachments: RenderableAttachment[];
  /**
   * Entries that CARRY something worth rendering (non-empty description).
   * The tripwire's denominator is this rather than the raw entry count: a
   * successful-but-empty transcription (a silent audio clip) has nothing to
   * render and is not a drop, and counting it as one would warn on every
   * occurrence of ordinary traffic.
   */
  renderable: number;
  /** Of those, how many actually produced a rendered child. */
  rendered: number;
}

/**
 * Split already-preprocessed reference attachments into renderable children.
 *
 * This is the READ side only — every result here was produced (and paid for) by
 * the dependency-job stage; nothing new is computed, so a deduped stub still
 * triggers zero vision/STT calls.
 *
 * The deduped branch needs its own splitter rather than reusing
 * `processAttachmentsParallel`: that helper walks `ref.attachments` and looks
 * preprocessing up by URL, and `buildDedupedReferenceStub` strips `attachments`
 * from the stub, so it would find nothing to walk. The preprocessed entries
 * carry their own metadata and are self-sufficient. Discriminating on
 * `ProcessedAttachment.type` (not `metadata.contentType`) is deliberate — the
 * dependency step synthesizes metadata with a placeholder `image/unknown` /
 * `audio/unknown` content type, so a content-type test would misroute audio.
 */
function splitPreprocessedEnrichment(
  preprocessed: ProcessedAttachment[] | undefined
): SplitEnrichment {
  if (preprocessed === undefined || preprocessed.length === 0) {
    return { attachments: [], renderable: 0, rendered: 0 };
  }

  const attachments: RenderableAttachment[] = [];
  let renderable = 0;
  for (const entry of preprocessed) {
    if (entry.description.length === 0) {
      // Nothing to render and nothing lost — a silent audio clip transcribes to
      // '' on SUCCESS. Not counted as renderable, so it never trips the drop warn.
      continue;
    }
    renderable++;
    // `name` is optional on AttachmentMetadata; the dependency step derives it
    // from the URL basename, so undefined means a synthesized attachment with no
    // filename at all. Left undefined rather than defaulted — the attribute is
    // omitted instead of carrying an invented name.
    if (entry.type === AttachmentType.Image) {
      attachments.push({
        kind: 'image',
        filename: entry.metadata.name,
        description: entry.description,
      });
    } else if (entry.type === AttachmentType.Audio) {
      attachments.push({
        kind: 'voice',
        filename: entry.metadata.name,
        // Duration only — deliberately NOT contentType. Per the note above, the
        // dependency step synthesizes `audio/unknown` here, so forwarding it
        // would render a `type` attribute that is a placeholder dressed as fact.
        durationSeconds: entry.metadata.duration,
        description: entry.description,
      });
    }
    // Any other type falls through UNRENDERED and stays counted in `renderable`,
    // so the drop tripwire below fires. That is deliberate: silently downgrading
    // an unknown modality to a bare <file/> would discard the description this
    // function exists to carry, which is the exact class the tripwire watches.
  }

  return { attachments, renderable, rendered: attachments.length };
}

/**
 * The semantic text an attachment contributes to a retrieval query: its
 * enrichment only.
 *
 * Filenames, content types and status markers are deliberately excluded — they
 * are metadata about the file, not about what is IN it, and an embedding query
 * carrying `photo.png` matches on the noise rather than the content. (The
 * previous shape fed the whole rendered line, prefix included, into the query.)
 */
function collectAttachmentText(attachments: RenderableAttachment[]): string[] {
  return attachments
    .map(attachmentEnrichment)
    .filter((desc): desc is string => desc !== undefined && desc.length > 0);
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
   * If preprocessed attachments are provided, uses them instead of making inline API calls.
   *
   * @param references - Referenced messages to format
   * @param personality - Personality configuration for vision/transcription models
   * @param isGuestMode - Whether the user is in guest mode (no BYOK API key)
   * @param preprocessedAttachments - Pre-processed attachments keyed by reference number (avoids inline API calls)
   * @param userApiKey - User's BYOK API key (for BYOK users)
   * @param sttDispatch - Resolved STT dispatch (provider + matching BYOK key)
   * @returns The prompt XML plus the plain-text search rendering
   */
  async formatReferencedMessages(
    references: ReferencedMessage[],
    personality: LoadedPersonality,
    isGuestMode = false,
    preprocessedAttachments?: Record<number, ProcessedAttachment[]>,
    apiKeys?: ReferenceVisionAuth
  ): Promise<FormattedReferences> {
    const referenceElements: string[] = [];
    const searchParts: string[] = [];

    // Process each reference into XML
    for (const ref of references) {
      // Deduped stubs: lightweight quote with reply-target note. No NEW
      // attachment work is done — but media enrichment already computed by the
      // dependency stage IS rendered here, because <chat_log> carries the
      // embed/attachment URL and never its description.
      //
      // The stub's `content` also carries `[image/png: name]` markers folded in
      // by `buildDedupedReferenceStub`. That overlap is intentional for now: the
      // marker is the FALLBACK for an image whose description never arrived, and
      // the builder can't know whether it will. Filenames match across the two,
      // so they read as one image, not two. (The stored path in
      // `xmlMetadataFormatters` drops its markers instead — it can, because it
      // sees both at once. Collapsing that asymmetry is the projection refactor.)
      if (ref.isDeduplicated === true) {
        const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);
        const preprocessedForRef = preprocessedAttachments?.[ref.referenceNumber];
        const enrichment = splitPreprocessedEnrichment(preprocessedForRef);
        this.warnOnDroppedEnrichment(ref.referenceNumber, enrichment);
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
            attachments: enrichment.attachments,
          })
        );
        // The stub's capped text copy is real signal; the reply-target
        // marker the quote renderer adds is not, so contribute the raw
        // content only (empty for a bot's own reply-target). Media
        // descriptions ride along for the same reason they ride into the
        // prompt: history has no copy of them to retrieve against.
        searchParts.push(
          [ref.content, ...collectAttachmentText(enrichment.attachments)]
            .filter(part => part.length > 0)
            .join('\n')
        );
        continue;
      }

      // Forwarded messages use the shared QuoteFormatter for consistency
      if (ref.isForwarded === true) {
        const forwarded = await this.formatForwardedReference(
          ref,
          personality,
          isGuestMode,
          preprocessedAttachments?.[ref.referenceNumber],
          apiKeys
        );
        referenceElements.push(forwarded.element);
        searchParts.push(forwarded.searchText);
        continue;
      }

      // Non-forwarded messages: standard quote format
      const standard = await this.formatStandardReference(
        ref,
        personality,
        isGuestMode,
        preprocessedAttachments?.[ref.referenceNumber],
        apiKeys
      );
      referenceElements.push(standard.element);
      searchParts.push(standard.searchText);
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
    return {
      formatted: `<contextual_references>\n${CONTEXTUAL_REFERENCES_INSTRUCTION}\n${formattedText}\n</contextual_references>`,
      searchText: searchParts
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .join('\n\n'),
    };
  }

  /**
   * Tripwire for the enrichment-drop class: preprocessed results reached this
   * renderer but produced fewer rendered children than there were results.
   *
   * It exists because the drop it guards was invisible — four vision calls ran,
   * succeeded, cost 47s, and were discarded with zero log output, so the only
   * detector in the system was a human noticing the character couldn't see the
   * images. With the deduped branch rendering them this should never fire; if a
   * future field goes missing the same way, it says so instead.
   */
  private warnOnDroppedEnrichment(referenceNumber: number, enrichment: SplitEnrichment): void {
    if (enrichment.renderable > enrichment.rendered) {
      logger.warn(
        { referenceNumber, renderable: enrichment.renderable, rendered: enrichment.rendered },
        '[ReferencedMessageFormatter] Preprocessed reference enrichment was not rendered — ' +
          'vision/transcription work was paid for and is not reaching the prompt'
      );
    }
  }

  /**
   * Semantic text of one reference for the retrieval query: message text,
   * attachment description/transcription lines, and embed text (embeds are
   * pre-formatted XML, so tag-strip JUST that piece — content only, no
   * envelope). Location context, timestamps, and role metadata never
   * belong in an embedding query.
   */
  private buildReferenceSearchText(
    ref: ReferencedMessage,
    attachments: RenderableAttachment[]
  ): string {
    const pieces = [ref.content, ...collectAttachmentText(attachments)];
    if (ref.embeds !== undefined && ref.embeds.length > 0) {
      pieces.push(extractXmlTextContent(ref.embeds));
    }
    return pieces
      .map(piece => piece.trim())
      .filter(piece => piece.length > 0)
      .join('\n');
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
  ): Promise<{ element: string; searchText: string }> {
    const { userApiKey, sttDispatch, visionProvider, visionModel } = apiKeys ?? {};
    const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);

    let attachments: RenderableAttachment[] = [];
    if (ref.attachments && ref.attachments.length > 0) {
      attachments = await processAttachmentsParallel({
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

    const element = formatQuoteElement({
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
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    return { element, searchText: this.buildReferenceSearchText(ref, attachments) };
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
  ): Promise<{ element: string; searchText: string }> {
    const { userApiKey, sttDispatch, visionProvider, visionModel } = apiKeys ?? {};
    const { absolute, relative } = formatTimestampWithDelta(ref.timestamp);

    const forwardedContent: ForwardedMessageContent = {
      textContent: ref.content ?? undefined,
      timestamp: absolute.length > 0 && relative.length > 0 ? { absolute, relative } : undefined,
      embedsXml: ref.embeds ? [ref.embeds] : undefined,
    };

    // Process attachments if present
    let attachments: RenderableAttachment[] = [];
    if (ref.attachments && ref.attachments.length > 0) {
      attachments = await processAttachmentsParallel({
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

      if (attachments.length > 0) {
        forwardedContent.attachments = attachments;
      }
    }

    return {
      element: formatForwardedQuote(forwardedContent),
      searchText: this.buildReferenceSearchText(ref, attachments),
    };
  }
}
