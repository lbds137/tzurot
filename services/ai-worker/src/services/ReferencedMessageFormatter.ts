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
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  type ReferencedMessage,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import { batchResolveByDiscordIds } from './reference/BatchResolvers.js';
import type { ResolvedPersona } from './reference/UserReferencePatterns.js';
import {
  attachmentEnrichment,
  buildRenderableAttachments,
  type BuiltAttachment,
} from './prompt/QuoteFormatter.js';
import {
  dedupeReference,
  promptTime,
  referenceSearchText,
  renderReference,
  type RenderableReference,
} from './prompt/RenderableReference.js';
import { deriveRefRole } from './prompt/referenceRole.js';
import { toStoredReference } from './prompt/storedReference.js';
import { processAttachmentsParallel } from './AttachmentProcessor.js';
import { redactOwnVoiceTranscript } from './voice/ownVoiceGuard.js';
import { extractXmlTextContent } from '../utils/xmlTextExtractor.js';
import { isOwnPersonaVoice } from '@tzurot/common-types/utils/ownVoice';

const logger = createLogger('ReferencedMessageFormatter');

/**
 * Instruction prepended inside <contextual_references> (mirrors the
 * <participants>/<memory_archive> instruction pattern). Order-agnostic, positive,
 * role-aware: the self-authored reply-target is the structural trap — a quote of the
 * bot's own words read as a turn to continue. Kept as a named constant so the wording
 * is visible alongside the other prompt-text constants instead of buried inline.
 */
const CONTEXTUAL_REFERENCES_INSTRUCTION = `<instruction>Messages the user's current message is replying to or quoting — read them only to understand what the user is responding to. A quote's role says who wrote it: role="assistant" is one of your own earlier lines (context, never a turn to continue or extend); role="user" is a person; role="character" is a different AI character — a conversation peer, not you and not the human you're replying to; role="bot" is a non-character bot or automated webhook. Respond to the user's current message. A stubbed quote's full text appears in <chat_log>; any media description not shown in the quote itself is in <chat_log>.</instruction>`;

/**
 * Context for reference formatting. `userApiKey` is the key for
 * the VISION provider (resolved upstream), and `visionProvider`/`visionModel`
 * carry the cross-provider vision resolution so reference images use the correct
 * key+model instead of the raw main-model key. `sttDispatch` drives voice
 * transcription independently. `allPersonalityNames` (personalities seen in the
 * visible history) enables the sibling-persona quote demotion in `deriveRefRole`
 * — without it a sibling's stamped-assistant quote renders as the responding
 * persona's own line. `requestId` is pure correlation: it never changes what is
 * rendered, it only lets this module's warnings name the request whose paid
 * enrichment went missing. All fields optional — legacy callers degrade.
 */
interface ReferenceVisionAuth {
  userApiKey?: string;
  sttDispatch?: SttDispatch;
  visionProvider?: AIProvider;
  visionModel?: string;
  allPersonalityNames?: Set<string>;
  requestId?: string;
  /**
   * Per-reference: the enrichment `<chat_log>` will already render for that
   * reference's own history entry, keyed by Discord message id. Batch-invariant
   * (one derivation for the whole set) and READ-ONLY here — the caller derives
   * it from the enriched history, because whether history carries a quote's
   * image description is a fact about the OTHER renderer's output, not one this
   * module can see.
   *
   * A reference with no entry in the map subtracts nothing, which is the safe
   * default `dedupeReference` documents: a duplicated description costs tokens,
   * a dropped one costs the answer.
   */
  carriedByChatLog?: Map<string, ReadonlySet<string>>;
}

/**
 * Everything the per-reference adapter needs that does NOT vary across the
 * batch — the responding personality, the guest-mode flag, the persona lookup
 * resolved once for the whole set, and the vision/STT auth. Bundled as one
 * object rather than four positional parameters so adding the next
 * batch-invariant input is an edit to this interface instead of a wider
 * signature.
 */
interface LiveReferenceContext {
  personality: LoadedPersonality;
  isGuestMode: boolean;
  /** Discord user id → resolved persona, for the whole batch. Misses are normal. */
  personaMap: Map<string, ResolvedPersona>;
  apiKeys?: ReferenceVisionAuth;
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
  /**
   * The same references in durable form, ready for the trigger history row.
   *
   * Third rendering of one build, not a second one: the enrichment inside it is
   * read straight off the objects this loop just handed the renderer, so a
   * description that reached the prompt and the description that reaches the
   * database are the same string by construction. Vision and transcription are
   * paid work, and until this existed the only copy lived in a one-hour cache.
   */
  durable: StoredReferencedMessage[];
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
): BuiltAttachment[] {
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
  // A `file` entry renders IDENTITY-ONLY, and that is the whole rendering it
  // gets: its "description" is the unsupported-type stub, static text nobody
  // paid a model for, and `RenderableFile` has no slot for it by design. The
  // stub's wording travels the processed-attachment path instead, where
  // RAGUtils renders it as a `[File: name]` line. Rendering the element at all
  // still matters — otherwise an orphaned file vanishes and the quote claims
  // the message had no attachment.
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
        url: entry.originalUrl,
        attachment: {
          kind: 'image',
          filename: entry.metadata.name,
          description: entry.description,
        },
      });
    } else if (entry.type === AttachmentType.Audio) {
      attachments.push({
        url: entry.originalUrl,
        attachment: {
          kind: 'voice',
          filename: entry.metadata.name,
          durationSeconds: entry.metadata.duration,
          description: entry.description,
        },
      });
    } else if (entry.type === AttachmentType.File) {
      attachments.push({
        url: entry.originalUrl,
        attachment: {
          kind: 'file',
          filename: entry.metadata.name,
        },
      });
    }
  }

  // Render-side belt-and-suspenders: a preprocessed voice description here was
  // computed by the dependency stage's job, which can run before this turn's
  // render decides the reference is our own persona's audio — so even a
  // freshly-produced transcript must not survive into the prompt for an
  // assistant-authored reference. Applied last, after both loops, so it covers
  // every voice entry regardless of which loop produced it.
  if (isOwnPersonaVoice(ref.authorRole)) {
    return attachments.map(entry =>
      entry.attachment.kind === 'voice'
        ? { url: entry.url, attachment: redactOwnVoiceTranscript(entry.attachment) }
        : entry
    );
  }

  return attachments;
}

/**
 * How much PAID enrichment the dependency stage produced for this reference.
 *
 * The denominator for the drop tripwire below, so it counts only what a model
 * was actually billed for. Two exclusions:
 *
 * - Empty descriptions: a silent audio clip transcribes to `''` on SUCCESS, so
 *   counting it would warn on ordinary traffic.
 * - `file` entries: their description is the unsupported-type stub, generated
 *   locally from the content type, and a file renders identity-only by design.
 *   Counting it would make the tripwire fire on any deduped quote of a video
 *   or a document, claiming vision/transcription spend that never happened.
 */
function countAvailableEnrichment(preprocessed: ProcessedAttachment[] | undefined): number {
  return (preprocessed ?? []).filter(
    entry => entry.description.length > 0 && entry.type !== AttachmentType.File
  ).length;
}

/** How much of it survived into the rendered attachments. */
function countRenderedEnrichment(attachments: BuiltAttachment[]): number {
  return attachments.filter(built => {
    const text = attachmentEnrichment(built.attachment);
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
   * @param prisma - Backs the persona hydration of quote authors. The live path
   *   renders the SAME identity vocabulary as <chat_log> and stored quotes —
   *   persona name plus `from_id` — so one person is not named two ways inside
   *   one prompt with only one of the names ID-bound.
   */
  constructor(private readonly prisma: PrismaClient) {}

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
   * @param apiKeys - Vision/STT auth plus the batch-invariant render inputs: the
   *   personality-name set for role derivation and the per-reference set of
   *   enrichment `<chat_log>` already carries (see `carriedByChatLog`)
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
    const durable: StoredReferencedMessage[] = [];

    // ONE lookup for the whole batch, before any rendering: two quotes by the
    // same author must not become two queries, and the resolver already returns
    // an empty map for both empty input and a failed query — a database that is
    // down costs the persona names, never the quotes.
    const personaMap = await batchResolveByDiscordIds(this.prisma, [
      ...new Set(
        references.map(ref => ref.discordUserId).filter(id => id !== undefined && id.length > 0)
      ),
    ]);
    const context: LiveReferenceContext = { personality, isGuestMode, personaMap, apiKeys };

    for (const ref of references) {
      const { renderable, built } = await this.fromLiveReference(
        ref,
        preprocessedAttachments?.[ref.referenceNumber],
        context
      );

      // Dedup is a projection of the reference above, never a second build —
      // so a field this formatter learns to carry reaches the stub for free.
      //
      // The subtraction set is looked up per reference: it says what <chat_log>
      // renders for THIS quote's own history entry, so the stub stops repeating
      // a description the model reads twenty lines later anyway. A miss (no
      // matching entry, or a caller that threads no map) subtracts nothing.
      referenceElements.push(
        renderReference(
          ref.isDeduplicated === true
            ? dedupeReference(renderable, apiKeys?.carriedByChatLog?.get(ref.discordMessageId))
            : renderable
        )
      );

      // Persisted from the PRE-projection reference, and from the enrichment as
      // built rather than as rendered: the stub subtracts content for THIS
      // turn's prompt, but replay decides dedup for itself and needs the whole
      // reference to decide from.
      durable.push(toStoredReference(ref, built, apiKeys?.requestId));

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
      durable,
    };
  }

  /**
   * Adapt a live reference into the canonical renderable shape.
   *
   * The one place the live schema is read. Everything downstream — full,
   * forwarded, and deduped alike — sees the same object, which is why
   * forwarding is now an attribute on it rather than a separate render method
   * that quietly dropped the number, role, username and location.
   *
   * Identity is resolved HERE, per the adapter contract on
   * `RenderableReference`: a quote's author renders under the persona name and
   * carries the persona UUID that `<participants>` binds, matching what
   * <chat_log> and a replayed stored quote already render. `context.personaMap`
   * is the batch the caller resolved for the whole set; a miss falls back to
   * the Discord display name, which is what the path rendered unconditionally
   * before.
   */
  private async fromLiveReference(
    ref: ReferencedMessage,
    preprocessedForRef: ProcessedAttachment[] | undefined,
    context: LiveReferenceContext
  ): Promise<{ renderable: RenderableReference; built: BuiltAttachment[] }> {
    const { personality, isGuestMode, personaMap, apiKeys } = context;

    const built = await this.buildAttachments(
      ref,
      personality,
      isGuestMode,
      preprocessedForRef,
      apiKeys
    );

    const discordName = ref.authorDisplayName || ref.authorUsername;
    const persona = personaMap.get(ref.discordUserId);

    return {
      built,
      renderable: {
        number: ref.referenceNumber,
        isForwarded: ref.isForwarded,
        from: persona?.personaName ?? discordName,
        fromId: persona?.personaId,
        username: ref.authorUsername,
        // Deliberately the DISCORD name, not the hydrated one: role derivation
        // is a name-match against the responding personality's own display
        // name and its siblings' — all Discord-vocabulary — so feeding it a
        // persona name would silently break the self/sibling match that keeps
        // a persona's own line from reading as a user's.
        role: deriveRefRole(
          ref.authorRole,
          discordName,
          personality.displayName,
          apiKeys?.allPersonalityNames
        ),
        time: promptTime(ref.timestamp),
        content: ref.content,
        locationContext: ref.locationContext,
        embedsXml: ref.embeds !== undefined && ref.embeds.length > 0 ? [ref.embeds] : undefined,
        attachments: built.map(entry => entry.attachment),
      },
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
  ): Promise<BuiltAttachment[]> {
    if (ref.isDeduplicated === true) {
      const attachments = buildDedupedAttachments(ref, preprocessedForRef);
      this.warnOnDroppedEnrichment(
        ref.referenceNumber,
        countAvailableEnrichment(preprocessedForRef),
        countRenderedEnrichment(attachments),
        apiKeys?.requestId
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
      authorRole: ref.authorRole,
      visionProvider,
      model: visionModel,
      requestId: apiKeys?.requestId,
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
   * survives: a modality this renderer has no arm for at all — what a third
   * enrichment type looks like on the day it is added and the deduped branch is
   * not taught about it. If that ever happens, this says so instead of
   * swallowing it.
   *
   * It guards PAID modalities only. A `file` entry's stub description is free
   * static text and has nowhere to go by design (`RenderableFile` carries no
   * enrichment slot), so it is excluded from the denominator rather than
   * reported as purchased work that went missing.
   *
   * `requestId` carries the correlation the alert is useless without: the
   * counts say enrichment was lost, and the id says which request lost it, so
   * the producing job's own logs are one query away rather than a timestamp
   * search. Undefined for callers that thread no correlation id.
   */
  private warnOnDroppedEnrichment(
    referenceNumber: number,
    available: number,
    rendered: number,
    requestId: string | undefined
  ): void {
    if (available > rendered) {
      logger.warn(
        { requestId, referenceNumber, renderable: available, rendered },
        '[ReferencedMessageFormatter] Preprocessed reference enrichment was not rendered — ' +
          'vision/transcription work was paid for and is not reaching the prompt'
      );
    }
  }
}
