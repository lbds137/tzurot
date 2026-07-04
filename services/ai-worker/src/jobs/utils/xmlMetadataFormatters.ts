/**
 * XML Metadata Formatters
 *
 * Functions for formatting message metadata (quotes, images, embeds, voice, reactions)
 * as XML sections within conversation history messages.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatPromptTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import { capDedupText } from '@tzurot/common-types/utils/referenceEnrichment';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import { formatQuoteElement, formatDedupedQuote } from '../../services/prompt/QuoteFormatter.js';
import { deriveRefRole } from '../../services/prompt/referenceRole.js';
import type { RawHistoryEntry } from './conversationTypes.js';

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

  // If hydrated image descriptions exist, only show non-image attachments in attachmentLines
  const imageDescs = ref.resolvedImageDescriptions;
  const hasImageDescs = imageDescs !== undefined && imageDescs.length > 0;
  const attachmentsForLines = hasImageDescs
    ? ref.attachments?.filter(att => !att.contentType.startsWith('image/'))
    : ref.attachments;

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
    imageDescriptions: imageDescs,
    attachmentLines:
      attachmentsForLines !== undefined && attachmentsForLines.length > 0
        ? attachmentsForLines.map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
        : undefined,
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

  // Deduped refs: lightweight stubs with truncated content and reply-target note
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
    .map(t => `<transcript>${escapeXmlContent(t)}</transcript>`)
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
