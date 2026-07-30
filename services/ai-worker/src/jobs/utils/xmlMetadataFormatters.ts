/**
 * XML Metadata Formatters
 *
 * Functions for formatting message metadata (quotes, images, embeds, voice, reactions)
 * as XML sections within conversation history messages.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatPromptTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import {
  escapeXmlContent,
  neutralizeWrapperClosingTags,
} from '@tzurot/common-types/utils/promptSanitizer';
import { capDedupText } from '@tzurot/common-types/utils/referenceEnrichment';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import { formatQuoteElement, formatDedupedQuote } from '../../services/prompt/QuoteFormatter.js';
import { deriveRefRole } from '../../services/prompt/referenceRole.js';
import type { RawHistoryEntry } from './conversationTypes.js';

/**
 * Split a stored reference's media into the two renderable shapes: hydrated
 * vision descriptions, and `[contentType: name]` markers for everything else.
 *
 * A described image renders as `<image_descriptions>` INSTEAD of a marker, so the
 * same picture never appears twice in two vocabularies. The suppression is
 * per-attachment, not per-reference: vision can resolve some of a message's
 * images and not others (failures are never persisted), and a whole-reference
 * gate would drop the undescribed one's marker too — leaving it with neither a
 * description nor a name, i.e. invisible. Every image ends up with exactly one
 * of the two representations.
 *
 * Correspondence is by filename because that is what `ResolvedImageDescription`
 * carries, and every producer derives it from the attachment's own `name` — so
 * the two agree by construction. The nameless fallback must be the producers'
 * `'image'`, NOT this function's marker fallback (`'attachment'`): a mismatch
 * there would fail the lookup and render a nameless image both ways. Two images
 * sharing a filename within one reference would over-suppress; Discord's own
 * naming makes that a non-case (`embed-image-1.png`, `embed-image-2.png`, …).
 *
 * Shared by the full and deduped branches on purpose. These two renderings drifted
 * once already (the deduped branch rendered neither, silently discarding every
 * `resolvedImageDescriptions` row `persistReferenceDescriptions` had written for
 * exactly this purpose); routing both through one splitter is what keeps them level.
 */
function splitStoredMedia(ref: StoredReferencedMessage): {
  imageDescriptions?: { filename: string; description: string }[];
  attachmentLines?: string[];
} {
  const imageDescs = ref.resolvedImageDescriptions;
  const hasImageDescs = imageDescs !== undefined && imageDescs.length > 0;
  const describedFilenames = new Set(imageDescs?.map(desc => desc.filename));
  const attachmentsForLines = ref.attachments?.filter(
    att => !att.contentType.startsWith('image/') || !describedFilenames.has(att.name ?? 'image')
  );

  return {
    imageDescriptions: hasImageDescs ? imageDescs : undefined,
    attachmentLines:
      attachmentsForLines !== undefined && attachmentsForLines.length > 0
        ? attachmentsForLines.map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
        : undefined,
  };
}

/**
 * Format a single stored reference as a <quote> element.
 *
 * Uses the shared formatQuoteElement() for consistent XML structure across
 * all quote formatting paths (real-time refs, history refs, forwarded messages).
 *
 * @param ref - The stored referenced message
 * @param personalityName - Name of the active AI personality (to infer role)
 * @param allPersonalityNames - Optional set of all AI personality names in the conversation
 * @returns Formatted XML string
 */
function formatStoredReferencedMessage(
  ref: StoredReferencedMessage,
  personalityName: string,
  allPersonalityNames?: Set<string>
): string {
  // Use hydrated persona name if available, fall back to original Discord display name
  const authorName = ref.resolvedPersonaName ?? (ref.authorDisplayName || ref.authorUsername);
  const role = deriveRefRole(ref.authorRole, authorName, personalityName, allPersonalityNames);

  // Format location if present (should be XML formatted by bot-client using shared formatLocationAsXml)
  // Skip legacy Markdown format (from old stored data) - detectable by "**Server**" or
  // "This conversation is taking place" patterns that predate XML formatting
  let locationContext: string | undefined;
  if (
    ref.locationContext !== undefined &&
    ref.locationContext.length > 0 &&
    !ref.locationContext.includes('**Server**') &&
    !ref.locationContext.includes('This conversation is taking place')
  ) {
    locationContext = ref.locationContext;
  }

  const media = splitStoredMedia(ref);

  return formatQuoteElement({
    type: ref.isForwarded === true ? 'forward' : undefined,
    from: authorName,
    fromId: ref.resolvedPersonaId,
    role,
    timeFormatted:
      ref.timestamp !== undefined && ref.timestamp.length > 0
        ? formatPromptTimestamp(ref.timestamp)
        : undefined,
    content: ref.content,
    locationContext,
    embedsXml: ref.embeds !== undefined && ref.embeds.length > 0 ? [ref.embeds] : undefined,
    imageDescriptions: media.imageDescriptions,
    attachmentLines: media.attachmentLines,
  });
}

/** Format quoted messages section for XML output */
export function formatQuotedSection(
  msg: RawHistoryEntry,
  normalizedRole: string,
  personalityName: string,
  historyMessageIds: Set<string> | undefined,
  allPersonalityNames: Set<string> | undefined
): string {
  if (normalizedRole !== 'user') {
    return '';
  }
  if (msg.messageMetadata?.referencedMessages === undefined) {
    return '';
  }
  if (msg.messageMetadata.referencedMessages.length === 0) {
    return '';
  }

  const allRefs = msg.messageMetadata.referencedMessages;

  // Separate refs into full (not in history) and deduped (in history → lightweight stub)
  const fullRefs: StoredReferencedMessage[] = [];
  const dedupedRefs: StoredReferencedMessage[] = [];

  for (const ref of allRefs) {
    if (historyMessageIds?.has(ref.discordMessageId) === true) {
      dedupedRefs.push(ref);
    } else {
      fullRefs.push(ref);
    }
  }

  if (fullRefs.length === 0 && dedupedRefs.length === 0) {
    return '';
  }

  // Full refs: existing behavior
  const formattedFull = fullRefs.map(ref =>
    formatStoredReferencedMessage(ref, personalityName, allPersonalityNames)
  );

  // Deduped refs: lightweight stubs with truncated content and reply-target note.
  // Image DESCRIPTIONS still ride along — `persistReferenceDescriptions` writes
  // them onto the stored row precisely so a quoted image survives replay, and the
  // history entry the stub points at renders that image as a URL, not a
  // description. Attachment MARKERS are deliberately omitted: a marker names a
  // file the chat log already lists, which is the redundancy dedup exists to cut.
  //
  // No `voiceTranscripts` here, unlike the live path — not a dropped field. The
  // live path reads transcripts from in-memory preprocessing; a stored reference
  // has no persisted equivalent (`StoredReferencedMessage` carries
  // `resolvedImageDescriptions` and no audio counterpart), so there is nothing
  // to forward. Absence is a data gap, not an omission — passing something here
  // requires the schema to carry it first.
  const formattedDeduped = dedupedRefs.map(ref => {
    const authorName = ref.resolvedPersonaName ?? (ref.authorDisplayName || ref.authorUsername);
    const role = deriveRefRole(ref.authorRole, authorName, personalityName, allPersonalityNames);
    return formatDedupedQuote({
      from: authorName,
      role,
      timeFormatted:
        ref.timestamp !== undefined && ref.timestamp.length > 0
          ? formatPromptTimestamp(ref.timestamp)
          : undefined,
      // Cap the stored text preview HERE (the single truncation point) — formatDedupedQuote
      // renders as-is. Stored refs carry attachments separately (attachmentLines), so content
      // is text-only and safe to cap directly.
      content: capDedupText(ref.content),
      imageDescriptions: splitStoredMedia(ref).imageDescriptions,
    });
  });

  const allFormatted = [...formattedFull, ...formattedDeduped].join('\n');
  return `\n<quoted_messages>\n${allFormatted}\n</quoted_messages>`;
}

/** Format image descriptions section for XML output */
export function formatImageSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.imageDescriptions === undefined) {
    return '';
  }
  if (msg.messageMetadata.imageDescriptions.length === 0) {
    return '';
  }

  const formattedImages = msg.messageMetadata.imageDescriptions
    .map(
      img =>
        `<image filename="${escapeXml(img.filename)}">${escapeXmlContent(img.description)}</image>`
    )
    .join('\n');
  return `\n<image_descriptions>\n${formattedImages}\n</image_descriptions>`;
}

/** Format embeds section for XML output */
export function formatEmbedsSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.embedsXml === undefined) {
    return '';
  }
  if (msg.messageMetadata.embedsXml.length === 0) {
    return '';
  }
  return `\n<embeds>\n${msg.messageMetadata.embedsXml.join('\n')}\n</embeds>`;
}

/** Format voice transcripts section for XML output */
export function formatVoiceSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.voiceTranscripts === undefined) {
    return '';
  }
  if (msg.messageMetadata.voiceTranscripts.length === 0) {
    return '';
  }

  const transcripts = msg.messageMetadata.voiceTranscripts
    // voice_transcripts/transcript aren't in PROTECTED_TAGS — neutralize the
    // wrapper closings so </transcript> in the text can't break out.
    .map(t => `<transcript>${neutralizeWrapperClosingTags(escapeXmlContent(t))}</transcript>`)
    .join('\n');
  return `\n<voice_transcripts>\n${transcripts}\n</voice_transcripts>`;
}

/**
 * Format reactions section for XML output
 *
 * Each reactor becomes a separate <reaction> element with from/from_id attributes
 * matching the message format for consistency. Emoji (or :custom_name:) is the content.
 *
 * Format: <reaction from="PersonaName" from_id="uuid">emoji</reaction>
 */
export function formatReactionsSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.reactions === undefined) {
    return '';
  }
  if (msg.messageMetadata.reactions.length === 0) {
    return '';
  }

  // Flatten reactions: one <reaction> element per reactor per emoji
  const formattedReactions: string[] = [];

  for (const reaction of msg.messageMetadata.reactions) {
    // Custom emoji attribute (for :name: format emojis)
    const customAttr = reaction.isCustom === true ? ' custom="true"' : '';
    const emojiContent = escapeXmlContent(reaction.emoji);

    // Each reactor gets their own <reaction> element
    for (const reactor of reaction.reactors) {
      const fromAttr = `from="${escapeXml(reactor.displayName)}"`;
      const fromIdAttr =
        reactor.personaId !== undefined && reactor.personaId.length > 0
          ? ` from_id="${escapeXml(reactor.personaId)}"`
          : '';
      formattedReactions.push(
        `<reaction ${fromAttr}${fromIdAttr}${customAttr}>${emojiContent}</reaction>`
      );
    }
  }

  if (formattedReactions.length === 0) {
    return '';
  }

  return `\n<reactions>\n${formattedReactions.join('\n')}\n</reactions>`;
}
