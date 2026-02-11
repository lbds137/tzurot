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

import { escapeXml, escapeXmlContent } from '@tzurot/common-types';

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
  /** Speaker role */
  role?: 'user' | 'assistant';
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
 * <quote [number="N"] [type="forward"] [from="Name"] [username="user"] [role="user|assistant"] [t="..."]>
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

  // Simple child sections — content is escaped; locationContext, embedsXml, and
  // attachmentLines are pre-formatted XML from trusted internal sources (bot-client
  // formatters, ReferencedMessageFormatter). Do NOT pass raw user input to those fields.
  addNonEmpty(parts, opts.content, c => `<content>${escapeXmlContent(c)}</content>`);
  addNonEmpty(parts, opts.locationContext, loc => loc);
  addArraySection(parts, opts.imageDescriptions, 'image_descriptions', imgs =>
    imgs.map(
      img =>
        `<image filename="${escapeXml(img.filename)}">${escapeXmlContent(img.description)}</image>`
    )
  );
  addArraySection(parts, opts.embedsXml, 'embeds', e => e);
  addArraySection(parts, opts.voiceTranscripts, 'voice_transcripts', ts =>
    ts.map(t => `<transcript>${escapeXmlContent(t)}</transcript>`)
  );
  addArraySection(parts, opts.attachmentLines, 'attachments', a => a);

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
