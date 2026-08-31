/**
 * Conversation Utilities
 *
 * Core orchestration functions for processing and formatting conversation history.
 * Helper functions have been extracted to separate modules for better maintainability:
 * - participantUtils.ts: Participant extraction and role matching
 * - langchainConverter.ts: LangChain BaseMessage conversion
 * - xmlMetadataFormatters.ts: XML formatting for message metadata
 * - services/context/historyTokenMeasure.ts: Per-entry token cost (renders through here, so it
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
import { resolveSpeakerInfo, type ChatLogRole } from './participantUtils.js';
export { convertConversationHistory } from './langchainConverter.js';
export {
  StructuredHistoryEntry,
  InlineImageDescription,
  ResponderIdentity,
} from './conversationTypes.js';

// Import what we need internally
import type { StructuredHistoryEntry } from './conversationTypes.js';
import {
  formatQuotedSection,
  formatImageSection,
  formatEmbedsSection,
  formatVoiceSection,
  formatReactionsSection,
} from './xmlMetadataFormatters.js';

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
  metadata: StructuredHistoryEntry['messageMetadata']
): RenderableAttachment[] {
  return [
    ...(metadata?.imageDescriptions ?? []).map((img): RenderableAttachment => ({
      kind: 'image',
      filename: img.filename,
      description: img.description,
      source: img.source,
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

/**
 * The `from_id` attribute binding a chat-log line to a `<participants>` entry.
 *
 * Two id spaces feed one attribute: a human's line carries their persona UUID,
 * a SIBLING character's carries its personality UUID (the matching entry comes
 * from `renderCharacterParticipantElement`). The responder's OWN lines carry
 * none — the assistant role already says whose they are, and self is
 * deliberately absent from the roster, so an id here would point at nothing.
 *
 * Keyed on the RENDERED role rather than the raw one, so the roster and the log
 * cannot disagree: `resolveSpeakerInfo` is the single decider of who counts as
 * a sibling, and `extractCharacterParticipants` asks it the same question.
 */
function formatFromIdAttribute(msg: StructuredHistoryEntry, role: ChatLogRole): string {
  const fromId =
    role === 'user' ? msg.personaId : role === 'character' ? msg.personalityId : undefined;
  return fromId !== undefined && fromId.length > 0 ? ` from_id="${escapeXml(fromId)}"` : '';
}

/**
 * Options threaded into {@link renderHistoryEntryBody} — the auxiliary
 * dedup/collision inputs, shared verbatim with `formatSingleHistoryEntryAsXml`
 * and `RealMessagesBuilder` so both containers scope quote-dedup and name
 * collision identically over the SAME selected window.
 */
export interface HistoryEntryBodyOptions {
  personalityName: string;
  historyEntries?: Map<string, StructuredHistoryEntry>;
  allPersonalityNames?: Set<string>;
  responderPersonalityId?: string;
  /**
   * This turn's `realMessagesEnabled` value, captured once upstream
   * (`ContentBudgetManager.isRealMessagesEnabled`) and threaded down through
   * both containers this options type feeds (the XML path and
   * `RealMessagesBuilder`). Required rather than optional so a new call site
   * cannot silently fall back to reading the setting itself.
   */
  realMessagesEnabled: boolean;
}

/**
 * Render one history entry's BODY — everything a `<message>` element and a
 * real-message's content share: quoted/forwarded content, image/embed/voice
 * sections, and reactions. Deliberately excludes the XML-only envelope
 * (`from=`/`from_id=`/`role=`/`t=` attributes and the `<message>` wrapper),
 * which has no home on a real LangChain message — those stay in
 * `formatSingleHistoryEntryAsXml`, the ONLY caller that needs them.
 *
 * Single source of truth for the metadata-rich part of an entry's render:
 * extracted so the flag-gated real-message path (`RealMessagesBuilder`)
 * reuses this by calling it, never by re-deriving it — a second
 * implementation is exactly how a field (the quoted role, the forwarded flag)
 * went missing from one path before (see `RenderableReference.ts`'s history).
 *
 * Deliberate consequence: `escapeXmlContent`'s protected-tag escaping applies
 * in BOTH containers, so a literal `<chat_log>` typed by a user renders as
 * `&lt;chat_log&gt;` even in a real message with no enclosing XML document.
 * Accepted trade: the body embeds XML sub-fragments (quotes, attachments)
 * either way, and identical bytes across flag states is what the body-parity
 * test pins — un-escaping one container would fork the renderer this
 * extraction exists to unify.
 *
 * @param msg - Raw history entry to render
 * @param speakerInfo - This entry's resolved speaker (`resolveSpeakerInfo`'s
 *   result) — the caller resolves it once and passes it here AND uses it for
 *   its own envelope, so the two never disagree about who is speaking.
 * @param opts - The dedup/collision inputs (see {@link HistoryEntryBodyOptions}).
 * @returns The bare body string (no leading/trailing separator).
 */
export function renderHistoryEntryBody(
  msg: StructuredHistoryEntry,
  speakerInfo: { speakerName: string; role: ChatLogRole; normalizedRole: string },
  opts: HistoryEntryBodyOptions
): string {
  const {
    personalityName,
    historyEntries,
    allPersonalityNames,
    responderPersonalityId,
    realMessagesEnabled,
  } = opts;
  const { normalizedRole } = speakerInfo;

  // Escape content to prevent XML injection
  const safeContent = escapeXmlContent(msg.content);

  // Format metadata sections using helpers
  const quotedSection = formatQuotedSection({
    msg,
    normalizedRole,
    personalityName,
    historyEntries,
    allPersonalityNames,
    responderPersonalityId,
    realMessagesEnabled,
  });
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
      // authorPersonalityId, NOT authorId: from_id is an INTERNAL id the model
      // is told to match against the <participants> roster, so a Discord
      // snowflake there is an identity token that can never resolve.
      fromId: forwardedFrom?.authorPersonalityId,
      timeFormatted: promptTime(forwardedFrom?.timestamp),
      channel: forwardedFrom?.channelName,
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
  return `${formattedContent}${quotedSection}${messageLevelAttachments}${reactionsSection}`;
}

/**
 * Trailing options for {@link formatSingleHistoryEntryAsXml} — bundled into
 * one object rather than four positional parameters, because the function was
 * already at the five-parameter ceiling (`msg`, `personalityName`, plus these
 * four) and a plain new parameter would breach it. `personalityName` stays
 * positional (it is the caller's primary key, threaded everywhere), so it is
 * deliberately NOT duplicated into this type.
 */
export interface SingleHistoryEntryOptions {
  historyEntries?: Map<string, StructuredHistoryEntry>;
  allPersonalityNames?: Set<string>;
  responderPersonalityId?: string;
  /**
   * This turn's `realMessagesEnabled` value — see
   * {@link HistoryEntryBodyOptions.realMessagesEnabled}. Required for the
   * same reason: no call site may silently fall back to reading the setting.
   */
  realMessagesEnabled: boolean;
}

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
 * @param opts - Dedup/collision inputs plus this turn's `realMessagesEnabled`
 *   value (see {@link SingleHistoryEntryOptions}).
 * @returns Formatted XML string, or empty string if message should be skipped
 */
export function formatSingleHistoryEntryAsXml(
  msg: StructuredHistoryEntry,
  personalityName: string,
  opts: SingleHistoryEntryOptions
): string {
  const { historyEntries, allPersonalityNames, responderPersonalityId, realMessagesEnabled } = opts;
  const speakerInfo = resolveSpeakerInfo(
    msg,
    personalityName,
    allPersonalityNames,
    responderPersonalityId
  );
  if (speakerInfo === null) {
    return '';
  }

  const { speakerName, role } = speakerInfo;

  // Absolute-only timestamp: "YYYY-MM-DD (Day) HH:MM". Chat-log entries are
  // frozen content — a relative suffix (or the old 7-day format switch) would
  // re-render differently as time passes and silently break the provider
  // prompt-cache prefix at the oldest drifted message. Elapsed-time cues live
  // in the <time_gap> markers, which are inter-message deltas and stable.
  const timeAttr =
    msg.createdAt !== undefined && msg.createdAt.length > 0
      ? ` t="${escapeXml(formatAbsoluteTimestamp(msg.createdAt))}"`
      : '';

  // Escape speaker name for use in attribute (quotes could break the XML)
  const safeSpeaker = escapeXml(speakerName);

  const fromIdAttr = formatFromIdAttribute(msg, role);

  const body = renderHistoryEntryBody(msg, speakerInfo, {
    personalityName,
    historyEntries,
    allPersonalityNames,
    responderPersonalityId,
    realMessagesEnabled,
  });

  return `${HISTORY_ENTRY_OPEN}${safeSpeaker}"${fromIdAttr} role="${role}"${timeAttr}>${body}</message>`;
}

/**
 * Options for formatting conversation history as XML
 */
interface FormatConversationHistoryOptions {
  /** Configuration for time gap markers. If provided, gaps between messages will be marked. */
  timeGapConfig?: TimeGapConfig;
  /**
   * The RESPONDING personality's id. Decides self-vs-sibling exactly for rows
   * that carry their own `personalityId`, instead of comparing a name that was
   * stamped at write time and goes stale on a rename (see
   * `resolveAssistantRowRole`). Optional so a caller with no personality in
   * hand still renders — those rows fall back to the name comparison.
   */
  responderPersonalityId?: string;
  /**
   * This turn's `realMessagesEnabled` value. Optional (default `false`) so
   * legacy/test callers with no captured value keep rendering the flag-off
   * wording — production callers always thread the captured value (see
   * `HistoryEntryBodyOptions.realMessagesEnabled`).
   */
  realMessagesEnabled?: boolean;
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
export function buildHistoryEntryIndex(
  history: StructuredHistoryEntry[]
): Map<string, StructuredHistoryEntry> {
  const byDiscordId = new Map<string, StructuredHistoryEntry>();
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
export function buildHistoryMessageIdSet(history: StructuredHistoryEntry[]): Set<string> {
  return new Set(buildHistoryEntryIndex(history).keys());
}

/**
 * Collect all AI personality names from assistant messages
 * This enables multi-AI name collision detection (e.g., user "Lila" vs "Lila AI")
 * and sibling-persona quote demotion (see referenceRole.ts).
 */
export function collectPersonalityNames(
  history: StructuredHistoryEntry[],
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
  history: StructuredHistoryEntry[],
  personalityName: string,
  options?: FormatConversationHistoryOptions
): string {
  if (history.length === 0) {
    return '';
  }

  const historyEntries = buildHistoryEntryIndex(history);
  const allPersonalityNames = collectPersonalityNames(history, personalityName);
  const realMessagesEnabled = options?.realMessagesEnabled ?? false;

  const messages: string[] = [];
  let previousTimestamp: string | undefined;

  for (const msg of history) {
    // Check for time gap before this message
    if (options?.timeGapConfig !== undefined) {
      maybeAddTimeGapMarker(messages, previousTimestamp, msg.createdAt, options.timeGapConfig);
    }

    const formatted = formatSingleHistoryEntryAsXml(msg, personalityName, {
      historyEntries,
      allPersonalityNames,
      responderPersonalityId: options?.responderPersonalityId,
      realMessagesEnabled,
    });
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
 * Frames the `<prior_conversations>` block as background from OTHER channels.
 *
 * Every `<channel_history>` inside carries its own `<location>`, structurally
 * identical to the current channel's system-message location — so without this
 * framing the model has several equally-plausible "where am I" candidates and
 * picks by recency and position rather than by truth. Static text only: never
 * interpolate user content here (`instruction` is a protected tag precisely
 * because interpolation into it is a breakout surface).
 */
export const PRIOR_CONVERSATIONS_INSTRUCTION =
  'These are records of earlier conversations from OTHER channels, shown as background ' +
  'context. Each <location> inside this block describes where that past conversation ' +
  'took place — none of them is the channel you are responding in now. The current ' +
  "channel is named in <current_location> in the current message's context block.";

/**
 * The `<prior_conversations>` wrapper text without any channel content — for
 * token accounting, mirroring `getMemoryWrapperOverheadText`. Must stay in
 * lockstep with the render in {@link formatCrossChannelHistoryAsXml}, or the
 * budget under-counts by the instruction's tokens.
 */
export function getPriorConversationsWrapperOverheadText(): string {
  return `<prior_conversations>\n<instruction>${PRIOR_CONVERSATIONS_INSTRUCTION}</instruction>\n</prior_conversations>`;
}

/**
 * Format cross-channel conversation history as XML for inclusion in chat_log.
 *
 * Wraps all groups in `<prior_conversations>`, with each channel group in
 * `<channel_history>` containing a `<location>` block and formatted messages.
 *
 * @param groups - Cross-channel history groups (ordered by most recent channel first)
 * @param personalityName - Name of the AI personality (for message formatting)
 * @param realMessagesEnabled - This turn's captured flag value. Cross-channel
 *   history ALWAYS renders as XML, in both flag states — the flag only
 *   selects the dedup-stub WORDING inside it, so this is required (not
 *   defaulted) to keep that decision from silently reading stale/wrong state.
 * @returns Formatted XML string, or empty string if no groups
 */
export function formatCrossChannelHistoryAsXml(
  groups: CrossChannelHistoryGroupEntry[],
  personalityName: string,
  realMessagesEnabled: boolean,
  responderPersonalityId?: string
): string {
  if (groups.length === 0) {
    return '';
  }

  let hasContent = false;
  const parts: string[] = [
    '<prior_conversations>',
    `<instruction>${PRIOR_CONVERSATIONS_INSTRUCTION}</instruction>`,
  ];

  for (const group of groups) {
    if (group.messages.length === 0) {
      continue;
    }
    hasContent = true;
    parts.push('<channel_history>');
    parts.push(formatLocationAsXml(group.channelEnvironment, { scope: 'prior' }));
    const messagesXml = formatConversationHistoryAsXml(group.messages, personalityName, {
      responderPersonalityId,
      realMessagesEnabled,
    });
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
