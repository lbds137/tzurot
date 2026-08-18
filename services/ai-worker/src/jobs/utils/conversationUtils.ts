/**
 * Conversation Utilities
 *
 * Core orchestration functions for processing and formatting conversation history.
 * Helper functions have been extracted to separate modules for better maintainability:
 * - participantUtils.ts: Participant extraction and role matching
 * - langchainConverter.ts: LangChain BaseMessage conversion
 * - xmlMetadataFormatters.ts: XML formatting for message metadata
 * - historyTokenMeasure.ts: Per-entry token cost (renders through here, so it
 *   imports from this module rather than the other way around)
 * - conversationTypes.ts: Shared type definitions
 */

import { type CrossChannelHistoryGroupEntry } from '@tzurot/common-types/types/schemas/message';
import { formatAbsoluteTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { formatLocationAsXml } from '@tzurot/common-types/utils/environmentFormatter';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import {
  shouldShowGap,
  calculateTimeGap,
  formatTimeGapMarker,
  type TimeGapConfig,
} from '@tzurot/common-types/utils/timeGap';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import {
  formatForwardedQuote,
  type RenderableAttachment,
} from '../../services/prompt/QuoteFormatter.js';
import { promptTime } from '../../services/prompt/RenderableReference.js';

// Re-export from extracted modules for backward compatibility
export { extractParticipants } from './participantUtils.js';
import { resolveSpeakerInfo } from './participantUtils.js';
export { convertConversationHistory } from './langchainConverter.js';
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
 * Format a single history entry as XML
 *
 * This is the single source of truth for history message formatting.
 * Used by both formatConversationHistoryAsXml (for prompt generation) and
 * MemoryBudgetManager (for token counting).
 *
 * Format: <message from="Name" role="user|assistant|character" time="2m ago">content</message>
 *
 * Role is relative to the responding personality — a sibling persona's
 * message renders as role="character" (see resolveSpeakerInfo).
 *
 * When a user's persona name matches ANY AI personality name in the conversation
 * (e.g., user "Lila" in a channel with "Lila AI"), the user's name is disambiguated
 * as "Lila (@discordUsername)" to prevent confusion.
 *
 * @param msg - Raw history entry to format
 * @param personalityName - Name of the AI personality (for marking its own messages)
 * @param historyEntries - Optional Discord-message-ID → history entry index. The
 *   key decides quote deduplication; the entry answers what the chat log already
 *   renders for a deduped quote, so the stub can subtract what would be a repeat.
 * @param allPersonalityNames - Optional set of all AI personality names in the conversation (for multi-AI collision detection)
 * @returns Formatted XML string, or empty string if message should be skipped
 */

/**
 * Adapt a forwarded message's persisted enrichment into renderable attachments.
 *
 * The two source arrays are the schema's own split — descriptions and transcripts
 * are stored separately — but they describe the same kind of thing, so they merge
 * into one ordered list here rather than staying two sections in the output.
 * Neither array carries a content type, and transcripts carry no filename either;
 * both are simply omitted rather than filled with a placeholder.
 */
function toRenderableAttachments(
  metadata: RawHistoryEntry['messageMetadata']
): RenderableAttachment[] {
  return [
    ...(metadata?.imageDescriptions ?? []).map((img): RenderableAttachment => ({
      kind: 'image',
      filename: img.filename,
      description: img.description,
    })),
    ...(metadata?.voiceTranscripts ?? []).map((transcript): RenderableAttachment => ({
      kind: 'voice',
      description: transcript,
    })),
  ];
}

/**
 * Opening literal of every chat-log entry this module emits. Exported so
 * consumers that split serialized history at entry boundaries (the
 * cache-observability hashes) stay compile-time coupled to the actual tag
 * shape — a rename here breaks them loudly instead of silently mis-locating
 * the boundary. Entry bodies are XML-escaped before interpolation, so the
 * literal cannot occur inside one (pinned by `cacheObservability.test.ts`).
 */
export const HISTORY_ENTRY_OPEN = '<message from="';

export function formatSingleHistoryEntryAsXml(
  msg: RawHistoryEntry,
  personalityName: string,
  historyEntries?: Map<string, RawHistoryEntry>,
  allPersonalityNames?: Set<string>
): string {
  const speakerInfo = resolveSpeakerInfo(msg, personalityName, allPersonalityNames);
  if (speakerInfo === null) {
    return '';
  }

  const { speakerName, role, normalizedRole } = speakerInfo;

  // Absolute-only timestamp: "YYYY-MM-DD (Day) HH:MM". Chat-log entries are
  // frozen content — a relative suffix (or the old 7-day format switch) would
  // re-render differently as time passes and silently break the provider
  // prompt-cache prefix at the oldest drifted message. Elapsed-time cues live
  // in the <time_gap> markers, which are inter-message deltas and stable.
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` t="${escapeXml(formatAbsoluteTimestamp(msg.createdAt))}"`
      : '';

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
    historyEntries,
    allPersonalityNames
  );
  const imageSection = formatImageSection(msg);
  const embedsSection = formatEmbedsSection(msg);
  // Assistant transcripts are suppressed inside formatVoiceSection — the rule
  // belongs with the renderer so `chatLogEnrichmentFor` gets the same answer.
  const voiceSection = formatVoiceSection(msg, normalizedRole);
  const reactionsSection = formatReactionsSection(msg);

  // For forwarded messages, use shared QuoteFormatter for consistency
  // with the message link path (ReferencedMessageFormatter)
  let formattedContent: string;
  let messageLevelAttachments: string;
  const forwardedAttachments = `${imageSection}${embedsSection}${voiceSection}`;
  // Use forwardedAttachmentLines as fallback only when no vision descriptions exist
  const forwardedAttachmentLines = msg.messageMetadata?.forwardedAttachmentLines;
  const hasAttachmentFallback =
    forwardedAttachmentLines !== undefined &&
    forwardedAttachmentLines.length > 0 &&
    imageSection.length === 0;
  if (
    msg.isForwarded === true &&
    (safeContent.length > 0 || forwardedAttachments.length > 0 || hasAttachmentFallback)
  ) {
    // Build ForwardedMessageContent from raw metadata (not pre-formatted helpers)
    // so the shared formatter produces consistent XML across both code paths
    // Attribution for the forwarded content itself. Discord's snapshot carries
    // neither author nor id, so these come from bot-client's persist-time
    // resolution of message_reference.message_id; each is independently
    // optional, and the formatter falls back to an unattributed quote.
    const forwardedFrom = msg.messageMetadata?.forwardedFrom;
    const forwardedQuote = formatForwardedQuote({
      from: forwardedFrom?.authorName,
      fromId: forwardedFrom?.authorId,
      timeFormatted: promptTime(forwardedFrom?.timestamp),
      textContent: msg.content,
      embedsXml: msg.messageMetadata?.embedsXml,
      attachments: toRenderableAttachments(msg.messageMetadata),
      // Persisted `[contentType: name]` strings — the one producer this refactor
      // cannot restructure, because the rows already exist. See
      // `QuoteElementOptions.legacyAttachmentLines`.
      legacyAttachmentLines: hasAttachmentFallback ? forwardedAttachmentLines : undefined,
    });
    formattedContent = `<quoted_messages>\n${forwardedQuote}\n</quoted_messages>`;
    // Attachments already included in quote, don't duplicate at message level
    messageLevelAttachments = '';
  } else {
    formattedContent = safeContent;
    messageLevelAttachments = `${imageSection}${embedsSection}${voiceSection}`;
  }

  // Reactions stay at message level (forwarder can react to their own forward)
  return `${HISTORY_ENTRY_OPEN}${safeSpeaker}"${fromIdAttr} role="${role}"${timeAttr}>${formattedContent}${quotedSection}${messageLevelAttachments}${reactionsSection}</message>`;
}

/**
 * Options for formatting conversation history as XML
 */
interface FormatConversationHistoryOptions {
  /** Configuration for time gap markers. If provided, gaps between messages will be marked. */
  timeGapConfig?: TimeGapConfig;
}

/**
 * Index history by Discord message ID for quote deduplication.
 *
 * Uses discordMessageId (Discord snowflakes) NOT id (internal database UUIDs)
 * because referenced messages are identified by their Discord message ID. A
 * chunked message carries several IDs and each one maps back to the same entry.
 *
 * The ENTRY rather than a bare ID because two different questions are asked of
 * this: whether a quote is already in the conversation (dedup), and what the
 * chat log renders for it (how much of the quote is then redundant). The second
 * needs the entry, and answering it by assumption is what let a stub print the
 * same vision description twice.
 */
export function buildHistoryEntryIndex(history: RawHistoryEntry[]): Map<string, RawHistoryEntry> {
  const byDiscordId = new Map<string, RawHistoryEntry>();
  for (const msg of history) {
    // Each message may have multiple Discord IDs (for chunked messages)
    if (msg.discordMessageId !== undefined) {
      for (const discordId of msg.discordMessageId) {
        if (discordId.length > 0) {
          byDiscordId.set(discordId, msg);
        }
      }
    }
  }
  return byDiscordId;
}

/**
 * Build set of Discord message IDs for quote deduplication.
 *
 * The ID-only projection of {@link buildHistoryEntryIndex}, for consumers that
 * genuinely only ask membership (the shipped-message set that filters
 * already-in-prompt memories). Delegating keeps one definition of which IDs a
 * history entry contributes.
 */
export function buildHistoryMessageIdSet(history: RawHistoryEntry[]): Set<string> {
  return new Set(buildHistoryEntryIndex(history).keys());
}

/**
 * Collect all AI personality names from assistant messages
 * This enables multi-AI name collision detection (e.g., user "Lila" vs "Lila AI")
 * and sibling-persona quote demotion (see referenceRole.ts).
 */
export function collectPersonalityNames(
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

  const historyEntries = buildHistoryEntryIndex(history);
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
      historyEntries,
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
 * Format cross-channel conversation history as XML for inclusion in chat_log.
 *
 * Wraps all groups in `<prior_conversations>`, with each channel group in
 * `<channel_history>` containing a `<location>` block and formatted messages.
 *
 * @param groups - Cross-channel history groups (ordered by most recent channel first)
 * @param personalityName - Name of the AI personality (for message formatting)
 * @returns Formatted XML string, or empty string if no groups
 */
export function formatCrossChannelHistoryAsXml(
  groups: CrossChannelHistoryGroupEntry[],
  personalityName: string
): string {
  if (groups.length === 0) {
    return '';
  }

  let hasContent = false;
  const parts: string[] = ['<prior_conversations>'];

  for (const group of groups) {
    if (group.messages.length === 0) {
      continue;
    }
    hasContent = true;
    parts.push('<channel_history>');
    parts.push(formatLocationAsXml(group.channelEnvironment));
    const messagesXml = formatConversationHistoryAsXml(group.messages, personalityName);
    if (messagesXml.length > 0) {
      parts.push(messagesXml);
    }
    parts.push('</channel_history>');
  }

  if (!hasContent) {
    return '';
  }

  parts.push('</prior_conversations>');
  return parts.join('\n');
}
