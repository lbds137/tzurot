/**
 * Conversation Utilities
 *
 * Core orchestration functions for processing and formatting conversation history.
 * Helper functions have been extracted to separate modules for better maintainability:
 * - participantUtils.ts: Participant extraction and role matching
 * - langchainConverter.ts: LangChain BaseMessage conversion
 * - xmlMetadataFormatters.ts: XML formatting for message metadata
 * - conversationLengthEstimator.ts: Character/token length estimation
 * - conversationTypes.ts: Shared type definitions
 */

import {
  escapeXml,
  escapeXmlContent,
  formatPromptTimestamp,
  shouldShowGap,
  calculateTimeGap,
  formatTimeGapMarker,
  type TimeGapConfig,
} from '@tzurot/common-types';

// Re-export from extracted modules for backward compatibility
export { Participant, extractParticipants, isRoleMatch } from './participantUtils.js';
export { convertConversationHistory } from './langchainConverter.js';
export {
  formatQuotedSection,
  formatImageSection,
  formatEmbedsSection,
  formatVoiceSection,
  formatReactionsSection,
} from './xmlMetadataFormatters.js';
export { getFormattedMessageCharLength } from './conversationLengthEstimator.js';
export { RawHistoryEntry, InlineImageDescription } from './conversationTypes.js';

// Import what we need internally
import type { RawHistoryEntry } from './conversationTypes.js';
import {
  formatQuotedSection,
  formatImageSection,
  formatEmbedsSection,
  formatVoiceSection,
  formatReactionsSection,
} from './xmlMetadataFormatters.js';

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
