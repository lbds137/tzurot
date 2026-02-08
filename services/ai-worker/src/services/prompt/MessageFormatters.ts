/**
 * Message Formatters - Helper functions for building and formatting user messages.
 *
 * Handles speaker identification, attachment composition, and complex message parsing.
 * Extracted from PromptBuilder to reduce file size.
 */

import { escapeXml, escapeXmlContent } from '@tzurot/common-types';

/**
 * Build disambiguated display name when persona name matches personality name.
 *
 * When a user's persona name matches the AI personality name (e.g., both "Lila"),
 * the AI can get confused thinking it's talking to itself. This function applies
 * the same disambiguation format used in conversationUtils.ts for history messages:
 * "Lila (@discordUsername)".
 *
 * @param activePersonaName - User's persona display name
 * @param personalityName - AI personality's name
 * @param discordUsername - User's Discord username for disambiguation
 * @returns Disambiguated display name, or original if no collision
 */
export function buildDisambiguatedDisplayName(
  activePersonaName: string,
  personalityName: string | undefined,
  discordUsername: string | undefined
): string {
  const needsDisambiguation =
    personalityName !== undefined &&
    personalityName.length > 0 &&
    activePersonaName.toLowerCase() === personalityName.toLowerCase() &&
    discordUsername !== undefined &&
    discordUsername.length > 0;

  if (needsDisambiguation) {
    return `${activePersonaName} (@${discordUsername})`;
  }
  return activePersonaName;
}

/**
 * Build message content from user message and attachment descriptions.
 *
 * Combines user text with attachment descriptions (images, voice transcriptions).
 * For voice-only messages (no text), uses transcription as the primary message.
 */
export function buildMessageWithAttachments(
  userMessage: string,
  attachmentDescriptions: string
): string {
  const trimmedMessage = userMessage.trim();
  const hasDescriptions = attachmentDescriptions.length > 0;

  // Voice message with no text content - use only transcription
  if (trimmedMessage === 'Hello' && hasDescriptions) {
    return attachmentDescriptions;
  }
  // Text + attachments
  if (trimmedMessage.length > 0 && hasDescriptions) {
    return `${userMessage}\n\n${attachmentDescriptions}`;
  }
  // Attachments only (no user text)
  if (hasDescriptions) {
    return attachmentDescriptions;
  }
  // No attachments - return original message
  return userMessage;
}

/**
 * Wrap message content with speaker identification.
 *
 * Adds <from id="personaId">DisplayName</from> prefix for speaker identification.
 * This helps the LLM understand who is speaking in multi-user conversations.
 */
export function wrapWithSpeakerIdentification(
  safeContent: string,
  displayName: string,
  activePersonaId: string | undefined
): string {
  const safeSpeaker = escapeXmlContent(displayName);
  if (activePersonaId !== undefined && activePersonaId.length > 0) {
    const safeId = escapeXml(activePersonaId);
    return `<from id="${safeId}">${safeSpeaker}</from>\n\n${safeContent}`;
  }
  return `<from>${safeSpeaker}</from>\n\n${safeContent}`;
}

/** Message object with content, referenced message, and attachments */
export interface ComplexMessage {
  content?: string;
  referencedMessage?: { author?: string; content: string } | null;
  attachments?: { name?: string }[];
}

/**
 * Format content from a complex message object.
 * Returns the content string and optional reference/attachment metadata.
 */
export function formatComplexMessageContent(message: ComplexMessage): {
  content: string;
  refPrefix: string;
  attachmentSuffix: string;
} {
  let content = '';
  let refPrefix = '';
  let attachmentSuffix = '';

  if ('content' in message && message.content !== undefined) {
    content = message.content;
  }

  // Format reference context if available
  if (message.referencedMessage !== undefined && message.referencedMessage !== null) {
    const ref = message.referencedMessage;
    const author = ref.author !== undefined && ref.author.length > 0 ? ref.author : 'someone';
    refPrefix = `[Replying to ${author}: "${ref.content}"]\n`;
  }

  // Format attachments if present
  if (message.attachments !== undefined && Array.isArray(message.attachments)) {
    for (const attachment of message.attachments) {
      const name =
        attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'file';
      attachmentSuffix += `\n[Attachment: ${name}]`;
    }
  }

  return { content, refPrefix, attachmentSuffix };
}
