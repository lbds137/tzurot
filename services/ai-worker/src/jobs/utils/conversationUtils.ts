/**
 * Conversation Utilities
 *
 * Helper functions for processing conversation history and participants
 */

import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  MessageRole,
  formatRelativeTime,
  createLogger,
  escapeXmlContent,
} from '@tzurot/common-types';

const logger = createLogger('conversationUtils');

/**
 * Participant information extracted from conversation history
 */
export interface Participant {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

/**
 * Extract unique participants from conversation history
 * Returns list of all personas involved in the conversation
 */
export function extractParticipants(
  history: {
    role: MessageRole;
    content: string;
    personaId?: string;
    personaName?: string;
  }[],
  activePersonaId?: string,
  activePersonaName?: string
): Participant[] {
  const uniquePersonas = new Map<string, string>(); // personaId -> personaName

  const userMessagesWithPersona = history.filter(
    m =>
      m.role === MessageRole.User &&
      m.personaId !== undefined &&
      m.personaId.length > 0 &&
      m.personaName !== undefined &&
      m.personaName.length > 0
  ).length;
  logger.debug(
    `[conversationUtils] Extracting participants: activePersonaId=${activePersonaId ?? 'undefined'}, activePersonaName=${activePersonaName ?? 'undefined'}, historyLength=${history.length}, userMessagesWithPersona=${userMessagesWithPersona}`
  );

  // Extract from history
  for (const msg of history) {
    if (
      msg.role === MessageRole.User &&
      msg.personaId !== undefined &&
      msg.personaId.length > 0 &&
      msg.personaName !== undefined &&
      msg.personaName.length > 0
    ) {
      uniquePersonas.set(msg.personaId, msg.personaName);
    }
  }

  // Ensure active persona is included (even if not in history yet)
  if (
    activePersonaId !== undefined &&
    activePersonaId.length > 0 &&
    activePersonaName !== undefined &&
    activePersonaName.length > 0
  ) {
    uniquePersonas.set(activePersonaId, activePersonaName);
  }

  // Single summary log instead of per-iteration logging
  if (uniquePersonas.size > 0) {
    const participantNames = Array.from(uniquePersonas.values()).join(', ');
    logger.debug(
      `[conversationUtils] Found ${uniquePersonas.size} participant(s): ${participantNames}`
    );
  }

  // Convert to array with isActive flag
  return Array.from(uniquePersonas.entries()).map(([personaId, personaName]) => ({
    personaId,
    personaName,
    isActive: personaId === activePersonaId,
  }));
}

/**
 * Convert simple conversation history to LangChain BaseMessage format
 * Includes persona names to help the AI understand who is speaking
 */
export function convertConversationHistory(
  history: {
    role: MessageRole;
    content: string;
    createdAt?: string;
    personaId?: string;
    personaName?: string;
  }[],
  personalityName: string
): BaseMessage[] {
  return history.map(msg => {
    // Format message with speaker name and timestamp
    let content = msg.content;

    // For user messages, include persona name and timestamp
    if (msg.role === MessageRole.User) {
      const parts: string[] = [];

      if (msg.personaName !== undefined && msg.personaName.length > 0) {
        parts.push(`${msg.personaName}:`);
      }

      if (msg.createdAt !== undefined && msg.createdAt.length > 0) {
        parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
      }

      if (parts.length > 0) {
        content = `${parts.join(' ')} ${msg.content}`;
      }
    }

    // For assistant messages, include personality name and timestamp
    if (msg.role === MessageRole.Assistant) {
      const parts: string[] = [];

      // Use the personality name (e.g., "Lilith")
      parts.push(`${personalityName}:`);

      if (msg.createdAt !== undefined && msg.createdAt.length > 0) {
        parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
      }

      content = `${parts.join(' ')} ${msg.content}`;
    }

    if (msg.role === MessageRole.User) {
      return new HumanMessage(content);
    } else if (msg.role === MessageRole.Assistant) {
      return new AIMessage(content);
    } else {
      // System messages are handled separately in the prompt
      return new HumanMessage(content);
    }
  });
}

/**
 * Stored referenced message (from messageMetadata JSONB column)
 */
export interface StoredReference {
  discordMessageId: string;
  authorUsername: string;
  authorDisplayName: string;
  content: string;
  embeds?: string;
  timestamp: string;
  locationContext: string;
  attachments?: {
    url: string;
    contentType: string;
    name?: string;
    size?: number;
  }[];
  isForwarded?: boolean;
}

/**
 * Raw conversation history entry (before BaseMessage conversion)
 */
export interface RawHistoryEntry {
  role: MessageRole | string;
  content: string;
  createdAt?: string;
  personaId?: string;
  personaName?: string;
  tokenCount?: number;
  /** Structured metadata (referenced messages, attachments) - formatted at prompt time */
  messageMetadata?: {
    referencedMessages?: StoredReference[];
  };
}

/**
 * Format a single stored reference as XML
 */
function formatStoredReference(ref: StoredReference, index: number): string {
  const authorName = ref.authorDisplayName || ref.authorUsername;
  const safeAuthor = escapeXmlContent(authorName);
  const safeContent = escapeXmlContent(ref.content);
  const safeLocation = escapeXmlContent(ref.locationContext);

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

  // Forwarded messages have limited author info
  const forwardedAttr = ref.isForwarded === true ? ' forwarded="true"' : '';

  return `<quote number="${index + 1}" author="${safeAuthor}" location="${safeLocation}"${forwardedAttr}>
${safeContent}${embedsSection}${attachmentsSection}
</quote>`;
}

/**
 * Format conversation history as XML for inclusion in system prompt
 *
 * Uses semantic XML structure with <message> tags for each message.
 * This format helps LLMs clearly distinguish between different speakers
 * and prevents identity bleeding where the AI responds as another participant.
 *
 * For user messages with referenced messages (replies, message links), the references
 * are included as nested <quoted_messages> elements within the message.
 *
 * @param history - Raw conversation history entries
 * @param personalityName - Name of the AI personality (for marking its own messages)
 * @returns Formatted XML string for the chat_log section
 */
export function formatConversationHistoryAsXml(
  history: RawHistoryEntry[],
  personalityName: string
): string {
  if (history.length === 0) {
    return '';
  }

  const messages: string[] = [];

  for (const msg of history) {
    // Determine the speaker name
    let speakerName: string;
    let role: 'user' | 'assistant';

    // Compare against string literals to handle both enum and string values
    if (msg.role === 'user') {
      // User message - use persona name if available
      speakerName =
        msg.personaName !== undefined && msg.personaName.length > 0 ? msg.personaName : 'User';
      role = 'user';
    } else if (msg.role === 'assistant') {
      // Assistant message - use personality name
      speakerName = personalityName;
      role = 'assistant';
    } else {
      // System or unknown - skip
      continue;
    }

    // Format the timestamp
    const timeAttr =
      msg.createdAt !== undefined && msg.createdAt.length > 0
        ? ` time="${formatRelativeTime(msg.createdAt)}"`
        : '';

    // Escape content to prevent XML injection
    const safeContent = escapeXmlContent(msg.content);

    // Format referenced messages from messageMetadata (user messages only)
    let quotedSection = '';
    if (
      msg.role === 'user' &&
      msg.messageMetadata?.referencedMessages !== undefined &&
      msg.messageMetadata.referencedMessages.length > 0
    ) {
      const formattedRefs = msg.messageMetadata.referencedMessages
        .map((ref, idx) => formatStoredReference(ref, idx))
        .join('\n');
      quotedSection = `\n<quoted_messages>\n${formattedRefs}\n</quoted_messages>`;
    }

    // Format: <message from="Name" role="user|assistant" time="2m ago">content</message>
    messages.push(
      `<message from="${speakerName}" role="${role}"${timeAttr}>${safeContent}${quotedSection}</message>`
    );
  }

  return messages.join('\n');
}

/**
 * Estimate character length for a stored reference
 */
function estimateReferenceLength(ref: StoredReference): number {
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
 * Count tokens for a single formatted message (for budget calculation)
 *
 * @param msg - Raw history entry
 * @param personalityName - Name of the AI personality
 * @returns Estimated token count for the formatted message
 */
export function getFormattedMessageLength(msg: RawHistoryEntry, personalityName: string): number {
  // Determine the speaker name
  let speakerName: string;
  let role: 'user' | 'assistant';

  // Compare against string literals to handle both enum and string values
  if (msg.role === 'user') {
    speakerName =
      msg.personaName !== undefined && msg.personaName.length > 0 ? msg.personaName : 'User';
    role = 'user';
  } else if (msg.role === 'assistant') {
    speakerName = personalityName;
    role = 'assistant';
  } else {
    return 0;
  }

  // Approximate the formatted length
  // Format: <message from="Name" role="user|assistant" time="2m ago">content</message>
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` time="${formatRelativeTime(msg.createdAt)}"`
      : '';

  const overhead = `<message from="${speakerName}" role="${role}"${timeAttr}></message>`.length;
  let totalLength = overhead + msg.content.length;

  // Add length for referenced messages if present (user messages only)
  if (
    msg.role === 'user' &&
    msg.messageMetadata?.referencedMessages !== undefined &&
    msg.messageMetadata.referencedMessages.length > 0
  ) {
    // Account for <quoted_messages> wrapper
    totalLength += '\n<quoted_messages>\n</quoted_messages>'.length;

    // Add length for each reference
    for (const ref of msg.messageMetadata.referencedMessages) {
      totalLength += estimateReferenceLength(ref) + 1; // +1 for newline
    }
  }

  return totalLength;
}
