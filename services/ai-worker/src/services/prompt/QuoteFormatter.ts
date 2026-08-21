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
import { extractMessagePrefixName, stripDmPrefix } from '@tzurot/common-types/utils/discord';
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
  url: string;
  contentType?: string;
  name?: string;
  isVoiceMessage?: boolean;
  duration?: number;
}

/**
 * A rendered attachment together with the URL of the attachment it was built
 * from.
 *
 * The URL is NOT part of `RenderableAttachment` — the renderer does not draw
 * it, and the membership rule for that type is drawn-ness. It is carried
 * alongside because the description or transcript in `attachment` is expensive
 * work that has to be written down, and the durable copy needs a key. Keeping
 * the pair means the persisted text is read out of the very object the
 * renderer emits, rather than re-derived from the enrichment source — which is
 * how a persisted description and a rendered one stay the same string.
 */
export interface BuiltAttachment {
  url: string;
  attachment: RenderableAttachment;
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
): BuiltAttachment[] {
  return attachments.map((att): BuiltAttachment => {
    const identity = { filename: att.name, contentType: att.contentType };
    const found = describe(att);
    // Narrowed to a variable rather than tested inline per arm: a boolean flag
    // would not narrow `string | undefined` down to the union's `description: string`.
    const description = found !== undefined && found.length > 0 ? found : undefined;
    return { url: att.url, attachment: renderableFor(att, identity, description) };
  });
}

/** Pick the modality's arm — enriched, or naming its own absence. */
function renderableFor(
  att: AttachmentSource,
  identity: { filename?: string; contentType?: string },
  description: string | undefined
): RenderableAttachment {
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
  /**
   * Placeholder rendered as the `from=` attribute when `from` is undefined
   * (e.g. `'Unknown'` for a forward whose origin could not be resolved).
   * Deliberately a separate field: it is NEVER fed to the duplicate-attribution
   * comparison, so an unresolved identity cannot strip content that happens to
   * open with the placeholder's own text (`**Unknown:** …`).
   */
  fromFallback?: string;
  /** Author persona ID (UUID) */
  fromId?: string;
  /** Author username */
  username?: string;
  /** Speaker role: assistant (the responding persona's own line), character (a sibling persona), user (a person), or bot (other automation) */
  role?: RenderedQuoteRole;
  /**
   * Pre-formatted timestamp for the `t=""` attribute — always via
   * `formatPromptTimestamp` (quotes are volatile-tier content and keep the
   * relative form; `<chat_log>` messages use `formatAbsoluteTimestamp`).
   *
   * There used to be a second slot here (a `{absolute, relative}` pair rendered
   * as a `<time/>` child) that only the live paths filled, so the same quote
   * carried its timestamp as a child element or as an attribute depending on
   * which renderer reached it. One slot, one format.
   */
  timeFormatted?: string;
  /**
   * Name of the channel the ORIGINAL message was posted in (forwarded quotes
   * only). Absent renders no `channel=` attribute at all — it is never an
   * empty string or a placeholder. `ForwardedOrigin.channelName` enumerates
   * what absence covers; the short version is that its visibility gate fails
   * closed, so anything unverifiable arrives here as `undefined`.
   */
  channel?: string;
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
 * The content to render, with a leading bold `**Name:** ` opener removed when
 * the name it carries is EXACTLY the quote's own `from=` attribution.
 *
 * Strip only on exact match: the quote already attributes via `from=`, so a
 * matching prefix is pure duplication. On any mismatch the prefix is KEPT,
 * because it is then the only attribution the text carries — `from="Bot"` with
 * an `**Alice:**` opener means the bot relayed Alice, which is signal, not
 * noise. Every other case (no `from`, no prefix, a differently-cased name, a
 * name appearing mid-string) lands on the same mismatch arm, so the gate fails
 * safe by construction.
 *
 * Reaching for {@link extractMessagePrefixName} on arbitrary quote content is
 * safe BECAUSE the recovered name is only ever compared for equality, never
 * used as an attribution: a real user's typed `**foo:** bar` cannot be
 * mis-attributed here — it fails to match and renders unchanged.
 *
 * ACCEPTED RESIDUAL: a message whose author literally opened with their OWN
 * resolved name (`from="Alice"` + typed `**Alice:** …`) is indistinguishable
 * from a bot-inserted duplicate and gets stripped too. The cost is bounded —
 * the attribution survives in `from=`, only the stylistic self-signature is
 * lost — and the same bound covers old persisted rows whose `from` value is a
 * literal placeholder string, and replayed history whose stored `from` was
 * re-resolved to a different string than the one the live render used (a
 * rename or adapter difference can make a genuine self-signature coincide).
 * The inverse drift — a real bot-inserted duplicate whose producer-cased name
 * no longer equals `from=` — is merely left un-stripped, which is the
 * fail-safe direction this gate accepts everywhere; no case-parity between
 * the prefix producer and the `from=` producer is assumed or required.
 * Callers with an UNRESOLVED identity must not
 * synthesize a `from` value; pass `fromFallback` instead, which renders the
 * attribute without entering this comparison.
 *
 * Every claim above is pinned by the `duplicate attribution prefix` tests in
 * this module's colocated test file.
 */
function contentWithoutDuplicateAttribution(opts: QuoteElementOptions): string | undefined {
  const { content, from } = opts;
  if (content === undefined || from === undefined) {
    return content;
  }
  return extractMessagePrefixName(content) === from ? stripDmPrefix(content) : content;
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
    ['from', opts.from ?? opts.fromFallback],
    ['from_id', opts.fromId],
    ['username', opts.username],
    ['role', opts.role],
    ['t', opts.timeFormatted],
    ['channel', opts.channel],
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
  addNonEmpty(
    parts,
    contentWithoutDuplicateAttribution(opts),
    c => `<content>${escapeXmlContent(c)}</content>`
  );
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

/**
 * Identity of one piece of enrichment, for comparing across renderers: its text
 * AND the modality it came from.
 *
 * Keyed rather than compared as a bare string because the two modalities arrive
 * from different producers (vision and STT) and mean different things, so a
 * transcript that happens to read the same as a description is not the same
 * content — and the consequence of conflating them is an element silently
 * dropped as a duplicate of something it has nothing to do with. The separator is
 * NUL because neither producer can emit one, so no description can spoof another
 * modality's key the way a printable delimiter would allow.
 *
 * Filename is deliberately NOT part of the key, though it would make two
 * same-kind attachments with byte-identical descriptions distinguishable. It is
 * optional on `AttachmentIdentity` and never synthesized, so keying on it would
 * leave nameless attachments unkeyable — and it would make the match depend on
 * two producers agreeing on a filename, which is the correspondence class the
 * URL-keyed enrichment store was introduced to retire. The residual cost is that
 * such a pair subtracts together; they are duplicates of each other, and the
 * description they share is in the chat log either way.
 */
export function enrichmentKey(kind: RenderableAttachment['kind'], text: string): string {
  return `${kind}\u0000${text}`;
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
  /**
   * Display name of the message's ORIGINAL author, recovered at persist time
   * from `message_reference.message_id` (bot-client's `resolveForwardedOrigin`).
   * Undefined for rows written before that existed and for forwards whose
   * original could not be re-fetched — both fall back to `'Unknown'`.
   */
  from?: string;
  /** Discord id of the original author — a webhook id for a character. */
  fromId?: string;
  /**
   * Pre-formatted `t=""` value for the ORIGINAL post time, via `promptTime`.
   * Comes from the snapshot, which does carry a timestamp even though it
   * carries no author, so this can be present when `from` is not.
   */
  timeFormatted?: string;
  /**
   * Name of the channel the ORIGINAL message was posted in, recovered at
   * persist time from `message_reference.message_id` (bot-client's
   * `resolveForwardedOrigin`). Absent for a DM origin, a forwarder without
   * `ViewChannel` on the origin channel, a forwarder not resolvable from
   * cache, a private thread the forwarder has since been removed from, and
   * rows written before this field existed — all five fall back to no
   * `channel=` attribute.
   */
  channel?: string;
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
 *
 * `from` was once the hardcoded literal `'Unknown'`, on the reasoning that a
 * forward carries no author for its own content. That holds for Discord's
 * snapshot — which omits both `author` and `id` — but not for the forward as a
 * whole: `message_reference.message_id` resolves to the original, and
 * bot-client now persists what it finds. The literal survives only as the
 * fallback for rows that predate that and for originals that cannot be read.
 */
export function formatForwardedQuote(content: ForwardedMessageContent): string {
  return formatQuoteElement({
    type: 'forward',
    from: content.from,
    fromFallback: 'Unknown',
    fromId: content.fromId,
    timeFormatted: content.timeFormatted,
    channel: content.channel,
    content: content.textContent,
    embedsXml: content.embedsXml,
    attachments: content.attachments,
    legacyAttachmentLines: content.legacyAttachmentLines,
  });
}
