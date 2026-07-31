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
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import {
  attachmentEnrichment,
  buildRenderableAttachments,
  type RenderableAttachment,
} from './prompt/QuoteFormatter.js';
import {
  dedupeReference,
  promptTime,
  referenceSearchText,
  renderReference,
  type RenderableReference,
} from './prompt/RenderableReference.js';
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

/**
 * Build a deduped reference's attachments from enrichment the dependency stage
 * already produced.
 *
 * READ side only — every description here was computed (and paid for) upstream,
 * so a deduped stub still triggers zero vision/STT calls. That is the whole
 * reason this exists instead of `processAttachmentsParallel`, which computes
 * what it cannot find.
 *
 * Correlation is by URL. Discriminating a preprocessed entry by
 * `ProcessedAttachment.type` rather than `metadata.contentType` is deliberate —
 * the dependency step synthesizes a placeholder `image/unknown` / `audio/unknown`
 * content type, so a content-type test would misroute audio. The rendered
 * `type` attribute comes from the reference's OWN attachment list, which
 * carries the real one.
 */
function buildDedupedAttachments(
  ref: ReferencedMessage,
  preprocessed: ProcessedAttachment[] | undefined
): RenderableAttachment[] {
  const results = preprocessed ?? [];
  const matched = new Set<ProcessedAttachment>();

  const attachments = buildRenderableAttachments(ref.attachments ?? [], att => {
    const hit = results.find(entry => entry.originalUrl === att.url);
    if (hit === undefined || hit.description.length === 0) {
      return undefined;
    }
    matched.add(hit);
    return hit.description;
  });

  // Enrichment whose attachment row is missing still renders. A description is
  // paid-for work; dropping one because the correlation missed is exactly the
  // class this module exists to close. Modality comes from the entry's own
  // `type`; the content type does not, per the note above.
  //
  // Any OTHER modality is deliberately left unrendered and stays counted, so
  // the drop tripwire fires: silently downgrading an unknown type to a bare
  // image would misdescribe it AND discard the description.
  for (const entry of results) {
    if (matched.has(entry) || entry.description.length === 0) {
      continue;
    }
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
        durationSeconds: entry.metadata.duration,
        description: entry.description,
      });
    }
  }

  return attachments;
}

/**
 * How much enrichment the dependency stage produced for this reference.
 *
 * The denominator for the drop tripwire below. Empty descriptions are excluded:
 * a silent audio clip transcribes to `''` on SUCCESS, so counting it would warn
 * on ordinary traffic.
 */
function countAvailableEnrichment(preprocessed: ProcessedAttachment[] | undefined): number {
  return (preprocessed ?? []).filter(entry => entry.description.length > 0).length;
}

/** How much of it survived into the rendered attachments. */
function countRenderedEnrichment(attachments: RenderableAttachment[]): number {
  return attachments.filter(att => {
    const text = attachmentEnrichment(att);
    return text !== undefined && text.length > 0;
  }).length;
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
   * @param apiKeys - Vision/STT auth plus the personality-name set for role derivation
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

    for (const ref of references) {
      const renderable = await this.fromLiveReference(
        ref,
        personality,
        isGuestMode,
        preprocessedAttachments?.[ref.referenceNumber],
        apiKeys
      );

      // Dedup is a projection of the reference above, never a second build —
      // so a field this formatter learns to carry reaches the stub for free.
      referenceElements.push(
        renderReference(ref.isDeduplicated === true ? dedupeReference(renderable) : renderable)
      );

      // Search text comes from the PRE-projection reference: the stub's prose
      // marker and its truncation are prompt-shaping, not semantic content.
      searchParts.push(
        referenceSearchText(
          renderable,
          ref.embeds !== undefined && ref.embeds.length > 0
            ? extractXmlTextContent(ref.embeds)
            : undefined
        )
      );
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
   * Adapt a live reference into the canonical renderable shape.
   *
   * The one place the live schema is read. Everything downstream — full,
   * forwarded, and deduped alike — sees the same object, which is why
   * forwarding is now an attribute on it rather than a separate render method
   * that quietly dropped the number, role, username and location.
   */
  private async fromLiveReference(
    ref: ReferencedMessage,
    personality: LoadedPersonality,
    isGuestMode: boolean,
    preprocessedForRef: ProcessedAttachment[] | undefined,
    apiKeys?: ReferenceVisionAuth
  ): Promise<RenderableReference> {
    return {
      number: ref.referenceNumber,
      isForwarded: ref.isForwarded,
      from: ref.authorDisplayName || ref.authorUsername,
      username: ref.authorUsername,
      role: deriveRefRole(
        ref.authorRole,
        ref.authorDisplayName || ref.authorUsername,
        personality.displayName,
        apiKeys?.allPersonalityNames
      ),
      time: promptTime(ref.timestamp),
      content: ref.content,
      locationContext: ref.locationContext,
      embedsXml: ref.embeds !== undefined && ref.embeds.length > 0 ? [ref.embeds] : undefined,
      attachments: await this.buildAttachments(
        ref,
        personality,
        isGuestMode,
        preprocessedForRef,
        apiKeys
      ),
    };
  }

  /**
   * A reference's attachments — computed for a full render, read-only for a
   * deduped one.
   *
   * The split is about SPEND, not shape: a stub must not trigger a vision or
   * transcription call for an attachment whose full copy is already in
   * <chat_log>. Both arms return the same structure.
   */
  private async buildAttachments(
    ref: ReferencedMessage,
    personality: LoadedPersonality,
    isGuestMode: boolean,
    preprocessedForRef: ProcessedAttachment[] | undefined,
    apiKeys?: ReferenceVisionAuth
  ): Promise<RenderableAttachment[]> {
    if (ref.isDeduplicated === true) {
      const attachments = buildDedupedAttachments(ref, preprocessedForRef);
      this.warnOnDroppedEnrichment(
        ref.referenceNumber,
        countAvailableEnrichment(preprocessedForRef),
        countRenderedEnrichment(attachments)
      );
      return attachments;
    }

    if (ref.attachments === undefined || ref.attachments.length === 0) {
      return [];
    }

    const { userApiKey, sttDispatch, visionProvider, visionModel } = apiKeys ?? {};
    return processAttachmentsParallel({
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

  /**
   * Tripwire for the enrichment-drop class: preprocessed results reached this
   * renderer but produced fewer enriched children than there were results.
   *
   * It exists because the drop it guards was invisible — four vision calls ran,
   * succeeded, cost 47s, and were discarded with zero log output, so the only
   * detector in the system was a human noticing the character couldn't see the
   * images. The projection makes the old drop unreachable, but one route
   * survives: enrichment for an attachment that classifies as a `file` has
   * nowhere to go, because `RenderableFile` carries no description. If that
   * ever happens, this says so instead of swallowing it.
   */
  private warnOnDroppedEnrichment(
    referenceNumber: number,
    available: number,
    rendered: number
  ): void {
    if (available > rendered) {
      logger.warn(
        { referenceNumber, renderable: available, rendered },
        '[ReferencedMessageFormatter] Preprocessed reference enrichment was not rendered — ' +
          'vision/transcription work was paid for and is not reaching the prompt'
      );
    }
  }
}
