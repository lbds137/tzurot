/**
 * Response Cleanup Utilities
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * learns patterns from the conversation history and adds unwanted artifacts.
 *
 * With XML-formatted prompts, models may:
 * - Append </message> tags (learning from chat_log structure)
 * - Append </current_turn> tags (learning from prompt structure)
 * - Append </incoming_message> tags (learning from current_turn structure)
 * - Add <message speaker="Name"> prefixes
 * - Still occasionally add "Name:" prefixes
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ResponseCleanup');

/**
 * Minimum response length to check for duplication.
 * Shorter responses are unlikely to have the stop-token failure bug.
 */
const MIN_LENGTH_FOR_DUPLICATION_CHECK = 100;

/**
 * Length of the "anchor" substring to search for.
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
 *
 * Example: "Hello! How are you?" duplicated as "Hello! How are you" (missing ?)
 * would still be caught at 0.8 threshold.
 */
const INTRA_TURN_SIMILARITY_THRESHOLD = 0.8;

/**
 * Default threshold for considering responses "too similar" (cross-turn).
 *
 * Set at 0.85 (85%) to balance catching genuine duplicates vs. false positives:
 * - Higher than intra-turn (0.8) because cross-turn duplicates should be more exact
 * - Below 0.9 to catch paraphrased duplicates where the model rewrites the same idea
 * - Empirically tuned: 0.85 catches "The answer is 42" vs "The answer is 42."
 *   while allowing legitimate similar responses to different questions
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/**
 * Minimum response length to check for cross-turn similarity.
 * Short responses like "Thank you!" may legitimately repeat.
 */
const MIN_LENGTH_FOR_SIMILARITY_CHECK = 30;

// ============================================================================
// Shared Similarity Function (used by both intra-turn and cross-turn detection)
// ============================================================================

/**
 * Calculate similarity ratio between two strings using Dice coefficient on bigrams.
 *
 * Uses bigram-based comparison which is O(n) and effective for near-duplicate detection.
 * This is similar to Python's difflib.SequenceMatcher but optimized for our use case.
 *
 * Used by both:
 * - Intra-turn detection: comparing first half vs second half of a response
 * - Cross-turn detection: comparing new response vs previous response
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
// Artifact Stripping
// ============================================================================

/**
 * Build artifact patterns for a given personality name
 */
function buildArtifactPatterns(personalityName: string): RegExp[] {
  const escapedName = personalityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return [
    // Trailing </message> tag: "Hello!</message>" → "Hello!"
    /<\/message>\s*$/i,
    // Trailing </current_turn> tag: "Hello!</current_turn>" → "Hello!"
    /<\/current_turn>\s*$/i,
    // Trailing </incoming_message> tag: "Hello!</incoming_message>" → "Hello!"
    /<\/incoming_message>\s*$/i,
    // XML message prefix: '<message speaker="Emily">Hello' → 'Hello'
    new RegExp(`^<message\\s+speaker=["']${escapedName}["'][^>]*>\\s*`, 'i'),
    // Simple name prefix: "Emily: Hello" → "Hello"
    new RegExp(`^${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`, 'i'),
    // Standalone timestamp: "[2m ago] Hello" → "Hello"
    /^\[[^\]]+?\]\s*/,
  ];
}

/**
 * Apply patterns iteratively until no more matches
 */
function applyPatternsIteratively(
  content: string,
  patterns: RegExp[],
  maxIterations: number
): { cleaned: string; strippedCount: number } {
  let cleaned = content;
  let strippedCount = 0;

  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;
    let matched = false;

    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '').trim();
      if (cleaned !== beforeStrip) {
        strippedCount++;
        matched = true;
        break; // Restart pattern matching from beginning
      }
    }

    if (!matched) {
      break;
    }
  }

  return { cleaned, strippedCount };
}

/**
 * Clean AI response by stripping learned artifacts
 *
 * Models learn patterns from conversation history. With XML format, they may add:
 * - Trailing </message> tags
 * - Leading <message speaker="Name"...> tags
 * - Simple "Name:" prefixes (legacy behavior)
 *
 * @param content - The AI-generated response content
 * @param personalityName - The personality name to look for
 * @returns Cleaned response content
 *
 * @example
 * ```typescript
 * stripResponseArtifacts('Hello there!</message>', 'Emily')
 * // Returns: 'Hello there!'
 * ```
 */
export function stripResponseArtifacts(content: string, personalityName: string): string {
  const patterns = buildArtifactPatterns(personalityName);
  const { cleaned, strippedCount } = applyPatternsIteratively(content, patterns, 5);

  if (strippedCount > 0) {
    const charsRemoved = content.length - cleaned.length;
    logger.warn(
      { personalityName, strippedCount, charsRemoved },
      `[ResponseCleanup] Stripped ${strippedCount} artifact(s) (${charsRemoved} chars) from response. ` +
        `LLM learned pattern from conversation history.`
    );
  }

  return cleaned;
}

/**
 * Remove duplicate content caused by LLM stop-token failure
 *
 * Some models (notably GLM-4.7 via OpenRouter) occasionally fail to stop
 * generation properly, causing the model to "forget" what it wrote and
 * regenerate the same response again, resulting in concatenated duplicates.
 *
 * This function detects when the response contains a duplicate (or near-duplicate)
 * of itself and removes the duplicate portion.
 *
 * Algorithm:
 * 1. Take an "anchor" (first N characters) from the start of the response
 * 2. Search for that anchor appearing later in the text
 * 3. If found at index k, verify using stringSimilarity (same algo as cross-turn detection)
 * 4. If similarity >= threshold, return only the first occurrence (text[:k])
 *
 * Uses the same stringSimilarity function as cross-turn detection (DRY).
 *
 * @param content - The AI-generated response content
 * @returns Deduplicated content (or original if no duplication detected)
 *
 * @example
 * ```typescript
 * // Exact duplication
 * removeDuplicateResponse('Hello world! Hello world!')
 * // Returns: 'Hello world!'
 *
 * // Near-duplication with variations (model restarts with slight changes)
 * removeDuplicateResponse('*waves* Hello there! *waves excitedly* Hello there!')
 * // Returns: '*waves* Hello there!'
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
    // The text might be: Part_A (length candidateIdx) + Part_A (or variation/multiple of Part_A)
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
    // "Hello world" vs "Hello" → firstPart starts with secondPart
    const isSecondPrefixOfFirst = firstLower.startsWith(secondLower);

    // Check 2: Runaway duplicate (model output [A][A][A])
    // "Hello" vs "Hello Hello" → secondPart starts with firstPart
    const isFirstPrefixOfSecond = secondLower.startsWith(firstLower);

    // Check 3: Similarity-based match
    // Skip expensive similarity check if lengths are vastly different (>2x ratio)
    // because Dice coefficient fails on mismatched lengths anyway
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
        '[ResponseCleanup] Detected and removed intra-turn duplicate response content. ' +
          'Model likely experienced stop-token failure.'
      );

      // Return raw first part with only trailing whitespace trimmed
      // (preserves intentional formatting in the valid portion)
      return firstPartRaw.trimEnd();
    }

    // Not similar enough - try the next occurrence of the anchor
    candidateIdx = content.indexOf(anchor, candidateIdx + 1);
  }

  // No duplication detected
  return content;
}

// ============================================================================
// Cross-Turn Duplication Detection
// ============================================================================
// The above `removeDuplicateResponse` handles INTRA-turn duplication (same response
// repeated within a single LLM output due to stop-token failure).
//
// The function below handles CROSS-turn duplication (same response given to
// different user inputs across conversation turns - typically caused by
// API-level caching on free-tier models).
//
// Both use the shared `stringSimilarity` function defined at the top of this file.
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
      '[ResponseCleanup] Cross-turn duplication detected. ' +
        'Response is too similar to previous turn. Possible API-level caching.'
    );
  }

  return isDuplicate;
}

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
