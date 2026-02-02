/* eslint-disable max-lines -- Large file, tracked in BACKLOG.md for future refactoring */
/**
 * Conversation Utilities
 *
 * Helper functions for processing conversation history and participants
 */

import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  MessageRole,
  formatRelativeTime,
  formatPromptTimestamp,
  createLogger,
  escapeXml,
  escapeXmlContent,
  shouldShowGap,
  calculateTimeGap,
  formatTimeGapMarker,
  type StoredReferencedMessage,
  type TimeGapConfig,
  type MessageReaction,
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

/** Format user message with persona name and timestamp */
function formatUserMessageContent(
  content: string,
  personaName: string | undefined,
  createdAt: string | undefined
): string {
  const parts: string[] = [];
  if (personaName !== undefined && personaName.length > 0) {
    parts.push(`${personaName}:`);
  }
  if (createdAt !== undefined && createdAt.length > 0) {
    parts.push(`[${formatRelativeTime(createdAt)}]`);
  }
  return parts.length > 0 ? `${parts.join(' ')} ${content}` : content;
}

/** Format assistant message with personality name and timestamp */
function formatAssistantMessageContent(
  content: string,
  personalityName: string,
  createdAt: string | undefined
): string {
  const parts: string[] = [`${personalityName}:`];
  if (createdAt !== undefined && createdAt.length > 0) {
    parts.push(`[${formatRelativeTime(createdAt)}]`);
  }
  return `${parts.join(' ')} ${content}`;
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
    if (isRoleMatch(msg.role, MessageRole.User)) {
      const content = formatUserMessageContent(msg.content, msg.personaName, msg.createdAt);
      return new HumanMessage(content);
    }
    if (isRoleMatch(msg.role, MessageRole.Assistant)) {
      const content = formatAssistantMessageContent(msg.content, personalityName, msg.createdAt);
      return new AIMessage(content);
    }
    // System messages are handled separately in the prompt
    return new HumanMessage(msg.content);
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
    /** Embed XML strings for extended context messages (already formatted by EmbedParser) */
    embedsXml?: string[];
    /** Voice transcripts for extended context messages */
    voiceTranscripts?: string[];
    /** Reactions on this message (emoji + who reacted) */
    reactions?: MessageReaction[];
  };
  // AI personality info (for multi-AI channel attribution)
  /** The AI personality ID this message belongs to */
  personalityId?: string;
  /** The AI personality's display name (for assistant message attribution) */
  personalityName?: string;
}

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

/** Format quoted messages section for XML output */
function formatQuotedSection(
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
function formatImageSection(msg: RawHistoryEntry): string {
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
function formatEmbedsSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.embedsXml === undefined) {
    return '';
  }
  if (msg.messageMetadata.embedsXml.length === 0) {
    return '';
  }
  return `\n<embeds>\n${msg.messageMetadata.embedsXml.join('\n')}\n</embeds>`;
}

/** Format voice transcripts section for XML output */
function formatVoiceSection(msg: RawHistoryEntry): string {
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

/** Format reactions section for XML output */
function formatReactionsSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.reactions === undefined) {
    return '';
  }
  if (msg.messageMetadata.reactions.length === 0) {
    return '';
  }

  const formattedReactions = msg.messageMetadata.reactions
    .map(reaction => {
      const emojiAttr = reaction.isCustom === true ? ' custom="true"' : '';
      const reactorNames = reaction.reactors.map(r => escapeXml(r.displayName)).join(', ');
      return `<reaction emoji="${escapeXml(reaction.emoji)}"${emojiAttr}>${reactorNames}</reaction>`;
    })
    .join('\n');
  return `\n<reactions>\n${formattedReactions}\n</reactions>`;
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

  // Format the timestamp with unified format (escape for use in attribute)
  // Format: "YYYY-MM-DD (Day) HH:MM • relative" - combines date, time, and relative in one token-efficient attribute
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` t="${escapeXml(formatPromptTimestamp(msg.createdAt))}"`
      : '';

  // Format forwarded attribute (for messages forwarded from another channel)
  const forwardedAttr = msg.isForwarded === true ? ' forwarded="true"' : '';

  // Escape content to prevent XML injection
  const safeContent = escapeXmlContent(msg.content);
  // Escape speaker name for use in attribute (quotes could break the XML)
  const safeSpeaker = escapeXml(speakerName);

  // Add from_id attribute for ID binding to participants (user messages only)
  const fromIdAttr =
    normalizedRole === 'user' && msg.personaId !== undefined && msg.personaId.length > 0
      ? ` from_id="${escapeXml(msg.personaId)}"`
      : '';

  // Format metadata sections using helpers
  const quotedSection = formatQuotedSection(
    msg,
    normalizedRole,
    personalityName,
    historyMessageIds,
    allPersonalityNames
  );
  const imageSection = formatImageSection(msg);
  const embedsSection = formatEmbedsSection(msg);
  const voiceSection = formatVoiceSection(msg);
  const reactionsSection = formatReactionsSection(msg);

  return `<message from="${safeSpeaker}"${fromIdAttr} role="${role}"${timeAttr}${forwardedAttr}>${safeContent}${quotedSection}${imageSection}${embedsSection}${voiceSection}${reactionsSection}</message>`;
}

/**
 * Options for formatting conversation history as XML
 */
export interface FormatConversationHistoryOptions {
  /** Configuration for time gap markers. If provided, gaps between messages will be marked. */
  timeGapConfig?: TimeGapConfig;
}

/**
 * Build set of Discord message IDs for quote deduplication
 * This prevents duplicating quoted content that's already in the conversation.
 * Uses discordMessageId (Discord snowflakes) NOT id (internal database UUIDs) because
 * referenced messages are identified by their Discord message ID.
 */
function buildHistoryMessageIdSet(history: RawHistoryEntry[]): Set<string> {
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
  return historyMessageIds;
}

/**
 * Collect all AI personality names from assistant messages
 * This enables multi-AI name collision detection (e.g., user "Lila" vs "Lila AI")
 */
function collectPersonalityNames(
  history: RawHistoryEntry[],
  currentPersonalityName: string
): Set<string> {
  const allPersonalityNames = new Set<string>();
  allPersonalityNames.add(currentPersonalityName); // Always include current personality
  for (const msg of history) {
    if (
      String(msg.role).toLowerCase() === 'assistant' &&
      msg.personalityName !== undefined &&
      msg.personalityName.length > 0
    ) {
      allPersonalityNames.add(msg.personalityName);
    }
  }
  return allPersonalityNames;
}

/**
 * Check for time gap and add marker if needed
 */
function maybeAddTimeGapMarker(
  messages: string[],
  previousTimestamp: string | undefined,
  currentTimestamp: string | undefined,
  timeGapConfig: NonNullable<FormatConversationHistoryOptions['timeGapConfig']>
): void {
  if (previousTimestamp !== undefined && currentTimestamp !== undefined) {
    const gapMs = calculateTimeGap(previousTimestamp, currentTimestamp);
    if (shouldShowGap(gapMs, timeGapConfig)) {
      messages.push(formatTimeGapMarker(gapMs));
    }
  }
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

  const historyMessageIds = buildHistoryMessageIdSet(history);
  const allPersonalityNames = collectPersonalityNames(history, personalityName);

  const messages: string[] = [];
  let previousTimestamp: string | undefined;

  for (const msg of history) {
    // Check for time gap before this message
    if (options?.timeGapConfig !== undefined) {
      maybeAddTimeGapMarker(messages, previousTimestamp, msg.createdAt, options.timeGapConfig);
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
 */
function estimateReactionsLength(
  reactions: NonNullable<RawHistoryEntry['messageMetadata']>['reactions']
): number {
  if (reactions === undefined || reactions.length === 0) {
    return 0;
  }

  // Account for <reactions> wrapper
  let length = '\n<reactions>\n</reactions>'.length;

  // Add length for each reaction
  for (const reaction of reactions) {
    const customAttr = reaction.isCustom === true ? ' custom="true"' : '';
    const reactorNames = reaction.reactors.map(r => r.displayName).join(', ');
    length += `<reaction emoji="${reaction.emoji}"${customAttr}>${reactorNames}</reaction>\n`
      .length;
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
