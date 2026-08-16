/**
 * Renderable Reference
 *
 * ONE canonical shape for a quoted message, and ONE function that renders it.
 *
 * A quoted reference used to be rendered by five hand-synced paths — live
 * {standard, forwarded, deduped} × stored {full, deduped} — each filling the
 * emitter's slots slightly differently. That produced the same bug three times:
 * a field that one path carried and another silently omitted (the quote's role,
 * then its attachments, then its forwarded-ness). Each fix added the missing
 * field to the one path that had lost it.
 *
 * The shape here removes the class instead. Producers adapt their source into a
 * `RenderableReference` — `fromLiveReference` (a private method on
 * `ReferencedMessageFormatter`, because building a live reference's attachments
 * may need to CALL vision/STT) and `fromStoredReference` (a module function in
 * `xmlMetadataFormatters`), each living beside its own data source.
 * `renderReference` is the only thing that emits. A new field reaches every path
 * by construction — or fails to compile.
 *
 * Dedup is a PROJECTION of the full render, not a parallel reconstruction: see
 * `dedupeReference`.
 */

import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { formatPromptTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import {
  attachmentEnrichment,
  enrichmentKey,
  formatQuoteElement,
  type RenderableAttachment,
} from './QuoteFormatter.js';
import { type RenderedQuoteRole } from './referenceRole.js';

/**
 * A quoted message, in the shape the prompt renders it.
 *
 * Membership rule: a field belongs here **iff the emitter draws it**. The
 * criterion is drawn-ness, not divergence — which is why `discordUserId`,
 * `authorDiscordId`, `webhookId`, `authorIsBot` and `discordMessageId` are
 * absent despite differing between the two source schemas. They drive upstream
 * dedup and role decisions and never reach a tag.
 *
 * Identity arrives PRE-RESOLVED. Adapters do the persona hydration and the role
 * derivation; the renderer stays pure, so it can be exercised without a
 * database and cannot grow a second opinion about who wrote something.
 */
export interface RenderableReference {
  /**
   * Renders `number="N"` for the `[Reference N]` markers bot-client leaves in
   * the user's message text. Live references only — a quote replayed from
   * history has no link in the current message to resolve, so numbering it
   * would invent a referent.
   */
  number?: number;
  /**
   * Renders `type="forward"`. A FIELD, deliberately, not a `mode` parameter on
   * the renderer: a mode would be a second source of truth that can disagree
   * with the reference it describes.
   */
  isForwarded?: boolean;
  /** Author display name — the persona name where one is resolved. */
  from: string;
  /** Author persona UUID, for `<participants>` ID binding, when resolved. */
  fromId?: string;
  /** Discord username. Emitted only when it differs from `from` (see `renderReference`). */
  username?: string;
  role: RenderedQuoteRole;
  /** Pre-formatted timestamp — build it with `promptTime` so every path agrees. */
  time?: string;
  content: string;
  /** Pre-formatted `<location>` XML (trusted internal source). */
  locationContext?: string;
  /** Pre-formatted embed XML (trusted internal source). */
  embedsXml?: string[];
  attachments: RenderableAttachment[];
}

/**
 * Format a reference's timestamp for the `t=""` attribute, or undefined when
 * there isn't a usable one.
 *
 * The single entry point on purpose: `formatPromptTimestamp` returns `''` for an
 * unparseable date, which would otherwise render an empty `t=""`.
 */
export function promptTime(timestamp: string | undefined): string | undefined {
  if (timestamp === undefined || timestamp.length === 0) {
    return undefined;
  }
  const formatted = formatPromptTimestamp(timestamp);
  return formatted.length > 0 ? formatted : undefined;
}

/**
 * Render a reference as its `<quote>` element. The only emitter.
 */
export function renderReference(ref: RenderableReference): string {
  return formatQuoteElement({
    number: ref.number,
    type: ref.isForwarded === true ? 'forward' : undefined,
    from: ref.from,
    fromId: ref.fromId,
    username: informativeUsername(ref),
    role: ref.role,
    timeFormatted: ref.time,
    content: ref.content,
    locationContext: ref.locationContext,
    embedsXml: ref.embedsXml,
    attachments: ref.attachments,
  });
}

/**
 * The username, when it adds anything.
 *
 * A `username="vlad"` beside `from="vlad"` is a duplicated token that tells the
 * model nothing. The live path emitted it unconditionally and the stored path
 * never emitted it at all — the same quote, one attribute apart, decided by
 * which renderer got there.
 */
function informativeUsername(ref: RenderableReference): string | undefined {
  if (ref.username === undefined || ref.username.length === 0 || ref.username === ref.from) {
    return undefined;
  }
  return ref.username;
}

/**
 * Prefix for deduplicated reference stubs. Order-agnostic (points to <chat_log>
 * rather than "above" — references are assembled BEFORE <chat_log>) and drops
 * the "reply target" Discord-UI jargon, which read as a task to the model.
 *
 * It tells the model where to look, so it is a claim about the OTHER renderer's
 * output and true only while one invariant holds: every entry in the dedup
 * index also survives into the rendered chat log. `formatConversationHistoryAsXml`
 * drops any entry whose render comes back empty — which `resolveSpeakerInfo`
 * returns for a role that is neither user nor assistant — while the index keeps
 * it, and a stub built against such an entry would point at nothing. Unreachable
 * today: nothing writes a system-role conversation row. Written down because
 * the day something does, this marker starts lying silently, and the failure
 * looks like the model ignoring a quote rather than like a renderer disagreeing.
 */
// Prose marker — avoids literal tag syntax so it isn't escaped when it rides
// through escapeXmlContent inside <content>.
const DEDUP_PREFIX = '[Referenced message — full text in the chat log]';

/**
 * Variant used when the stub still carries media enrichment after subtraction.
 * The extra clause is load-bearing, not decoration: where the chat-log copy of
 * an attachment is only its raw URL, the enrichment has no counterpart there
 * and a bare "full text in the chat log" would send the model somewhere the
 * answer has never been.
 *
 * Whether that is so is NOT decided here. It is a fact about what the chat-log
 * renderer emitted for that specific entry — true for a message nobody has
 * triggered on, false for one whose own history entry renders
 * <image_descriptions> — so `dedupeReference` subtracts against the renderer's
 * actual output and this prefix is chosen from what survives. Conditional also
 * keeps a text-only stub, the common case, from paying the tokens or inviting
 * the model to hunt for media that isn't there.
 */
const DEDUP_PREFIX_WITH_MEDIA =
  '[Referenced message — full text in the chat log; its media is described here]';

/**
 * The third variant: the stub has no text of its own AND every piece of its
 * enrichment was subtracted, so the only surviving copy of the description is
 * the one in the chat log. Both other markers mislead there — the plain one
 * points at a "full text" that never existed, and the media one promises a
 * description "here" that subtraction just removed, leaving a marker with
 * nothing the model can resolve.
 *
 * Paired with a preview built from the PRE-subtraction enrichment, so the stub
 * carries something to match its chat-log entry on. The pairing is pinned by
 * `RenderableReference.test.ts` § "the media fallback preview".
 */
// Prose marker, for the same escaping reason as the two above.
const DEDUP_PREFIX_MEDIA_IN_CHAT_LOG =
  '[Referenced message — no text; its media is described in full in the chat log]';

/**
 * Cap a dedup stub's text preview. The SINGLE truncation point: `renderReference`
 * renders whatever it is given as-is.
 *
 * It applies to the text ALONE, which used to matter more than it does now — the
 * previous stub folded `[image/png: name]` markers into the same string, and
 * capping the combination let long filenames eat the whole budget and leave a
 * misleading one-character fragment (`I...` for `I got myself off…`). Attachments
 * are structural elements now, so there is nothing left to crowd the text out;
 * the cap stays because a stub is meant to be a hint, not a copy.
 */
function capDedupText(text: string): string {
  const limit = TEXT_LIMITS.DEDUP_STUB_CONTENT;
  return text.length > limit ? text.substring(0, limit) + '...' : text;
}

/**
 * Which of the three markers a stub gets, from what actually survived into it.
 *
 * `hasMedia` wins over the fallback because the two are mutually exclusive by
 * construction — the fallback is only reached when nothing enriched survives —
 * and stating the precedence beats relying on the caller's ordering.
 */
function choosePrefix(hasMedia: boolean, hasMediaFallbackPreview: boolean): string {
  if (hasMedia) {
    return DEDUP_PREFIX_WITH_MEDIA;
  }
  return hasMediaFallbackPreview ? DEDUP_PREFIX_MEDIA_IN_CHAT_LOG : DEDUP_PREFIX;
}

/**
 * The first piece of enrichment a reference's attachments carry, if any.
 *
 * Read from the PRE-subtraction attachments on purpose: it is the fallback for
 * a stub whose enrichment was all subtracted, so the post-subtraction list is
 * empty exactly when this is needed. First rather than joined — the preview is
 * an anchor for matching the chat-log entry, not a copy of it.
 */
function firstEnrichment(attachments: RenderableAttachment[]): string | undefined {
  for (const att of attachments) {
    const enrichment = attachmentEnrichment(att);
    if (enrichment !== undefined && enrichment.length > 0) {
      return enrichment;
    }
  }
  return undefined;
}

/**
 * Project a reference onto its deduplicated stub.
 *
 * SUBTRACTION from the canonical reference, never a field-by-field rebuild.
 * That is the whole point: its predecessor listed the fields it wanted and so
 * silently lost every field nobody remembered to list (the role, then the
 * attachments, then the forwarded flag). Here a field that does not appear
 * below is inherited, and adding a fifth exclusion is a conspicuous edit to
 * this function rather than an omission nobody can see.
 *
 * Every member of the exclusion set has the same justification — <chat_log>
 * reproduces it verbatim, so the stub would be paying twice:
 *
 * - `content` → the marker, plus a capped preview;
 * - `locationContext`;
 * - `embedsXml`;
 * - any attachment whose enrichment the chat log ALREADY renders.
 *
 * That last member is CONDITIONAL, and it is the only one the stub cannot
 * decide alone: whether history carries an attachment's description is a fact
 * about the other renderer's output, so the caller passes what that renderer
 * actually produced (`carriedByChatLog`) rather than this function assuming an
 * answer. Both fixed answers are wrong in opposite halves of the input —
 * dropping unconditionally discards vision spend for a message history renders
 * as a bare URL, and carrying unconditionally prints the same description twice
 * for a message whose own history entry already renders <image_descriptions>.
 *
 * With no set supplied, nothing is subtracted. That is the safe default: a
 * duplicated description costs tokens, a dropped one costs the answer.
 *
 * The marker is then chosen from what SURVIVED, in three variants, because the
 * stub's content and its promise about where the rest lives have to agree:
 *
 * - enrichment survived → `DEDUP_PREFIX_WITH_MEDIA`, and the preview stays the
 *   capped text (the surviving attachment element already describes the media,
 *   so previewing it too would print the same paid text twice in one stub);
 * - no enrichment survived, no text → `DEDUP_PREFIX_MEDIA_IN_CHAT_LOG`, with
 *   the first pre-subtraction enrichment as the preview;
 * - otherwise → `DEDUP_PREFIX`, with the capped text (empty for a stub whose
 *   message had neither text nor any description anywhere, which is a bare
 *   marker because there is nothing left to say).
 */
export function dedupeReference(
  ref: RenderableReference,
  carriedByChatLog?: ReadonlySet<string>
): RenderableReference {
  const attachments =
    carriedByChatLog === undefined || carriedByChatLog.size === 0
      ? ref.attachments
      : ref.attachments.filter(att => {
          const enrichment = attachmentEnrichment(att);
          // Undescribed attachments are never subtracted — the chat log has
          // nothing to render for them either, so the stub is their only mention.
          return (
            enrichment === undefined || !carriedByChatLog.has(enrichmentKey(att.kind, enrichment))
          );
        });

  // Computed AFTER the subtraction: a stub whose media is entirely accounted
  // for in the chat log must not promise "its media is described here".
  const hasMedia = attachments.some(att => {
    const enrichment = attachmentEnrichment(att);
    return enrichment !== undefined && enrichment.length > 0;
  });

  // Every role gets the same preview, the assistant's own prior words included.
  // Withholding it produced a contentless marker naming nothing the model could
  // resolve; the continuation risk that motivated the exemption is already
  // blocked twice in the prompt — OUTPUT_CONSTRAINTS and the
  // <contextual_references> instruction, which states that an assistant-role
  // quote is context and never a turn to continue.
  const textPreview = capDedupText(ref.content);

  // A message can be media-only, and subtraction can then take its every
  // description, leaving a marker with no anchor at all. The pre-subtraction
  // enrichment is what the chat-log copy renders, so previewing it gives the
  // model the string to match on — through the same cap, which is the single
  // truncation point. Trimmed emptiness of the RAW content, not the capped
  // preview: whitespace-only content anchors nothing so it must not block the
  // fallback, and capping first would let the cap's own '...' suffix survive
  // the trim on long whitespace runs.
  const mediaPreview =
    ref.content.trim().length === 0 && !hasMedia ? firstEnrichment(ref.attachments) : undefined;

  const preview = mediaPreview === undefined ? textPreview : capDedupText(mediaPreview);
  const prefix = choosePrefix(hasMedia, mediaPreview !== undefined);

  return {
    ...ref,
    content: preview.length > 0 ? `${prefix}\n\n${preview}` : prefix,
    locationContext: undefined,
    embedsXml: undefined,
    attachments,
  };
}

/**
 * The semantic text a reference contributes to a memory-retrieval query: its
 * own text plus its attachments' enrichment.
 *
 * Built from the reference BEFORE dedup projection, so a stubbed quote
 * contributes its real content rather than the truncated preview and the
 * stub's prose marker. Never built by tag-stripping the rendered XML —
 * that leaked the instruction boilerplate into every reply-shaped query.
 */
export function referenceSearchText(ref: RenderableReference, embedText?: string): string {
  const pieces = [
    ref.content,
    ...ref.attachments
      .map(attachmentEnrichment)
      .filter((text): text is string => text !== undefined),
    ...(embedText !== undefined ? [embedText] : []),
  ];
  return pieces
    .map(piece => piece.trim())
    .filter(piece => piece.length > 0)
    .join('\n');
}
