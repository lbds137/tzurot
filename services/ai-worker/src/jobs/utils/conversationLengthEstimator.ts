/**
 * Conversation Length Estimator
 *
 * Functions for estimating the character/token length of formatted conversation messages.
 * Used by MemoryBudgetManager to calculate context window usage.
 * Extracted from conversationUtils.ts for better modularity.
 */

import {
  MessageRole,
  formatPromptTimestamp,
  type StoredReferencedMessage,
} from '@tzurot/common-types';
import type { RawHistoryEntry } from './conversationTypes.js';
import { isRoleMatch } from './participantUtils.js';

/**
 * Estimate character length for a stored reference
 */
function estimateReferenceLength(ref: StoredReferencedMessage): number {
  const authorName = ref.authorDisplayName || ref.authorUsername;
  let length =
    `<quote number="1" author="${authorName}" location="${ref.locationContext}">\n${ref.content}\n</quote>`
      .length;

  if (ref.embeds !== undefined && ref.embeds.length > 0) {
    length += `\n<embeds>${ref.embeds}</embeds>`.length;
  }

  if (ref.attachments !== undefined && ref.attachments.length > 0) {
    const attachmentItems = ref.attachments
      .map(att => `[${att.contentType}: ${att.name ?? 'attachment'}]`)
      .join(', ');
    length += `\n<attachments>${attachmentItems}</attachments>`.length;
  }

  if (ref.isForwarded === true) {
    length += ' forwarded="true"'.length;
  }

  return length;
}

/**
 * Result of resolving speaker name and role for length estimation
 */
interface SpeakerInfo {
  speakerName: string;
  role: 'user' | 'assistant';
  isUser: boolean;
}

/**
 * Resolve speaker name for length estimation, including disambiguation
 */
function resolveSpeakerForEstimation(
  msg: RawHistoryEntry,
  personalityName: string
): SpeakerInfo | null {
  const isUser = isRoleMatch(msg.role, MessageRole.User);
  const isAssistant = isRoleMatch(msg.role, MessageRole.Assistant);

  if (!isUser && !isAssistant) {
    return null;
  }

  const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';

  if (isUser) {
    let speakerName =
      msg.personaName !== undefined && msg.personaName.length > 0 ? msg.personaName : 'User';

    // Account for disambiguation when persona name matches personality name
    if (
      speakerName.toLowerCase() === personalityName.toLowerCase() &&
      msg.discordUsername !== undefined &&
      msg.discordUsername.length > 0
    ) {
      speakerName = `${speakerName} (@${msg.discordUsername})`;
    }
    return { speakerName, role, isUser: true };
  }

  // For assistant messages, use the AI personality's name from the message
  const speakerName =
    msg.personalityName !== undefined && msg.personalityName.length > 0
      ? msg.personalityName
      : personalityName;
  return { speakerName, role, isUser: false };
}

/**
 * Estimate length for referenced messages section
 */
function estimateReferencedMessagesLength(refs: StoredReferencedMessage[]): number {
  if (refs.length === 0) {
    return 0;
  }

  // Account for <quoted_messages> wrapper
  let length = '\n<quoted_messages>\n</quoted_messages>'.length;

  // Add length for each reference
  for (const ref of refs) {
    length += estimateReferenceLength(ref) + 1; // +1 for newline
  }

  return length;
}

/**
 * Estimate length for image descriptions section
 */
function estimateImageDescriptionsLength(
  images: NonNullable<RawHistoryEntry['messageMetadata']>['imageDescriptions']
): number {
  if (images === undefined || images.length === 0) {
    return 0;
  }

  // Account for <image_descriptions> wrapper
  let length = '\n<image_descriptions>\n</image_descriptions>'.length;

  // Add length for each image
  for (const img of images) {
    length += `<image filename="${img.filename}">${img.description}</image>\n`.length;
  }

  return length;
}

/**
 * Estimate length for embeds section
 */
function estimateEmbedsLength(embedsXml: string[] | undefined): number {
  if (embedsXml === undefined || embedsXml.length === 0) {
    return 0;
  }

  // Account for <embeds> wrapper
  let length = '\n<embeds>\n</embeds>'.length;

  // Add length for each embed XML
  for (const embedXml of embedsXml) {
    length += embedXml.length + 1; // +1 for newline
  }

  return length;
}

/**
 * Estimate length for voice transcripts section
 */
function estimateVoiceTranscriptsLength(transcripts: string[] | undefined): number {
  if (transcripts === undefined || transcripts.length === 0) {
    return 0;
  }

  // Account for <voice_transcripts> wrapper
  let length = '\n<voice_transcripts>\n</voice_transcripts>'.length;

  // Add length for each transcript
  for (const transcript of transcripts) {
    length += `<transcript>${transcript}</transcript>\n`.length;
  }

  return length;
}

/**
 * Estimate length for reactions section
 *
 * New format: one <reaction from="Name" from_id="uuid">emoji</reaction> per reactor
 */
function estimateReactionsLength(
  reactions: NonNullable<RawHistoryEntry['messageMetadata']>['reactions']
): number {
  if (reactions === undefined || reactions.length === 0) {
    return 0;
  }

  // Account for <reactions> wrapper
  let length = '\n<reactions>\n</reactions>'.length;

  // Add length for each reactor (one element per reactor, not per emoji)
  for (const reaction of reactions) {
    const customAttr = reaction.isCustom === true ? ' custom="true"' : '';
    for (const reactor of reaction.reactors) {
      const fromIdAttr =
        reactor.personaId !== undefined && reactor.personaId.length > 0
          ? ` from_id="${reactor.personaId}"`
          : '';
      length +=
        `<reaction from="${reactor.displayName}"${fromIdAttr}${customAttr}>${reaction.emoji}</reaction>\n`
          .length;
    }
  }

  return length;
}

/**
 * Get the character length of a formatted message (for budget estimation)
 *
 * Returns the character count of the message when formatted as XML.
 * To estimate tokens, divide by 4 (rough approximation: ~4 chars per token).
 *
 * @param msg - Raw history entry
 * @param personalityName - Name of the AI personality
 * @returns Character length of the formatted message
 */
export function getFormattedMessageCharLength(
  msg: RawHistoryEntry,
  personalityName: string
): number {
  const speaker = resolveSpeakerForEstimation(msg, personalityName);
  if (speaker === null) {
    return 0;
  }

  const { speakerName, role, isUser } = speaker;

  // Approximate the formatted length
  // Format: <message from="Name" from_id="persona-uuid" role="user|assistant" t="...">content</message>
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` t="${formatPromptTimestamp(msg.createdAt)}"`
      : '';

  // Account for from_id attribute (user messages with personaId)
  const fromIdAttr =
    isUser && msg.personaId !== undefined && msg.personaId.length > 0
      ? ` from_id="${msg.personaId}"`
      : '';

  const overhead =
    `<message from="${speakerName}"${fromIdAttr} role="${role}"${timeAttr}></message>`.length;
  let totalLength = overhead + msg.content.length;

  // Account for forwarded message wrapper
  // Forwarded content + attachments are wrapped: <quoted_messages>\n<quote type="forward" author="Unknown">content + attachments</quote>\n</quoted_messages>
  // The attachment lengths are calculated separately below, so we only add the wrapper overhead here
  if (msg.isForwarded === true && msg.content.length > 0) {
    totalLength +=
      '<quoted_messages>\n<quote type="forward" author="Unknown"></quote>\n</quoted_messages>'
        .length;
  }

  // Add length for metadata sections
  const metadata = msg.messageMetadata;
  if (metadata !== undefined) {
    if (isUser && metadata.referencedMessages !== undefined) {
      totalLength += estimateReferencedMessagesLength(metadata.referencedMessages);
    }
    totalLength += estimateImageDescriptionsLength(metadata.imageDescriptions);
    totalLength += estimateEmbedsLength(metadata.embedsXml);
    totalLength += estimateVoiceTranscriptsLength(metadata.voiceTranscripts);
    totalLength += estimateReactionsLength(metadata.reactions);
  }

  return totalLength;
}
