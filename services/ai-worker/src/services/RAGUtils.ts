/**
 * RAG Utility Functions
 *
 * Pure utility functions for the Conversational RAG Service.
 * These functions have no dependencies on class instances and can be used standalone.
 */

import { createLogger, AttachmentType, AI_DEFAULTS } from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { ParticipantInfo } from './ConversationalRAGService.js';
import type { InlineImageDescription } from '../jobs/utils/conversationUtils.js';

const logger = createLogger('RAGUtils');

/**
 * Maximum stop sequences allowed by Google/Gemini API.
 * Error says "from 1 (inclusive) to 17 (exclusive)", meaning max is 16.
 * We apply this limit universally since other providers have higher limits.
 */
const MAX_STOP_SEQUENCES = 16;

/**
 * Build attachment descriptions for storage and display
 *
 * Formats processed attachments into human-readable descriptions with headers
 * indicating the type (Image, Audio, Voice message).
 */
export function buildAttachmentDescriptions(
  processedAttachments: ProcessedAttachment[]
): string | undefined {
  if (processedAttachments.length === 0) {
    return undefined;
  }

  return processedAttachments
    .map(a => {
      let header = '';
      if (a.type === AttachmentType.Image) {
        header = `[Image: ${a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment'}]`;
      } else if (a.type === AttachmentType.Audio) {
        if (
          a.metadata.isVoiceMessage === true &&
          a.metadata.duration !== undefined &&
          a.metadata.duration !== null &&
          a.metadata.duration > 0
        ) {
          header = `[Voice message: ${a.metadata.duration.toFixed(1)}s]`;
        } else {
          header = `[Audio: ${a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment'}]`;
        }
      }
      return `${header}\n${a.description}`;
    })
    .join('\n\n');
}

/**
 * Generate stop sequences for LLM generation safety
 *
 * Stop sequences serve two critical purposes:
 * 1. **Hallucinated Turn Prevention**: Stop if the model starts a fake "user turn"
 *    (common failure mode in weaker/free-tier models that fail to emit stop tokens)
 * 2. **Identity Bleeding Prevention**: Stop if the model speaks as another participant
 *
 * Priority order (with 16-slot Gemini API limit):
 * - P1: XML end tag (</message>) - signals valid turn completion
 * - P2: Generic chat markers (User:, Human:) - catches hallucinated turns
 * - P3: Instruct format markers (###, <|user|>) - catches model-specific leaks
 * - P4: Self-labeling prevention (Assistant:, AI:)
 * - P5: Personality name - prevents self-quoting
 * - P6: Participant names - prevents speaking as users
 *
 * @param personalityName - Name of the AI personality
 * @param participantPersonas - Map of participant names to their persona info
 * @returns Array of stop sequences (max 16)
 */
export function generateStopSequences(
  personalityName: string,
  participantPersonas: Map<string, ParticipantInfo>
): string[] {
  // Priority 1: XML structure (2 slots)
  // </message> is the king - once generated, the turn is legally over
  // <message catches if model tries to start a new XML turn immediately
  const xmlStopSequences = ['</message>', '<message'];

  // Priority 2: Hallucinated turn prevention - PRIMARY defense (4 slots)
  // When weak models fail to stop, they revert to base instruct format (User:/Human:)
  // These are the most common culprits for the "two responses concatenated" bug
  const hallucinationPrimarySequences = [
    '\nUser:', // Most common hallucination pattern
    '\nHuman:', // Second most common
    'User:', // Backup without newline (bad formatting)
    'Human:', // Backup without newline
  ];

  // Priority 3: Instruct format markers (3 slots)
  // Catches model-specific chat template leaks
  const instructFormatSequences = [
    '###', // Llama/Mistral instruct format (### Instruction:, ### User:)
    '\nAssistant:', // Common self-labeling pattern
    '<|user|>', // ChatML format (Hermes, Yi)
  ];

  // Priority 4: Self-labeling prevention (1 slot)
  const selfLabelSequence = '\nAI:';

  // Priority 5: Personality name (1 slot)
  // Prevents AI from self-quoting in third person
  const personalityStopSequence = `\n${personalityName}:`;

  // Priority 6: Participant stop sequences (remaining slots)
  // Prevents speaking as users in the conversation
  const participantStopSequences = Array.from(participantPersonas.keys()).map(name => `\n${name}:`);

  // Calculate available slots for participants
  // Total budget: MAX_STOP_SEQUENCES (16)
  // Reserved: XML (2) + hallucination primary (4) + instruct (3) + self-label (1) + personality (1) = 11
  // Available for participants: 5
  const reservedCount =
    xmlStopSequences.length +
    hallucinationPrimarySequences.length +
    instructFormatSequences.length +
    1 + // selfLabelSequence
    1; // personalityStopSequence
  const availableForParticipants = MAX_STOP_SEQUENCES - reservedCount;

  // Truncate participants if necessary
  const truncatedParticipants = participantStopSequences.slice(0, availableForParticipants);
  const participantsTruncated = participantStopSequences.length - truncatedParticipants.length;

  // Combine in priority order (highest priority first)
  const stopSequences = [
    ...xmlStopSequences,
    ...hallucinationPrimarySequences,
    ...instructFormatSequences,
    selfLabelSequence,
    personalityStopSequence,
    ...truncatedParticipants,
  ];

  // Log summary
  logger.info(
    {
      count: stopSequences.length,
      maxAllowed: MAX_STOP_SEQUENCES,
      xmlCount: xmlStopSequences.length,
      hallucinationCount: hallucinationPrimarySequences.length,
      instructCount: instructFormatSequences.length,
      participantCount: participantStopSequences.length,
      participantsTruncated,
      participants: Array.from(participantPersonas.keys()),
      personalityName,
    },
    '[RAG] Generated stop sequences for hallucination and identity bleeding prevention'
  );

  return stopSequences;
}

/**
 * Build a map from Discord message ID to image descriptions
 *
 * This allows us to associate preprocessed image descriptions with their
 * source messages in the conversation history for inline display.
 *
 * @param attachments Preprocessed extended context attachments
 * @returns Map of Discord message ID to array of image descriptions
 */
export function buildImageDescriptionMap(
  attachments: ProcessedAttachment[] | undefined
): Map<string, InlineImageDescription[]> {
  const map = new Map<string, InlineImageDescription[]>();

  if (!attachments || attachments.length === 0) {
    return map;
  }

  for (const att of attachments) {
    const msgId = att.metadata.sourceDiscordMessageId;
    if (msgId === undefined || msgId.length === 0) {
      continue;
    }

    const existingList = map.get(msgId) ?? [];
    existingList.push({
      filename: att.metadata.name ?? 'image',
      description: att.description,
    });
    if (!map.has(msgId)) {
      map.set(msgId, existingList);
    }
  }

  if (map.size > 0) {
    logger.debug(
      { messageCount: map.size, totalImages: attachments.length },
      '[RAG] Built image description map for inline display'
    );
  }

  return map;
}

/** Raw conversation history entry shape for injection */
export interface RawHistoryEntry {
  id?: string;
  role: string;
  content: string;
  tokenCount?: number;
  messageMetadata?: {
    imageDescriptions?: InlineImageDescription[];
    [key: string]: unknown;
  };
}

/**
 * Inject image descriptions into conversation history entries
 *
 * Modifies history entries in-place to add imageDescriptions to their
 * messageMetadata. This enables inline display of image descriptions
 * within the chat_log rather than a separate section.
 *
 * @param history Raw conversation history (will be mutated)
 * @param imageMap Map of Discord message ID to image descriptions
 */
export function injectImageDescriptions(
  history: RawHistoryEntry[] | undefined,
  imageMap: Map<string, InlineImageDescription[]>
): void {
  if (!history || history.length === 0 || imageMap.size === 0) {
    return;
  }

  let injectedCount = 0;

  for (const entry of history) {
    // For extended context messages, entry.id IS the Discord message ID
    if (entry.id !== undefined && entry.id.length > 0 && imageMap.has(entry.id)) {
      const descriptions = imageMap.get(entry.id);
      if (descriptions !== undefined && descriptions.length > 0) {
        // Ensure messageMetadata exists
        entry.messageMetadata ??= {};
        entry.messageMetadata.imageDescriptions = descriptions;
        injectedCount++;
      }
    }
  }

  if (injectedCount > 0) {
    logger.info(
      { injectedCount },
      '[RAG] Injected image descriptions into history entries for inline display'
    );
  }
}

/**
 * Extract recent conversation history for context-aware LTM search
 *
 * Returns the last N conversation turns (user + assistant pairs) as a formatted string.
 * This helps resolve pronouns like "that", "it", "he" in the current message by
 * providing recent topic context to the embedding model.
 *
 * @param rawHistory The raw conversation history array
 * @returns Formatted string of recent history, or undefined if no history
 */
export function extractRecentHistoryWindow(
  rawHistory?: { role: string; content: string; tokenCount?: number }[]
): string | undefined {
  if (!rawHistory || rawHistory.length === 0) {
    return undefined;
  }

  // Get the last N turns (each turn = 2 messages: user + assistant)
  const turnsToInclude = AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS;
  const messagesToInclude = turnsToInclude * 2;

  // Take the last N messages (they're already in chronological order)
  const recentMessages = rawHistory.slice(-messagesToInclude);

  if (recentMessages.length === 0) {
    return undefined;
  }

  // Format as content only (no role labels) - role labels are noise for semantic search
  // The content itself is what matters for finding relevant memories
  const formatted = recentMessages
    .map(msg => {
      // Truncate very long messages to avoid bloating the search query
      // Use LTM_SEARCH_MESSAGE_PREVIEW (500) instead of LOG_PREVIEW (150) for better semantic context
      return msg.content.length > AI_DEFAULTS.LTM_SEARCH_MESSAGE_PREVIEW
        ? msg.content.substring(0, AI_DEFAULTS.LTM_SEARCH_MESSAGE_PREVIEW) + '...'
        : msg.content;
    })
    .join('\n');

  logger.debug(
    `[RAG] Extracted ${recentMessages.length} messages (${Math.ceil(recentMessages.length / 2)} turns) for LTM search context`
  );

  return formatted;
}
