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
 */
// Prose marker — avoids literal tag syntax so it isn't escaped when it rides
// through escapeXmlContent inside <content>.
const DEDUP_PREFIX = '[Referenced message — full text in the chat log]';

/**
 * Variant used when the stub carries media enrichment. The extra clause is
 * load-bearing, not decoration: the chat-log copy of an embed or attachment
 * carries the raw URL, never a description, so media enrichment has no
 * counterpart there and "full text in the chat log" would send the model
 * somewhere the answer has never been.
 *
 * Conditional rather than unconditional so a text-only stub — the common case —
 * neither pays the tokens nor invites the model to hunt for media that isn't there.
 */
const DEDUP_PREFIX_WITH_MEDIA =
  '[Referenced message — full text in the chat log; its media is described here]';

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
 * Project a reference onto its deduplicated stub.
 *
 * SUBTRACTION from the canonical reference, never a field-by-field rebuild.
 * That is the whole point: its predecessor listed the fields it wanted and so
 * silently lost every field nobody remembered to list (the role, then the
 * attachments, then the forwarded flag). Here a field that does not appear
 * below is inherited, and adding a fourth exclusion is a conspicuous edit to
 * this function rather than an omission nobody can see.
 *
 * The exclusion set has exactly three members, and each has the same
 * justification — <chat_log> reproduces it verbatim, so the stub would be
 * paying twice:
 *
 * - `content` → the marker, plus a capped preview;
 * - `locationContext`;
 * - `embedsXml`.
 *
 * Media enrichment is deliberately NOT excluded. History renders an attachment
 * as its URL, so a description dropped here is enrichment that was computed,
 * paid for, and never reaches the model.
 */
export function dedupeReference(ref: RenderableReference): RenderableReference {
  const hasMedia = ref.attachments.some(att => {
    const enrichment = attachmentEnrichment(att);
    return enrichment !== undefined && enrichment.length > 0;
  });

  // No preview of OUR OWN persona's prior words: a fragment of the model's own
  // text is the "continue this" trigger, and the full line is in <chat_log>
  // regardless. Keyed on the rendered role rather than "was this authored by a
  // bot", which is a broader question with a different answer — it also
  // silenced third-party bots and proxy-relayed humans, neither of whom is the
  // model reading the prompt.
  const preview = ref.role === 'assistant' ? '' : capDedupText(ref.content);
  const prefix = hasMedia ? DEDUP_PREFIX_WITH_MEDIA : DEDUP_PREFIX;

  return {
    ...ref,
    content: preview.length > 0 ? `${prefix}\n\n${preview}` : prefix,
    locationContext: undefined,
    embedsXml: undefined,
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
