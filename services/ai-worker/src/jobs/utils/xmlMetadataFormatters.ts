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
 * Format a single stored reference as XML
 *
 * Uses the same <message> structure as regular messages for consistency.
 * Adds quoted="true" attribute to distinguish from regular messages.
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
  const safeAuthor = escapeXml(authorName);
  const safeContent = escapeXmlContent(ref.content);
  const role = isAuthorAssistant(authorName, personalityName, allPersonalityNames)
    ? 'assistant'
    : 'user';

  // Format timestamp with unified format
  const timeAttr =
    ref.timestamp !== undefined && ref.timestamp.length > 0
      ? ` t="${escapeXml(formatPromptTimestamp(ref.timestamp))}"`
      : '';

  // Forwarded messages have limited author info
  const forwardedAttr = ref.isForwarded === true ? ' forwarded="true"' : '';

  // Format embeds if present
  let embedsSection = '';
  if (ref.embeds !== undefined && ref.embeds.length > 0) {
    embedsSection = `\n<embeds>${escapeXmlContent(ref.embeds)}</embeds>`;
  }

  // Format attachments if present (just metadata - descriptions were processed at the time)
  let attachmentsSection = '';
  if (ref.attachments !== undefined && ref.attachments.length > 0) {
    const attachmentItems = ref.attachments
      .map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
      .join(', ');
    attachmentsSection = `\n<attachments>${escapeXmlContent(attachmentItems)}</attachments>`;
  }

  // Format location if present (should be XML formatted by bot-client using shared formatLocationAsXml)
  // Skip legacy Markdown format (from old stored data) - detectable by "**Server**" or
  // "This conversation is taking place" patterns that predate XML formatting
  const locationSection =
    ref.locationContext !== undefined &&
    ref.locationContext.length > 0 &&
    !ref.locationContext.includes('**Server**') &&
    !ref.locationContext.includes('This conversation is taking place')
      ? `\n${ref.locationContext}`
      : '';

  // Use same <message> structure as regular messages, with quoted="true" attribute
  return `<message from="${safeAuthor}" role="${role}"${timeAttr}${forwardedAttr} quoted="true">${safeContent}${embedsSection}${attachmentsSection}${locationSection}</message>`;
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
