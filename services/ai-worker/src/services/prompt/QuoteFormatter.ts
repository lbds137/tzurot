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
 * The Discord-side fields an attachment must expose to be rendered. Structural
 * rather than `AttachmentMetadata` for the same reason `classifyAttachment` is —
 * this module stays free of the Discord schema.
 */
export interface AttachmentSource {
  contentType?: string;
  name?: string;
  isVoiceMessage?: boolean;
  duration?: number;
}

/**
 * Build one renderable element per attachment, pairing each with whatever
 * enrichment the caller can find for it.
 *
 * `describe` is the ONE thing that differs between producers: the live path
 * correlates preprocessing results by URL, the stored path correlates persisted
 * descriptions by filename. Everything after that — classify, pick the arm,
 * name the absence — was two copies of the same fifteen lines, and they had
 * already drifted once (see `classifyAttachment`). A miss returns the
 * modality's own "no enrichment" status rather than a bare element, so the
 * model can tell "we have no transcript" from "there was nothing here".
 *
 * Enrichment for an attachment that classifies as `file` is DROPPED, because
 * `RenderableFile` has no slot for it. That is a real (if rare) loss, so
 * callers pair this with a count check — see `warnOnDroppedEnrichment`.
 */
export function buildRenderableAttachments<T extends AttachmentSource>(
  attachments: readonly T[],
  describe: (attachment: T) => string | undefined
): RenderableAttachment[] {
  return attachments.map((att): RenderableAttachment => {
    const identity = { filename: att.name, contentType: att.contentType };
    const found = describe(att);
    // Narrowed to a variable rather than tested inline per arm: a boolean flag
    // would not narrow `string | undefined` down to the union's `description: string`.
    const description = found !== undefined && found.length > 0 ? found : undefined;
    switch (classifyAttachment(att)) {
      case 'image':
        return description !== undefined
          ? { kind: 'image', ...identity, description }
          : { kind: 'image', ...identity, status: 'undescribed' };
      case 'voice':
        return description !== undefined
          ? { kind: 'voice', ...identity, durationSeconds: att.duration, description }
          : { kind: 'voice', ...identity, durationSeconds: att.duration, status: 'untranscribed' };
      case 'file':
        return { kind: 'file', ...identity };
    }
  });
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
  /**
   * Pre-formatted timestamp for the `t=""` attribute — always via
   * `formatPromptTimestamp`, the same helper `<message>` uses in `<chat_log>`.
   *
   * There used to be a second slot here (a `{absolute, relative}` pair rendered
   * as a `<time/>` child) that only the live paths filled, so the same quote
   * carried its timestamp as a child element or as an attribute depending on
   * which renderer reached it. One slot, one format.
   */
  timeFormatted?: string;
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
 * Normalized content for a forwarded HISTORY MESSAGE.
 *
 * One consumer only: `conversationUtils.formatSingleHistoryEntryAsXml`, which
 * renders a forwarded message from its own persisted `messageMetadata`. It is
 * NOT a reference — there is no `ReferencedMessage` anywhere in that path — so
 * it cannot take a `RenderableReference`; it is a second, legitimate consumer
 * of the shared emitter.
 *
 * Forwarded *references* used to come through here too, which is why the author
 * is hardcoded: the wrapper had no author to render. That cost them their
 * reference number, role, username and location on every forwarded reply. They
 * now go through `renderReference`, which reads `isForwarded` as a field.
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
}

/**
 * Format a forwarded history message as a <quote type="forward"> element.
 * The forwarding message carries no author for the forwarded content itself,
 * so `from` is a literal here rather than a dropped field.
 */
export function formatForwardedQuote(content: ForwardedMessageContent): string {
  return formatQuoteElement({
    type: 'forward',
    from: 'Unknown',
    content: content.textContent,
    embedsXml: content.embedsXml,
    attachments: content.attachments,
    legacyAttachmentLines: content.legacyAttachmentLines,
  });
}
