/**
 * XML Metadata Formatters
 *
 * Functions for formatting message metadata (quotes, images, embeds, voice, reactions)
 * as XML sections within conversation history messages.
 * Extracted from conversationUtils.ts for better modularity.
 */

import {
  escapeXml,
  escapeXmlContent,
  formatPromptTimestamp,
  type StoredReferencedMessage,
} from '@tzurot/common-types';
import { formatQuoteElement } from '../../services/prompt/QuoteFormatter.js';
import type { RawHistoryEntry } from './conversationTypes.js';

/**
 * Check if author name matches any AI personality (for role inference)
 */
function isAuthorAssistant(
  authorName: string,
  personalityName: string,
  allPersonalityNames?: Set<string>
): boolean {
  const authorLower = authorName.toLowerCase();
  if (authorLower.startsWith(personalityName.toLowerCase())) {
    return true;
  }
  if (allPersonalityNames === undefined) {
    return false;
  }
  for (const name of allPersonalityNames) {
    if (authorLower.startsWith(name.toLowerCase())) {
      return true;
    }
  }
  return false;
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
  const authorName = ref.authorDisplayName || ref.authorUsername;
  const role = isAuthorAssistant(authorName, personalityName, allPersonalityNames)
    ? 'assistant'
    : 'user';

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

  return formatQuoteElement({
    type: ref.isForwarded === true ? 'forward' : undefined,
    from: authorName,
    role,
    timeFormatted:
      ref.timestamp !== undefined && ref.timestamp.length > 0
        ? formatPromptTimestamp(ref.timestamp)
        : undefined,
    content: ref.content,
    locationContext,
    embedsXml: ref.embeds !== undefined && ref.embeds.length > 0 ? [ref.embeds] : undefined,
    attachmentLines:
      ref.attachments !== undefined && ref.attachments.length > 0
        ? ref.attachments.map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
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

  const refsToFormat =
    historyMessageIds !== undefined
      ? msg.messageMetadata.referencedMessages.filter(
          ref => !historyMessageIds.has(ref.discordMessageId)
        )
      : msg.messageMetadata.referencedMessages;

  if (refsToFormat.length === 0) {
    return '';
  }

  const formattedRefs = refsToFormat
    .map(ref => formatStoredReferencedMessage(ref, personalityName, allPersonalityNames))
    .join('\n');
  return `\n<quoted_messages>\n${formattedRefs}\n</quoted_messages>`;
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
