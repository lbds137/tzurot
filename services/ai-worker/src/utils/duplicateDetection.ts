/**
 * Duplicate Detection Utilities
 *
 * Handles both intra-turn (within a single response) and cross-turn (across
 * conversation turns) duplicate detection.
 *
 * Intra-turn: Some models (notably GLM-4.7 via OpenRouter) fail to stop
 * generation properly, causing repeated content within a single response.
 *
 * Cross-turn: API-level caching on free-tier models can return the same
 * response to different user inputs.
 */

import { createLogger, stripBotFooters } from '@tzurot/common-types';

const logger = createLogger('DuplicateDetection');

// ============================================================================
// Configuration Constants
// ============================================================================

/**
 * Minimum response length to check for intra-turn duplication.
 * Shorter responses are unlikely to have the stop-token failure bug.
 */
const MIN_LENGTH_FOR_DUPLICATION_CHECK = 100;

/**
 * Length of the "anchor" substring to search for in intra-turn detection.
 * This is the start of the response that we look for repeated later.
 */
const ANCHOR_LENGTH = 30;

/**
 * Similarity threshold for intra-turn duplicate detection.
 *
 * Set at 0.8 (80%) because intra-turn duplicates from stop-token failures
 * may have slight variations (trailing punctuation, whitespace differences).
 * We want to catch "almost exact" duplicates without false positives on
 * genuinely similar but distinct content.
 */
const INTRA_TURN_SIMILARITY_THRESHOLD = 0.8;

/**
 * Default threshold for considering responses "too similar" (cross-turn).
 *
 * Set at 0.85 (85%) to balance catching genuine duplicates vs. false positives:
 * - Higher than intra-turn (0.8) because cross-turn duplicates should be more exact
 * - Below 0.9 to catch paraphrased duplicates where the model rewrites the same idea
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/**
 * Minimum response length to check for cross-turn similarity.
 * Short responses like "Thank you!" may legitimately repeat.
 */
const MIN_LENGTH_FOR_SIMILARITY_CHECK = 30;

/**
 * Number of recent assistant messages to check for cross-turn duplicates.
 *
 * Set to 5 based on production observations (January 2026) showing API-level
 * caching can return responses from 3-4 turns back, not just the most recent.
 * The window is about recency - we don't filter out short messages during
 * collection because that would scan arbitrarily far back in history.
 */
const MAX_RECENT_ASSISTANT_MESSAGES = 5;

// ============================================================================
// String Similarity (shared by intra-turn and cross-turn detection)
// ============================================================================

/**
 * Calculate similarity ratio between two strings using Dice coefficient on bigrams.
 *
 * Uses bigram-based comparison which is O(n) and effective for near-duplicate detection.
 * This is similar to Python's difflib.SequenceMatcher but optimized for our use case.
 *
 * @param a First string to compare
 * @param b Second string to compare
 * @returns Similarity ratio between 0 (completely different) and 1 (identical)
 *
 * @example
 * ```typescript
 * stringSimilarity("hello world", "hello world") // 1.0
 * stringSimilarity("hello world", "hello there") // ~0.5
 * stringSimilarity("abc", "xyz") // 0
 * ```
 */
export function stringSimilarity(a: string, b: string): number {
  // Exact match
  if (a === b) {
    return 1;
  }

  // Normalize: lowercase and trim
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) {
    return 1;
  }

  // Handle edge cases
  if (s1.length === 0 || s2.length === 0) {
    return 0;
  }
  if (s1.length === 1 || s2.length === 1) {
    return s1 === s2 ? 1 : 0;
  }

  // Generate bigrams (2-character sequences)
  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) ?? 0) + 1);
  }

  // Count matching bigrams
  let matches = 0;
  let bigrams2Count = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    bigrams2Count++;

    const count = bigrams1.get(bigram);
    if (count !== undefined && count > 0) {
      matches++;
      bigrams1.set(bigram, count - 1);
    }
  }

  // Dice coefficient: 2 * matches / (total bigrams in both strings)
  const totalBigrams = s1.length - 1 + bigrams2Count;
  return (2 * matches) / totalBigrams;
}

// ============================================================================
// Intra-Turn Duplicate Detection
// ============================================================================

/**
 * Remove duplicate content caused by LLM stop-token failure
 *
 * Some models occasionally fail to stop generation properly, causing the model
 * to "forget" what it wrote and regenerate the same response again, resulting
 * in concatenated duplicates.
 *
 * Algorithm:
 * 1. Take an "anchor" (first N characters) from the start of the response
 * 2. Search for that anchor appearing later in the text
 * 3. If found at index k, verify using stringSimilarity
 * 4. If similarity >= threshold, return only the first occurrence (text[:k])
 *
 * @param content - The AI-generated response content
 * @returns Deduplicated content (or original if no duplication detected)
 *
 * @example
 * ```typescript
 * removeDuplicateResponse('Hello world! Hello world!')
 * // Returns: 'Hello world!'
 * ```
 */
export function removeDuplicateResponse(content: string): string {
  const len = content.length;

  // Skip short responses - unlikely to have the bug and higher false-positive risk
  if (len < MIN_LENGTH_FOR_DUPLICATION_CHECK) {
    return content;
  }

  // Calculate anchor length (use shorter anchor for shorter responses)
  const anchorLength = Math.min(ANCHOR_LENGTH, Math.floor(len / 3));
  const anchor = content.substring(0, anchorLength);

  // Start searching AFTER the anchor itself to avoid self-overlapping matches
  let candidateIdx = content.indexOf(anchor, anchorLength);

  while (candidateIdx !== -1) {
    // Found a potential split point
    const firstPartRaw = content.substring(0, candidateIdx);
    const secondPartRaw = content.substring(candidateIdx);

    // Trim for comparison only (preserve original whitespace in return value)
    const firstPart = firstPartRaw.trim();
    const secondPart = secondPartRaw.trim();

    // Skip if second part is empty (we're at the end)
    if (secondPart.length === 0) {
      break;
    }

    const firstLower = firstPart.toLowerCase();
    const secondLower = secondPart.toLowerCase();

    // Check 1: Partial duplicate (model cut off mid-repeat)
    const isSecondPrefixOfFirst = firstLower.startsWith(secondLower);

    // Check 2: Runaway duplicate (model output [A][A][A])
    const isFirstPrefixOfSecond = secondLower.startsWith(firstLower);

    // Check 3: Similarity-based match
    let similarity = 0;
    let detectionMethod: 'second-prefix' | 'first-prefix' | 'similarity' | 'none' = 'none';

    if (isSecondPrefixOfFirst) {
      similarity = 1.0;
      detectionMethod = 'second-prefix';
    } else if (isFirstPrefixOfSecond) {
      similarity = 1.0;
      detectionMethod = 'first-prefix';
    } else {
      // Length ratio gate: only run similarity if lengths are within 0.5x to 2x
      const lengthRatio = firstPart.length / secondPart.length;
      if (lengthRatio > 0.5 && lengthRatio < 2.0) {
        similarity = stringSimilarity(firstPart, secondPart);
        detectionMethod = 'similarity';
      }
    }

    if (similarity >= INTRA_TURN_SIMILARITY_THRESHOLD) {
      // Confirmed duplication!
      logger.warn(
        {
          originalLength: len,
          deduplicatedLength: firstPartRaw.trimEnd().length,
          duplicateLength: secondPartRaw.length,
          splitPoint: candidateIdx,
          similarity: similarity.toFixed(3),
          detectionMethod,
        },
        '[DuplicateDetection] Detected and removed intra-turn duplicate response content. ' +
          'Model likely experienced stop-token failure.'
      );

      // Return raw first part with only trailing whitespace trimmed
      return firstPartRaw.trimEnd();
    }

    // Not similar enough - try the next occurrence of the anchor
    candidateIdx = content.indexOf(anchor, candidateIdx + 1);
  }

  // No duplication detected
  return content;
}

// ============================================================================
// Cross-Turn Duplicate Detection
// ============================================================================

/**
 * Check if a new response is too similar to a previous response.
 *
 * This detects cross-turn duplication where the LLM gives the same response
 * to different user inputs (typically caused by API-level caching).
 *
 * @param newResponse The newly generated response
 * @param previousResponse The previous bot response from conversation history
 * @param threshold Similarity threshold (default 0.85 = 85% similar)
 * @returns true if the responses are too similar (likely a cache hit)
 */
export function isCrossTurnDuplicate(
  newResponse: string,
  previousResponse: string,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): boolean {
  // Short responses may legitimately repeat (e.g., "Thank you!", "Got it!")
  if (
    newResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK ||
    previousResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK
  ) {
    return false;
  }

  const similarity = stringSimilarity(newResponse, previousResponse);
  const isDuplicate = similarity >= threshold;

  if (isDuplicate) {
    logger.warn(
      {
        similarity: similarity.toFixed(3),
        threshold,
        newResponseLength: newResponse.length,
        previousResponseLength: previousResponse.length,
      },
      '[DuplicateDetection] Cross-turn duplication detected. ' +
        'Response is too similar to previous turn. Possible API-level caching.'
    );
  }

  return isDuplicate;
}

/**
 * Check if a new response is too similar to ANY of the recent assistant messages.
 *
 * This catches cross-turn duplicates that may match older messages, not just the
 * immediate previous one. API-level caching on free models can return cached
 * responses from several turns back when the input is similar.
 *
 * @param newResponse The newly generated response
 * @param recentMessages Array of recent assistant messages (most recent first)
 * @param threshold Similarity threshold (default 0.85 = 85% similar)
 * @returns Object with isDuplicate flag and matchIndex (-1 if no match)
 */
export function isRecentDuplicate(
  newResponse: string,
  recentMessages: string[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): { isDuplicate: boolean; matchIndex: number } {
  // Strip footers from the new response for clean comparison
  // (New responses shouldn't have footers, but strip just in case)
  const cleanNewResponse = stripBotFooters(newResponse);

  // Short responses may legitimately repeat
  if (cleanNewResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK) {
    return { isDuplicate: false, matchIndex: -1 };
  }

  for (let i = 0; i < recentMessages.length; i++) {
    // Strip footers from historical messages before comparison
    // Historical context: A sync bug caused footers to be stored in DB.
    // Without stripping, a clean new response vs dirty history would have
    // artificially low similarity (e.g., 0.60 instead of 1.0), causing
    // duplicates to slip through undetected.
    const cleanPreviousResponse = stripBotFooters(recentMessages[i]);

    // Skip short previous messages (after footer stripping)
    if (cleanPreviousResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK) {
      continue;
    }

    const similarity = stringSimilarity(cleanNewResponse, cleanPreviousResponse);

    if (similarity >= threshold) {
      logger.warn(
        {
          similarity: similarity.toFixed(3),
          threshold,
          newResponseLength: cleanNewResponse.length,
          previousResponseLength: cleanPreviousResponse.length,
          matchIndex: i,
          turnsBack: i + 1,
        },
        `[DuplicateDetection] Cross-turn duplication detected. ` +
          `Response matches assistant message from ${i + 1} turn(s) ago.`
      );
      return { isDuplicate: true, matchIndex: i };
    }
  }

  return { isDuplicate: false, matchIndex: -1 };
}

// ============================================================================
// Conversation History Helpers
// ============================================================================

/**
 * Get the last assistant message from raw conversation history.
 *
 * @param history Raw conversation history entries
 * @returns The last assistant message content, or undefined if none found
 */
export function getLastAssistantMessage(
  history: { role: string; content: string }[] | undefined
): string | undefined {
  if (!history || history.length === 0) {
    return undefined;
  }

  // Find the last assistant message (iterate from end)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') {
      return history[i].content;
    }
  }

  return undefined;
}

/**
 * Get recent assistant messages from raw conversation history.
 *
 * Returns up to MAX_RECENT_ASSISTANT_MESSAGES (5) messages to check for
 * cross-turn duplicates. This catches cases where API-level caching returns
 * an older cached response, not just the immediate previous one.
 *
 * @param history Raw conversation history entries
 * @param maxMessages Maximum number of messages to return (default 5)
 * @returns Array of recent assistant message contents (most recent first)
 */
export function getRecentAssistantMessages(
  history: { role: string; content: string }[] | undefined,
  maxMessages = MAX_RECENT_ASSISTANT_MESSAGES
): string[] {
  if (!history || history.length === 0) {
    return [];
  }

  const messages: string[] = [];

  // Find assistant messages from end (most recent first)
  for (let i = history.length - 1; i >= 0 && messages.length < maxMessages; i--) {
    if (history[i].role === 'assistant') {
      messages.push(history[i].content);
    }
  }

  return messages;
}
