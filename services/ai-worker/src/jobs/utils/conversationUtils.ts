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
  escapeXml,
  escapeXmlContent,
  shouldShowGap,
  calculateTimeGap,
  formatTimeGapMarker,
  type StoredReferencedMessage,
  type TimeGapConfig,
} from '@tzurot/common-types';

const logger = createLogger('conversationUtils');

/**
 * Check if a role matches the expected role (case-insensitive).
 * Handles legacy data that may have capitalized roles ("User", "Assistant")
 * vs the current standard lowercase roles from MessageRole enum.
 *
 * @param actual - The actual role value from data
 * @param expected - The expected role (from MessageRole enum)
 * @returns true if the roles match (case-insensitive)
 */
function isRoleMatch(actual: string | MessageRole, expected: MessageRole): boolean {
  const normalizedActual = String(actual).toLowerCase();
  const normalizedExpected = String(expected).toLowerCase();
  return normalizedActual === normalizedExpected;
}

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
      isRoleMatch(m.role, MessageRole.User) &&
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
      isRoleMatch(msg.role, MessageRole.User) &&
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
    if (isRoleMatch(msg.role, MessageRole.User)) {
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
    if (isRoleMatch(msg.role, MessageRole.Assistant)) {
      const parts: string[] = [];

      // Use the personality name (e.g., "Lilith")
      parts.push(`${personalityName}:`);

      if (msg.createdAt !== undefined && msg.createdAt.length > 0) {
        parts.push(`[${formatRelativeTime(msg.createdAt)}]`);
      }

      content = `${parts.join(' ')} ${msg.content}`;
    }

    if (isRoleMatch(msg.role, MessageRole.User)) {
      return new HumanMessage(content);
    } else if (isRoleMatch(msg.role, MessageRole.Assistant)) {
      return new AIMessage(content);
    } else {
      // System messages are handled separately in the prompt
      return new HumanMessage(content);
    }
  });
}

/**
 * Image description for inline display in chat_log
 */
export interface InlineImageDescription {
  filename: string;
  description: string;
}

/**
 * Raw conversation history entry (before BaseMessage conversion)
 */
export interface RawHistoryEntry {
  /** Internal message ID (database UUID) */
  id?: string;
  /**
   * Discord message IDs (snowflakes) for this message.
   * Array because long messages may be split into multiple Discord messages (chunks).
   * Used for quote deduplication: if a referenced message's Discord ID is in history,
   * we don't need to repeat it in quoted_messages.
   */
  discordMessageId?: string[];
  role: MessageRole | string;
  content: string;
  createdAt?: string;
  /** User's persona ID */
  personaId?: string;
  /** User's persona display name */
  personaName?: string;
  /** Discord username for disambiguation when persona name matches personality name */
  discordUsername?: string;
  tokenCount?: number;
  /** Whether this message was forwarded from another channel */
  isForwarded?: boolean;
  /** Structured metadata (referenced messages, attachments) - formatted at prompt time */
  messageMetadata?: {
    referencedMessages?: StoredReferencedMessage[];
    /** Image descriptions from extended context preprocessing */
    imageDescriptions?: InlineImageDescription[];
  };
  // AI personality info (for multi-AI channel attribution)
  /** The AI personality ID this message belongs to */
  personalityId?: string;
  /** The AI personality's display name (for assistant message attribution) */
  personalityName?: string;
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

  // Infer role from author name - if it matches ANY personality name, it's assistant
  // This ensures multi-AI channel messages are correctly attributed
  const authorLower = authorName.toLowerCase();
  let isAssistant = authorLower.startsWith(personalityName.toLowerCase());

  // Check against all personality names if provided
  if (!isAssistant && allPersonalityNames !== undefined) {
    for (const name of allPersonalityNames) {
      if (authorLower.startsWith(name.toLowerCase())) {
        isAssistant = true;
        break;
      }
    }
  }

  const role = isAssistant ? 'assistant' : 'user';

  // Format timestamp with both relative and absolute for consistency
  const timeAttr =
    ref.timestamp !== undefined && ref.timestamp.length > 0
      ? ` time="${escapeXml(formatRelativeTime(ref.timestamp))}" timestamp="${escapeXml(ref.timestamp)}"`
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

  // Use same <message> structure as regular messages, with quoted="true" attribute
  // Omit location (already in environment) and from_id (not available for historical refs)
  return `<message from="${safeAuthor}" role="${role}"${timeAttr}${forwardedAttr} quoted="true">${safeContent}${embedsSection}${attachmentsSection}</message>`;
}

/**
 * Resolve speaker name and role from a history entry
 * @param msg - The message to resolve
 * @param personalityName - Current AI personality name (fallback for assistant messages)
 * @param allPersonalityNames - Set of all AI personality names in the conversation (for collision detection)
 * @returns Speaker name and role, or null if message should be skipped
 */
function resolveSpeakerInfo(
  msg: RawHistoryEntry,
  personalityName: string,
  allPersonalityNames?: Set<string>
): { speakerName: string; role: 'user' | 'assistant'; normalizedRole: string } | null {
  const normalizedRole = String(msg.role).toLowerCase();

  if (normalizedRole === 'user') {
    // User message - use persona name if available
    let speakerName =
      msg.personaName !== undefined && msg.personaName.length > 0 ? msg.personaName : 'User';

    // Disambiguate when persona name matches ANY AI personality name in the conversation
    // This handles multi-AI channels where user "Lila" could be confused with "Lila AI"
    // Format: "Lila (@lbds137)" to make it clear who is who
    const speakerLower = speakerName.toLowerCase();
    const needsDisambiguation =
      speakerLower === personalityName.toLowerCase() ||
      (allPersonalityNames !== undefined &&
        Array.from(allPersonalityNames).some(name => name.toLowerCase() === speakerLower));

    if (
      needsDisambiguation &&
      msg.discordUsername !== undefined &&
      msg.discordUsername.length > 0
    ) {
      speakerName = `${speakerName} (@${msg.discordUsername})`;
    }

    return { speakerName, role: 'user', normalizedRole };
  }

  if (normalizedRole === 'assistant') {
    // For assistant messages, use the AI personality's name from the message
    // This enables correct attribution in multi-AI channels (e.g., COLD seeing Lila AI's messages)
    // Fall back to the current personalityName for legacy data without personalityName
    const speakerName =
      msg.personalityName !== undefined && msg.personalityName.length > 0
        ? msg.personalityName
        : personalityName;
    return { speakerName, role: 'assistant', normalizedRole };
  }

  // System or unknown - skip
  return null;
}

/**
 * Format a single history entry as XML
 *
 * This is the single source of truth for history message formatting.
 * Used by both formatConversationHistoryAsXml (for prompt generation) and
 * MemoryBudgetManager (for token counting).
 *
 * Format: <message from="Name" role="user|assistant" time="2m ago">content</message>
 *
 * When a user's persona name matches ANY AI personality name in the conversation
 * (e.g., user "Lila" in a channel with "Lila AI"), the user's name is disambiguated
 * as "Lila (@discordUsername)" to prevent confusion.
 *
 * @param msg - Raw history entry to format
 * @param personalityName - Name of the AI personality (for marking its own messages)
 * @param historyMessageIds - Optional set of Discord message IDs already in history (for quote deduplication)
 * @param allPersonalityNames - Optional set of all AI personality names in the conversation (for multi-AI collision detection)
 * @returns Formatted XML string, or empty string if message should be skipped
 */
export function formatSingleHistoryEntryAsXml(
  msg: RawHistoryEntry,
  personalityName: string,
  historyMessageIds?: Set<string>,
  allPersonalityNames?: Set<string>
): string {
  const speakerInfo = resolveSpeakerInfo(msg, personalityName, allPersonalityNames);
  if (speakerInfo === null) {
    return '';
  }

  const { speakerName, role, normalizedRole } = speakerInfo;

  // Format the timestamp with both relative and absolute (escape for use in attribute)
  // Relative: "3d ago" - easy for AI to understand temporal distance
  // Absolute: "2025-01-22T15:30:00.000Z" - precise for ordering verification
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` time="${escapeXml(formatRelativeTime(msg.createdAt))}" timestamp="${escapeXml(msg.createdAt)}"`
      : '';

  // Format forwarded attribute (for messages forwarded from another channel)
  const forwardedAttr = msg.isForwarded === true ? ' forwarded="true"' : '';

  // Escape content to prevent XML injection
  const safeContent = escapeXmlContent(msg.content);
  // Escape speaker name for use in attribute (quotes could break the XML)
  const safeSpeaker = escapeXml(speakerName);

  // Add from_id attribute for ID binding to participants (user messages only)
  // This links chat_log messages to <participant id="..."> definitions
  const fromIdAttr =
    normalizedRole === 'user' && msg.personaId !== undefined && msg.personaId.length > 0
      ? ` from_id="${escapeXml(msg.personaId)}"`
      : '';

  // Format referenced messages from messageMetadata (user messages only)
  // Skip quotes for messages already in conversation history (deduplication)
  let quotedSection = '';
  if (
    normalizedRole === 'user' &&
    msg.messageMetadata?.referencedMessages !== undefined &&
    msg.messageMetadata.referencedMessages.length > 0
  ) {
    // Filter out referenced messages that are already in conversation history
    const refsToFormat =
      historyMessageIds !== undefined
        ? msg.messageMetadata.referencedMessages.filter(
            ref => !historyMessageIds.has(ref.discordMessageId)
          )
        : msg.messageMetadata.referencedMessages;

    if (refsToFormat.length > 0) {
      const formattedRefs = refsToFormat
        .map(ref => formatStoredReferencedMessage(ref, personalityName, allPersonalityNames))
        .join('\n');
      quotedSection = `\n<quoted_messages>\n${formattedRefs}\n</quoted_messages>`;
    }
  }

  // Format image descriptions inline (from extended context preprocessing)
  let imageSection = '';
  if (
    msg.messageMetadata?.imageDescriptions !== undefined &&
    msg.messageMetadata.imageDescriptions.length > 0
  ) {
    const formattedImages = msg.messageMetadata.imageDescriptions
      .map(
        img =>
          `<image filename="${escapeXml(img.filename)}">${escapeXmlContent(img.description)}</image>`
      )
      .join('\n');
    imageSection = `\n<image_descriptions>\n${formattedImages}\n</image_descriptions>`;
  }

  // Format: <message from="Name" from_id="persona-uuid" role="user|assistant" time="2m ago" forwarded="true">content</message>
  // from_id links to <participant id="..."> for identity binding
  return `<message from="${safeSpeaker}"${fromIdAttr} role="${role}"${timeAttr}${forwardedAttr}>${safeContent}${quotedSection}${imageSection}</message>`;
}

/**
 * Options for formatting conversation history as XML
 */
export interface FormatConversationHistoryOptions {
  /** Configuration for time gap markers. If provided, gaps between messages will be marked. */
  timeGapConfig?: TimeGapConfig;
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
 * Quoted messages are deduplicated: if the quoted message is already in the
 * conversation history, it won't be repeated as a quote.
 *
 * When timeGapConfig is provided, significant time gaps between messages are marked
 * with <time_gap duration="X hours" /> elements to help the AI understand
 * temporal breaks in the conversation.
 *
 * @param history - Raw conversation history entries
 * @param personalityName - Name of the AI personality (for marking its own messages)
 * @param options - Optional formatting options including time gap configuration
 * @returns Formatted XML string for the chat_log section
 */
export function formatConversationHistoryAsXml(
  history: RawHistoryEntry[],
  personalityName: string,
  options?: FormatConversationHistoryOptions
): string {
  if (history.length === 0) {
    return '';
  }

  // Build set of Discord message IDs for quote deduplication
  // This prevents duplicating quoted content that's already in the conversation.
  // Uses discordMessageId (Discord snowflakes) NOT id (internal database UUIDs) because
  // referenced messages are identified by their Discord message ID.
  const historyMessageIds = new Set<string>();
  for (const msg of history) {
    // Each message may have multiple Discord IDs (for chunked messages)
    if (msg.discordMessageId !== undefined) {
      for (const discordId of msg.discordMessageId) {
        if (discordId.length > 0) {
          historyMessageIds.add(discordId);
        }
      }
    }
  }

  // Collect all AI personality names from assistant messages
  // This enables multi-AI name collision detection (e.g., user "Lila" vs "Lila AI")
  const allPersonalityNames = new Set<string>();
  allPersonalityNames.add(personalityName); // Always include current personality
  for (const msg of history) {
    if (
      String(msg.role).toLowerCase() === 'assistant' &&
      msg.personalityName !== undefined &&
      msg.personalityName.length > 0
    ) {
      allPersonalityNames.add(msg.personalityName);
    }
  }

  const messages: string[] = [];
  let previousTimestamp: string | undefined;

  for (const msg of history) {
    // Check for time gap before this message
    if (
      options?.timeGapConfig !== undefined &&
      previousTimestamp !== undefined &&
      msg.createdAt !== undefined
    ) {
      const gapMs = calculateTimeGap(previousTimestamp, msg.createdAt);
      if (shouldShowGap(gapMs, options.timeGapConfig)) {
        messages.push(formatTimeGapMarker(gapMs));
      }
    }

    const formatted = formatSingleHistoryEntryAsXml(
      msg,
      personalityName,
      historyMessageIds,
      allPersonalityNames
    );
    if (formatted.length > 0) {
      messages.push(formatted);
      // Update previous timestamp for next iteration
      if (msg.createdAt !== undefined) {
        previousTimestamp = msg.createdAt;
      }
    }
  }

  return messages.join('\n');
}

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
 * Get the character length of a formatted message (for budget estimation)
 *
 * Returns the character count of the message when formatted as XML.
 * To estimate tokens, divide by 4 (rough approximation: ~4 chars per token).
 *
 * @param msg - Raw history entry
 * @param personalityName - Name of the AI personality
 * @returns Character length of the formatted message
 */
// eslint-disable-next-line complexity -- Mirrors formatSingleHistoryEntryAsXml structure for accurate length estimation
export function getFormattedMessageCharLength(
  msg: RawHistoryEntry,
  personalityName: string
): number {
  // Determine the speaker name and role using case-insensitive matching
  const isUser = isRoleMatch(msg.role, MessageRole.User);
  const isAssistant = isRoleMatch(msg.role, MessageRole.Assistant);

  if (!isUser && !isAssistant) {
    return 0;
  }

  let speakerName: string;
  const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';

  if (isUser) {
    speakerName =
      msg.personaName !== undefined && msg.personaName.length > 0 ? msg.personaName : 'User';

    // Account for disambiguation when persona name matches personality name
    if (
      speakerName.toLowerCase() === personalityName.toLowerCase() &&
      msg.discordUsername !== undefined &&
      msg.discordUsername.length > 0
    ) {
      speakerName = `${speakerName} (@${msg.discordUsername})`;
    }
  } else {
    // For assistant messages, use the AI personality's name from the message
    // This enables correct attribution in multi-AI channels
    speakerName =
      msg.personalityName !== undefined && msg.personalityName.length > 0
        ? msg.personalityName
        : personalityName;
  }

  // Approximate the formatted length
  // Format: <message from="Name" from_id="persona-uuid" role="user|assistant" time="2m ago" timestamp="...">content</message>
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` time="${formatRelativeTime(msg.createdAt)}" timestamp="${msg.createdAt}"`
      : '';

  // Account for from_id attribute (user messages with personaId)
  const fromIdAttr =
    isUser && msg.personaId !== undefined && msg.personaId.length > 0
      ? ` from_id="${msg.personaId}"`
      : '';

  const overhead =
    `<message from="${speakerName}"${fromIdAttr} role="${role}"${timeAttr}></message>`.length;
  let totalLength = overhead + msg.content.length;

  // Add length for referenced messages if present (user messages only)
  if (
    isUser &&
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

  // Add length for image descriptions if present
  if (
    msg.messageMetadata?.imageDescriptions !== undefined &&
    msg.messageMetadata.imageDescriptions.length > 0
  ) {
    // Account for <image_descriptions> wrapper
    totalLength += '\n<image_descriptions>\n</image_descriptions>'.length;

    // Add length for each image
    for (const img of msg.messageMetadata.imageDescriptions) {
      totalLength += `<image filename="${img.filename}">${img.description}</image>\n`.length;
    }
  }

  return totalLength;
}
