/**
 * RAG Utility Functions
 *
 * Pure utility functions for the Conversational RAG Service.
 * These functions have no dependencies on class instances and can be used standalone.
 */

import { AI_DEFAULTS } from '@tzurot/common-types/constants/ai';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { neutralizeWrapperClosingTags } from '@tzurot/common-types/utils/promptSanitizer';
import type { VisionDescriptionCache } from './VisionDescriptionCache.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { InlineImageDescription } from '../jobs/utils/conversationUtils.js';
import { hydrateStoredReferences } from './storedReferenceHydrator.js';

const logger = createLogger('RAGUtils');

/**
 * Bare placeholder descriptions that should be filtered from content.
 * These are generic type labels produced when processing fails completely.
 * Vision failure placeholders (`[Image … couldn't be processed …]`) are NOT
 * filtered — they tell the model an image was there and how to respond.
 */
const BARE_PLACEHOLDERS = new Set(['[image]', '[audio]', '[unsupported format]']);

/**
 * Extract content-only descriptions from processed attachments.
 *
 * Filters out placeholder descriptions (like `[image]` or `[audio]` when processing fails)
 * and returns only actual semantic content (vision descriptions, audio transcriptions).
 *
 * Used for:
 * - Memory search queries (semantic search needs actual content, not placeholders)
 * - Token counting (count only real content)
 * - Building message content (user sees actual descriptions)
 *
 * @param processedAttachments - Array of processed attachments
 * @returns Concatenated descriptions separated by double newlines, or empty string if none
 */
export function extractContentDescriptions(processedAttachments: ProcessedAttachment[]): string {
  if (processedAttachments.length === 0) {
    return '';
  }

  return processedAttachments
    .map(a => a.description)
    .filter(d => d.length > 0 && !BARE_PLACEHOLDERS.has(d))
    .join('\n\n');
}

/**
 * Build attachment descriptions for storage and display
 *
 * Formats processed attachments into human-readable descriptions with headers
 * indicating the type (Image, Audio, Voice message).
 *
 * Voice/audio transcripts are wrapped in `<voice_transcripts><transcript>...
 * </transcript></voice_transcripts>` so the LLM can unambiguously distinguish
 * the transcript from any other text in the message. Without this wrapping, a
 * voice message's transcript appearing under a `[Voice message: 5.2s]` header
 * was read as separately-typed user text and the model would reply that no
 * voice content was received.
 *
 * Wrapper tags are NOT in `PROTECTED_TAGS` because `escapeXmlContent` runs over
 * the full message content at chat_log emit time — protecting them would also
 * escape OUR wrapper, destroying its effect. Instead, `neutralizeWrapperClosingTags`
 * pre-escapes any literal `</transcript>` / `</voice_transcripts>` characters
 * the user might have spoken, so injection inside the transcript can't break
 * out of the wrapper.
 *
 * Image descriptions stay under their `[Image: filename]` header without
 * wrapping — image content isn't user-typed text, so the ambiguity that
 * motivates the voice wrapping doesn't apply.
 */
export function buildAttachmentDescriptions(
  processedAttachments: ProcessedAttachment[]
): string | undefined {
  if (processedAttachments.length === 0) {
    return undefined;
  }

  return processedAttachments
    .map(formatProcessedAttachmentEntry)
    .filter(s => s.length > 0)
    .join('\n\n');
}

function formatProcessedAttachmentEntry(a: ProcessedAttachment): string {
  if (a.type === AttachmentType.Image) {
    const name =
      a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment';
    return `[Image: ${name}]\n${a.description}`;
  }
  if (a.type === AttachmentType.Audio) {
    const header = buildAudioAttachmentHeader(a);
    const safeTranscript = neutralizeWrapperClosingTags(a.description);
    return `${header}\n<voice_transcripts><transcript>${safeTranscript}</transcript></voice_transcripts>`;
  }
  return '';
}

function buildAudioAttachmentHeader(a: ProcessedAttachment): string {
  if (
    a.metadata.isVoiceMessage === true &&
    a.metadata.duration !== undefined &&
    a.metadata.duration !== null &&
    a.metadata.duration > 0
  ) {
    return `[Voice message: ${a.metadata.duration.toFixed(1)}s]`;
  }
  const name =
    a.metadata.name !== undefined && a.metadata.name.length > 0 ? a.metadata.name : 'attachment';
  return `[Audio: ${name}]`;
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
function buildImageDescriptionMap(
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
      'Built image description map for inline display'
    );
  }

  return map;
}

/** Raw conversation history entry shape for injection */
export interface RawHistoryEntry {
  id?: string;
  discordMessageId?: string[];
  role: string;
  content: string;
  tokenCount?: number;
  messageMetadata?: {
    referencedMessages?: StoredReferencedMessage[];
    imageDescriptions?: InlineImageDescription[];
    [key: string]: unknown;
  };
}

/**
 * Find image descriptions for a history entry by matching against the image map.
 * Primary: match by entry.id (Discord snowflake for extended context messages)
 * Fallback: match by discordMessageId (for DB messages with UUID ids)
 */
function findDescriptionsForEntry(
  entry: RawHistoryEntry,
  imageMap: Map<string, InlineImageDescription[]>
): InlineImageDescription[] | undefined {
  // Primary: match by entry.id (Discord snowflake for extended context messages)
  if (entry.id !== undefined && entry.id.length > 0 && imageMap.has(entry.id)) {
    return imageMap.get(entry.id);
  }
  // Fallback: match by discordMessageId (for DB messages with UUID ids)
  if (entry.discordMessageId !== undefined) {
    for (const id of entry.discordMessageId) {
      if (id.length > 0 && imageMap.has(id)) {
        return imageMap.get(id);
      }
    }
  }
  return undefined;
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
    const descriptions = findDescriptionsForEntry(entry, imageMap);
    if (descriptions !== undefined && descriptions.length > 0) {
      entry.messageMetadata ??= {};
      entry.messageMetadata.imageDescriptions = descriptions;
      injectedCount++;
    }
  }

  if (injectedCount > 0) {
    logger.debug(
      { injectedCount },
      'Injected image descriptions into history entries for inline display'
    );
  }

  if (injectedCount === 0 && imageMap.size > 0) {
    const historyIds = history.map(e => ({ id: e.id, discordIds: e.discordMessageId }));
    const mapKeys = [...imageMap.keys()];
    logger.warn(
      { historyIds, mapKeys },
      'Image map had entries but no history matches — descriptions will not appear inline'
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
 * @param turnsToInclude How many turns (user+assistant pairs) to fold in. Defaults to
 *   AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS — the production value; callers pass nothing and
 *   get byte-identical behavior. The retrieval eval passes explicit counts to sweep the
 *   fold depth (3/5/8) without touching the production default.
 * @returns Formatted string of recent history, or undefined if no history
 */
export function extractRecentHistoryWindow(
  rawHistory?: { role: string; content: string; tokenCount?: number }[],
  turnsToInclude: number = AI_DEFAULTS.LTM_SEARCH_HISTORY_TURNS
): string | undefined {
  if (!rawHistory || rawHistory.length === 0) {
    return undefined;
  }

  // Guard the public contract: turnsToInclude <= 0 means "no fold". Without this,
  // `slice(-0)` (since -0 === 0) would return the ENTIRE history and a negative
  // count would slice from the front — both silently the OPPOSITE of the intent,
  // and a corrupted fold window would poison the retrieval re-baseline this param
  // exists to serve.
  if (turnsToInclude <= 0) {
    return undefined;
  }

  // Get the last N turns (each turn = 2 messages: user + assistant)
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
    { messageCount: recentMessages.length, turnCount: Math.ceil(recentMessages.length / 2) },
    'Extracted messages for LTM search context'
  );

  return formatted;
}

/** Count image and audio attachments for timeout calculation */
export function countMediaAttachments(attachments?: AttachmentMetadata[]): {
  imageCount: number;
  audioCount: number;
} {
  return {
    imageCount:
      attachments?.filter(a => a.contentType.startsWith('image/') && a.isVoiceMessage !== true)
        .length ?? 0,
    audioCount:
      attachments?.filter(a => a.contentType.startsWith('audio/') || a.isVoiceMessage === true)
        .length ?? 0,
  };
}

/**
 * Collect deduplicated image attachments from stored references in conversation history.
 * Used to warm the vision cache before hydration runs.
 */
function collectLinkedImageAttachments(
  rawHistory: RawHistoryEntry[] | undefined
): AttachmentMetadata[] {
  if (rawHistory === undefined) {
    return [];
  }

  const seen = new Set<string>();
  return rawHistory.flatMap(entry => {
    const refs = entry.messageMetadata?.referencedMessages ?? [];
    return refs.flatMap(ref => collectImageAttachmentsFromRef(ref, seen));
  });
}

/** Extract image attachments from a single stored reference, deduplicating by ID/URL */
function collectImageAttachmentsFromRef(
  ref: StoredReferencedMessage,
  seen: Set<string>
): AttachmentMetadata[] {
  if (ref.attachments === undefined || ref.attachments.length === 0) {
    return [];
  }

  const result: AttachmentMetadata[] = [];
  for (const att of ref.attachments) {
    if (!att.contentType.startsWith('image/')) {
      continue;
    }
    const key = att.id ?? att.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(att);
  }
  return result;
}

/**
 * Enrich conversation history with inline image descriptions and hydrated stored references.
 *
 * Pipeline:
 * 1. Inject image descriptions from extended context vision processing
 * 2. Warm vision cache for linked-message images (so hydrator finds them)
 * 3. Hydrate stored references with resolved persona names and vision cache lookups
 *
 * @param rawHistory Raw conversation history (mutated in-place)
 * @param extendedContextAttachments Preprocessed extended context image attachments
 * @param prisma Prisma client for persona batch resolution
 * @param visionCache Vision description cache for image lookups
 * @param processImagesFn Optional callback to process images through the vision pipeline
 */
export async function enrichConversationHistory(
  rawHistory: RawHistoryEntry[] | undefined,
  extendedContextAttachments: ProcessedAttachment[] | undefined,
  prisma: PrismaClient,
  visionCache: VisionDescriptionCache,
  processImagesFn?: (attachments: AttachmentMetadata[]) => Promise<unknown>
): Promise<void> {
  const imageDescriptionMap = buildImageDescriptionMap(extendedContextAttachments);
  injectImageDescriptions(rawHistory, imageDescriptionMap);

  // Warm vision cache for linked-message images before hydration
  if (processImagesFn !== undefined) {
    const linkedImages = collectLinkedImageAttachments(rawHistory);
    if (linkedImages.length > 0) {
      try {
        await processImagesFn(linkedImages);
        logger.debug(
          { imageCount: linkedImages.length },
          'Warmed vision cache for linked-message images'
        );
      } catch (error) {
        logger.warn(
          { err: error, imageCount: linkedImages.length },
          'Failed to warm vision cache for linked-message images — hydrator will use cache lookups only'
        );
      }
    }
  }

  await hydrateStoredReferences(rawHistory, prisma, visionCache);
}
