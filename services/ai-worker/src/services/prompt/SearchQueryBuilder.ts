/**
 * Search Query Builder
 *
 * Builds search queries for memory retrieval from user messages,
 * attachments, references, and recent history context.
 */

import { createLogger } from '@tzurot/common-types';
import type { ProcessedAttachment } from '../MultimodalProcessor.js';
import { extractContentDescriptions } from '../RAGUtils.js';

const logger = createLogger('SearchQueryBuilder');

/**
 * Build search query for memory retrieval.
 *
 * Uses actual transcription/description for voice messages and images,
 * includes referenced message content for better memory recall,
 * and optionally includes recent conversation history for context-aware LTM search.
 *
 * The recentHistoryWindow solves the "pronoun problem" where users say things like
 * "what do you think about that?" - without context, LTM search can't find relevant memories.
 */
export function buildSearchQuery(
  userMessage: string,
  processedAttachments: ProcessedAttachment[],
  referencedMessagesText?: string,
  recentHistoryWindow?: string
): string {
  const parts: string[] = [];

  // Add recent conversation history FIRST (provides context for ambiguous queries)
  // This helps resolve pronouns like "that", "it", "he" by embedding the recent topic
  if (recentHistoryWindow !== undefined && recentHistoryWindow.length > 0) {
    parts.push(recentHistoryWindow);
    logger.info(
      `[PromptBuilder] Including ${recentHistoryWindow.length} chars of recent history in memory search`
    );
  }

  // Add user message (if not just the "Hello" fallback)
  if (userMessage.trim().length > 0 && userMessage.trim() !== 'Hello') {
    parts.push(userMessage);
  }

  // Add attachment descriptions (voice transcriptions, image descriptions)
  if (processedAttachments.length > 0) {
    const descriptions = extractContentDescriptions(processedAttachments);

    if (descriptions.length > 0) {
      parts.push(descriptions);

      // Log when using voice transcription instead of "Hello"
      if (userMessage.trim() === 'Hello') {
        logger.info(
          '[PromptBuilder] Using voice transcription for memory search instead of "Hello" fallback'
        );
      }
    }
  }

  // Add referenced message content for semantic search
  if (referencedMessagesText !== undefined && referencedMessagesText.length > 0) {
    parts.push(referencedMessagesText);
    logger.info('[PromptBuilder] Including referenced message content in memory search query');
  }

  // If we have nothing, fall back to "Hello"
  if (parts.length === 0) {
    return userMessage.trim().length > 0 ? userMessage : 'Hello';
  }

  return parts.join('\n\n');
}
