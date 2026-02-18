/**
 * RAG Utility Functions
 *
 * Pure utility functions for the Conversational RAG Service.
 * These functions have no dependencies on class instances and can be used standalone.
 */

import { createLogger, AttachmentType, AI_DEFAULTS } from '@tzurot/common-types';
import type {
  PrismaClient,
  VisionDescriptionCache,
  AttachmentMetadata,
  StoredReferencedMessage,
} from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { InlineImageDescription } from '../jobs/utils/conversationUtils.js';
import { hydrateStoredReferences } from './storedReferenceHydrator.js';

const logger = createLogger('RAGUtils');

/**
 * Bare placeholder descriptions that should be filtered from content.
 * These are generic type labels produced when processing fails completely.
 * Vision failure descriptions like `[Image unavailable: bad_request]` are NOT
 * filtered — they provide useful context about what was in the message.
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
 * Only XML structure stops. Name-based stops (personality name,
 * participant names) were removed (PR #659) because:
 * 1. XML prompt format makes them redundant (turns enclosed in <message> tags)
 * 2. Reasoning models generate these substrings mid-chain-of-thought (false positives)
 * 3. Name stops truncate reasoning before the actual response begins
 *
 * Note: Google Gemini API limits stop sequences to 16 max if this ever grows.
 */
export function generateStopSequences(): string[] {
  return ['</message>', '<message'];
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
    logger.info(
      { injectedCount },
      '[RAG] Injected image descriptions into history entries for inline display'
    );
  }

  if (injectedCount === 0 && imageMap.size > 0) {
    const historyIds = history.map(e => ({ id: e.id, discordIds: e.discordMessageId }));
    const mapKeys = [...imageMap.keys()];
    logger.warn(
      { historyIds, mapKeys },
      '[RAG] Image map had entries but no history matches — descriptions will not appear inline'
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
        logger.info(
          { imageCount: linkedImages.length },
          '[RAG] Warmed vision cache for linked-message images'
        );
      } catch (error) {
        logger.warn(
          { err: error, imageCount: linkedImages.length },
          '[RAG] Failed to warm vision cache for linked-message images — hydrator will use cache lookups only'
        );
      }
    }
  }

  await hydrateStoredReferences(rawHistory, prisma, visionCache);
}
