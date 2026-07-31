/**
 * Quote Formatter
 *
 * Unified XML formatter for all quoted message types:
 * - Real-time references (ReferencedMessageFormatter) → <contextual_references>
 * - History references (xmlMetadataFormatters) → <quoted_messages>
 * - Forwarded messages (conversationUtils) → <quoted_messages>
 *
 * All paths produce consistent <quote> elements with the same attribute/child structure.
 * Wrapper tags (<contextual_references> vs <quoted_messages>) intentionally differ
 * to provide context about the quote source.
 */

import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { type RenderedQuoteRole } from './referenceRole.js';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';

/**
 * Fields every attachment carries regardless of modality.
 *
 * The shape is deliberately STRUCTURED rather than a pre-rendered line. A
 * producer that hands back `- Image (photo.png): a cat` has thrown away the
 * filename and the description as separate values, so every consumer downstream
 * can only paste the string somewhere — which is how the same attachment came
 * to render four different ways depending on which path reached it.
 */
interface AttachmentIdentity {
  /**
   * Original filename. OMITTED ENTIRELY when there is no real name — never
   * synthesized. A placeholder is worse than an absence here: filenames are
   * matched across producers (`error-screenshot-checkout.png` is often the only
   * signal an undescribed image has left), and two producers inventing
   * different placeholders is a correspondence bug waiting to happen.
   */
  filename?: string;
  /** Discord content type, when known. */
  contentType?: string;
}

/**
 * Enrichment is EITHER present OR explained — never both. Expressed as a union
 * with `never` arms so the contradiction ("here is the transcript, and also we
 * failed to transcribe it") cannot be constructed.
 */
type Enrichment<TStatus extends string> =
  { description: string; status?: never } | { description?: never; status?: TStatus };

/** An image, with its vision description when one arrived. */
export type RenderableImage = AttachmentIdentity & { kind: 'image' } & Enrichment<
    'undescribed' | 'expired' | 'unprocessed'
  >;

/** A voice message, with its transcript when one arrived. */
export type RenderableVoice = AttachmentIdentity & {
  kind: 'voice';
  /** Clip length in seconds, when known. */
  durationSeconds?: number;
} & Enrichment<'untranscribed' | 'expired' | 'unprocessed'>;

/** Any other attachment. Never carries enrichment — nothing describes a .zip. */
export interface RenderableFile extends AttachmentIdentity {
  kind: 'file';
  status?: 'unprocessed';
}

/**
 * One attachment, in the shape the prompt renders it.
 *
 * A discriminated union rather than one flat interface, so the invariants are
 * the compiler's to keep rather than a doc comment's: `durationSeconds` cannot
 * appear on an image, `description` cannot appear on a file (the renderer would
 * silently drop it), and a status cannot name the wrong modality's failure —
 * `untranscribed` on an image is now unwriteable.
 *
 * Absent enrichment is rendered EXPLICITLY via `status` rather than by
 * omission: a bare `<image filename="x.png"/>` leaves the model unable to tell
 * "vision failed" from "still processing" from "nothing worth describing", so
 * it invents one or apologises for a description that was never coming. Stated,
 * it can say the true thing. (`expired` is for the retention work's aged-out
 * case; `unprocessed` is the last-resort "something threw before we could
 * classify the failure".)
 */
export type RenderableAttachment = RenderableImage | RenderableVoice | RenderableFile;

/**
 * Which element an attachment renders as.
 *
 * Lives here, beside the vocabulary it returns, because BOTH producers need the
 * same answer and they had already drifted: the live path keyed voice on
 * `isVoiceMessage` alone while the stored path also accepted any `audio/*`, so
 * an ordinary music clip rendered `<file/>` in the turn it was posted and
 * `<voice status="untranscribed"/>` when the same attachment was replayed from
 * history. That is the exact "same object, different vocabulary per path" split
 * this whole shape exists to remove — reintroduced, one level down, by two
 * copies of a three-line rule.
 *
 * `isVoiceMessage` is the right discriminator and is available to both:
 * producers persist it on `attachmentMetadataSchema`, so the stored path never
 * needed a content-type fallback. An `audio/*` file WITHOUT the flag is someone
 * sharing a sound file, not a voice message, and calling it a failed
 * transcription tells the model something untrue.
 *
 * Structurally typed rather than taking `AttachmentMetadata` so this module
 * stays free of the Discord schema — the same trick `isBotAuthoredReference`
 * uses.
 */
export function classifyAttachment(attachment: {
  isVoiceMessage?: boolean;
  contentType?: string;
}): RenderableAttachment['kind'] {
  if (attachment.isVoiceMessage === true) {
    return 'voice';
  }
  if (attachment.contentType?.startsWith(CONTENT_TYPES.IMAGE_PREFIX) === true) {
    return 'image';
  }
  return 'file';
}

/**
 * Options for formatting a single <quote> element.
 * Callers populate the fields relevant to their context.
 */
export interface QuoteElementOptions {
  /** Reference number for [Reference N] (real-time refs only) */
  number?: number;
  /** Quote type (e.g., 'forward') */
  type?: 'forward';
  /** Author display name */
  from?: string;
  /** Author persona ID (UUID) */
  fromId?: string;
  /** Author username */
  username?: string;
  /** Speaker role: assistant (the responding persona's own line), character (a sibling persona), user (a person), or bot (other automation) */
  role?: RenderedQuoteRole;
  /** Pre-formatted timestamp string (for t="" attribute on <quote>) */
  timeFormatted?: string;
  /** Structured timestamp (for <time> child element) */
  timestamp?: { absolute: string; relative: string };
  /** Text content */
  content?: string;
  /** Location context XML (pre-formatted) */
  locationContext?: string;
  /** Pre-formatted embed XML strings */
  embedsXml?: string[];
  /** This quote's attachments — images, voice, files — with their enrichment. */
  attachments?: RenderableAttachment[];
  /**
   * Pre-rendered `[contentType: name]` marker strings, rendered verbatim inside
   * <attachments>.
   *
   * LEGACY, and deliberately named so. Its only caller is the forwarded-history
   * path, whose source (`messageMetadata.forwardedAttachmentLines`) is a
   * PERSISTED `string[]` — rows already in the database that cannot be
   * un-rendered back into `RenderableAttachment`s. Every other producer emits
   * structured attachments. Do not add a caller: the slot is the affordance
   * that let the vocabularies diverge, and it goes away once the producer
   * persists structure instead of strings.
   */
  legacyAttachmentLines?: string[];
}

/**
 * Format a single <quote> element with consistent structure.
 *
 * Output format:
 * ```xml
 * <quote [number="N"] [type="forward"] [from="Name"] [username="user"] [role="user|assistant|character|bot"] [t="..."]>
 *   <time absolute="..." relative="..."/>     (if timestamp provided)
 *   <content>text</content>                   (if content provided and non-empty)
 *   locationContext XML                        (if provided and non-empty)
 *   <embeds>...</embeds>
 *   <attachments>
 *     <image filename="cat.png">a cat asleep on a keyboard</image>
 *     <image filename="unlucky.png" status="undescribed"/>
 *     <voice filename="clip.ogg" duration="12s">hey, can you hear me</voice>
 *     <file filename="report.pdf" type="application/pdf"/>
 *   </attachments>
 * </quote>
 * ```
 *
 * Every attachment renders as ONE element under ONE wrapper, whether or not its
 * enrichment arrived. The alternative — a described image under
 * `<image_descriptions>` and an undescribed one under `<attachments>` — put the
 * same object in two unrelated vocabularies chosen by whether an API call
 * succeeded, and forced consumers to correlate the two halves by filename.
 */
export function formatQuoteElement(opts: QuoteElementOptions): string {
  // Build opening tag attributes (data-driven to reduce branching)
  const attrDefs: [string, string | number | undefined][] = [
    ['number', opts.number],
    ['type', opts.type],
    ['from', opts.from],
    ['from_id', opts.fromId],
    ['username', opts.username],
    ['role', opts.role],
    ['t', opts.timeFormatted],
  ];
  const attrs = attrDefs
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, val]) => `${key}="${typeof val === 'number' ? val : escapeXml(val)}"`)
    .join(' ');

  const parts: string[] = [`<quote${attrs.length > 0 ? ' ' + attrs : ''}>`];

  // Structured timestamp as child element
  if (opts.timestamp !== undefined) {
    const { absolute, relative } = opts.timestamp;
    if (absolute.length > 0 && relative.length > 0) {
      parts.push(`<time absolute="${escapeXml(absolute)}" relative="${escapeXml(relative)}"/>`);
    }
  }

  // Simple child sections. content and the attachment children carry
  // user-derived text and are escaped at emit. locationContext and embedsXml are
  // pre-formatted XML from trusted internal sources (ReferencedMessageFormatter;
  // bot-client's EmbedParser, which escapeXml's every embed field) — those two
  // are passed through verbatim; do NOT route raw user input through them.
  addNonEmpty(parts, opts.content, c => `<content>${escapeXmlContent(c)}</content>`);
  addNonEmpty(parts, opts.locationContext, loc => loc);
  addArraySection(parts, opts.embedsXml, 'embeds', e => e);
  // One <attachments> section for both producers. legacyAttachmentLines carry
  // unescaped filenames — escape so a crafted name can't close </attachments>
  // or </quote> and break out.
  const attachmentItems = [
    ...(opts.attachments ?? []).map(renderAttachment),
    ...(opts.legacyAttachmentLines ?? []).map(line => escapeXmlContent(line)),
  ];
  addArraySection(parts, attachmentItems, 'attachments', items => items);

  parts.push('</quote>');
  return parts.join('\n');
}

/**
 * Render one attachment as its per-modality element.
 *
 * The element name is written out per branch rather than interpolated from
 * `kind`. That is not verbosity for its own sake: `pnpm ops guard:prompt-tags`
 * finds emitted tags by scanning source for literal `<tag …>` forms, so a
 * `` `<${kind}…>` `` template would render three structural tags the guard
 * cannot see — a silent hole in exactly the check that decides whether user
 * content inside them gets escaped.
 */
export function renderAttachment(att: RenderableAttachment): string {
  switch (att.kind) {
    case 'image': {
      const attrs = joinAttrs([
        ['filename', att.filename],
        ['type', att.contentType],
        ['status', att.status],
      ]);
      const body = renderEnrichment(att.description);
      return body === undefined ? `<image${attrs}/>` : `<image${attrs}>${body}</image>`;
    }
    case 'voice': {
      const attrs = joinAttrs([
        ['filename', att.filename],
        ['type', att.contentType],
        ['duration', att.durationSeconds !== undefined ? `${att.durationSeconds}s` : undefined],
        ['status', att.status],
      ]);
      const body = renderEnrichment(att.description);
      return body === undefined ? `<voice${attrs}/>` : `<voice${attrs}>${body}</voice>`;
    }
    case 'file':
      return `<file${joinAttrs([
        ['filename', att.filename],
        ['type', att.contentType],
        ['status', att.status],
      ])}/>`;
  }
}

/**
 * The enrichment text an attachment carries, if any.
 *
 * Exists because the union deliberately gives `RenderableFile` no `description`
 * field — nothing describes a .zip — so consumers that want "whatever text this
 * attachment contributes" need one place that knows that, rather than each
 * re-deriving it and one of them eventually getting it wrong.
 */
export function attachmentEnrichment(att: RenderableAttachment): string | undefined {
  return att.kind === 'file' ? undefined : att.description;
}

/** Join defined attribute pairs into a leading-space attribute string. */
function joinAttrs(defs: [string, string | undefined][]): string {
  const list = defs
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, val]) => `${key}="${escapeXml(val)}"`)
    .join(' ');
  return list.length > 0 ? ` ${list}` : '';
}

/**
 * Escape an attachment's enrichment for use as element text. `image` and
 * `voice` are in PROTECTED_TAGS, so `escapeXmlContent` neutralizes a closing
 * form appearing inside a description or transcript.
 */
function renderEnrichment(description: string | undefined): string | undefined {
  return description !== undefined && description.length > 0
    ? escapeXmlContent(description)
    : undefined;
}

/** Append formatted string if value is defined and non-empty */
function addNonEmpty(parts: string[], value: string | undefined, fmt: (v: string) => string): void {
  if (value !== undefined && value.length > 0) {
    parts.push(fmt(value));
  }
}

/** Append a wrapped XML section if array is defined and non-empty */
function addArraySection<T>(
  parts: string[],
  items: T[] | undefined,
  tag: string,
  formatItems: (items: T[]) => string[]
): void {
  if (items !== undefined && items.length > 0) {
    parts.push(`<${tag}>\n${formatItems(items).join('\n')}\n</${tag}>`);
  }
}

/**
 * Normalized content for a forwarded message.
 * Both code paths build this DTO, then call formatForwardedQuote().
 */
export interface ForwardedMessageContent {
  /** Plain text content of the forwarded message */
  textContent?: string;
  /** Pre-formatted embed XML strings (callers must provide well-formed XML) */
  embedsXml?: string[];
  /** This message's attachments with their enrichment. */
  attachments?: RenderableAttachment[];
  /** Persisted marker strings — see `QuoteElementOptions.legacyAttachmentLines`. */
  legacyAttachmentLines?: string[];
  /** Timestamp with both absolute date and relative time */
  timestamp?: { absolute: string; relative: string };
}

/**
 * Format a forwarded message as a <quote> element.
 * Thin wrapper over formatQuoteElement() for the forwarded message use case.
 */
export function formatForwardedQuote(content: ForwardedMessageContent): string {
  return formatQuoteElement({
    type: 'forward',
    from: 'Unknown',
    timestamp: content.timestamp,
    content: content.textContent,
    embedsXml: content.embedsXml,
    attachments: content.attachments,
    legacyAttachmentLines: content.legacyAttachmentLines,
  });
}

/**
 * Prefix for deduplicated reference stubs. Order-agnostic (points to <chat_log>
 * rather than "above" — references are assembled BEFORE <chat_log>) and drops
 * the "reply target" Discord-UI jargon, which read as a task to the model.
 */
// Prose marker — avoids literal tag syntax so it isn't escaped when it rides
// through escapeXmlContent inside <content>.
const DEDUP_REPLY_TARGET_PREFIX = '[Referenced message — full text in the chat log]';

/**
 * Variant used when the stub carries media descriptions. The extra clause is
 * load-bearing, not decoration: the chat-log copy of an embed or attachment
 * carries the raw URL, never a description, so media enrichment has no
 * counterpart there and "full text in the chat log" would send the model
 * somewhere the answer has never been.
 *
 * Conditional rather than unconditional so a text-only stub — the common case —
 * neither pays the tokens nor invites the model to hunt for media that isn't there.
 */
const DEDUP_REPLY_TARGET_PREFIX_WITH_MEDIA =
  '[Referenced message — full text in the chat log; its media is described here]';

/**
 * Options for formatting a deduplicated reference stub.
 * Lightweight — no embeds or location context (both are reproduced verbatim in
 * <chat_log>), but media descriptions ARE carried: they exist nowhere else.
 */
export interface DedupedQuoteOptions {
  /** Reference number (real-time refs only) */
  number?: number;
  /** Author display name */
  from: string;
  /** Author username (real-time refs only) */
  username?: string;
  /** Speaker role — `assistant` (the responding persona's own line), `character` (a sibling persona), `user` (a person), `bot` (other automation). */
  role?: RenderedQuoteRole;
  /** Structured timestamp as child element */
  timestamp?: { absolute: string; relative: string };
  /** Pre-formatted timestamp as attribute */
  timeFormatted?: string;
  /** Original message content, already text-capped upstream (`buildDedupedReferenceStub`).
   *  Rendered as-is — NOT re-truncated here. Empty → marker-only stub. */
  content: string;
  /**
   * This reference's attachments with their enrichment. NOT redundant with the
   * <chat_log> copy: history renders an embed/attachment as its URL, so a
   * description dropped here is enrichment that was computed, paid for, and
   * never reaches the model. The stub's own `[image/png: name]` markers name
   * the file, not what is in it.
   */
  attachments?: RenderableAttachment[];
}

/**
 * Format a deduplicated reference as a lightweight <quote> stub. Renders the (already
 * text-capped, via `capDedupText` at the caller) content as-is and prepends the reply-target
 * note — does NOT truncate, so markers can't cannibalize the text preview.
 */
export function formatDedupedQuote(opts: DedupedQuoteOptions): string {
  // Do NOT truncate here. `opts.content` is already TEXT-capped upstream by
  // `buildDedupedReferenceStub` (it truncates the text to DEDUP_STUB_CONTENT, THEN prepends
  // the attachment markers). Re-applying the limit to the COMBINED markers+text let long
  // image-filename markers eat the whole budget, leaving a misleading 1-char text fragment
  // (e.g. `I...` for `I got myself off…`) that the model reads as an unfinished sentence.
  // The text is already bounded; the markers are short metadata that must survive intact.
  // Empty content (e.g. a bot's own reply-target) → marker only, no trailing blank.
  // The "its media is described here" clause is earned only by an attachment
  // that actually carries enrichment. An undescribed one still renders (it is
  // signal that something was attached), but pointing the model at a
  // description that does not exist is the failure the clause exists to avoid.
  const hasMedia = (opts.attachments ?? []).some(att => {
    const enrichment = attachmentEnrichment(att);
    return enrichment !== undefined && enrichment.length > 0;
  });
  const prefix = hasMedia ? DEDUP_REPLY_TARGET_PREFIX_WITH_MEDIA : DEDUP_REPLY_TARGET_PREFIX;
  const content = opts.content.length > 0 ? `${prefix}\n\n${opts.content}` : prefix;

  return formatQuoteElement({
    number: opts.number,
    from: opts.from,
    username: opts.username,
    role: opts.role,
    timestamp: opts.timestamp,
    timeFormatted: opts.timeFormatted,
    content,
    attachments: opts.attachments,
  });
}
