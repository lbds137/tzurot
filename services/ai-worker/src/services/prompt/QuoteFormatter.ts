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

import { type RenderedQuoteRole } from './referenceRole.js';
import {
  escapeXmlContent,
  neutralizeWrapperClosingTags,
} from '@tzurot/common-types/utils/promptSanitizer';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';

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
  /** Image descriptions */
  imageDescriptions?: { filename: string; description: string }[];
  /** Voice transcripts */
  voiceTranscripts?: string[];
  /** Pre-formatted attachment lines */
  attachmentLines?: string[];
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
 *   <image_descriptions>...</image_descriptions>
 *   <embeds>...</embeds>
 *   <voice_transcripts>...</voice_transcripts>
 *   <attachments>...</attachments>
 * </quote>
 * ```
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

  // Simple child sections. content/image-descriptions/attachmentLines carry
  // user-derived text and are escaped at emit. locationContext and embedsXml are
  // pre-formatted XML from trusted internal sources (ReferencedMessageFormatter;
  // bot-client's EmbedParser, which escapeXml's every embed field) — those two
  // are passed through verbatim; do NOT route raw user input through them.
  addNonEmpty(parts, opts.content, c => `<content>${escapeXmlContent(c)}</content>`);
  addNonEmpty(parts, opts.locationContext, loc => loc);
  addArraySection(parts, opts.imageDescriptions, 'image_descriptions', imgs =>
    imgs.map(
      img =>
        `<image filename="${escapeXml(img.filename)}">${escapeXmlContent(img.description)}</image>`
    )
  );
  addArraySection(parts, opts.embedsXml, 'embeds', e => e);
  // voice_transcripts/transcript are NOT in PROTECTED_TAGS (see promptSanitizer),
  // so escapeXmlContent alone leaves </transcript> live — neutralize the wrapper
  // closings the same way the current-turn audio path does.
  addArraySection(parts, opts.voiceTranscripts, 'voice_transcripts', ts =>
    ts.map(t => `<transcript>${neutralizeWrapperClosingTags(escapeXmlContent(t))}</transcript>`)
  );
  // attachmentLines carry unescaped filenames / transcriptions — escape so a
  // crafted name can't close </attachments>/</quote> and break out.
  addArraySection(parts, opts.attachmentLines, 'attachments', a =>
    a.map(line => escapeXmlContent(line))
  );

  parts.push('</quote>');
  return parts.join('\n');
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
  /** Image descriptions from vision processing */
  imageDescriptions?: { filename: string; description: string }[];
  /** Pre-formatted embed XML strings (callers must provide well-formed XML) */
  embedsXml?: string[];
  /** Voice message transcripts */
  voiceTranscripts?: string[];
  /** Pre-formatted attachment lines (non-image, non-voice) */
  attachmentLines?: string[];
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
    imageDescriptions: content.imageDescriptions,
    embedsXml: content.embedsXml,
    voiceTranscripts: content.voiceTranscripts,
    attachmentLines: content.attachmentLines,
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
   * Vision descriptions for this reference's images. NOT redundant with the
   * <chat_log> copy: history renders an embed/attachment as its URL, so a
   * description dropped here is enrichment that was computed, paid for, and
   * never reaches the model. The stub's own `[image/png: name]` markers name
   * the file, not what is in it.
   */
  imageDescriptions?: { filename: string; description: string }[];
  /** Voice transcripts for this reference's audio — same reasoning as `imageDescriptions`. */
  voiceTranscripts?: string[];
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
  const hasMedia =
    (opts.imageDescriptions?.length ?? 0) > 0 || (opts.voiceTranscripts?.length ?? 0) > 0;
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
    imageDescriptions: opts.imageDescriptions,
    voiceTranscripts: opts.voiceTranscripts,
  });
}
