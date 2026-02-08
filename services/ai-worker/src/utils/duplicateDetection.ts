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
 *
 * This file contains:
 * - Intra-turn detection (removeDuplicateResponse)
 * - Similarity functions (stringSimilarity, wordJaccardSimilarity)
 * - Retry configuration (buildRetryConfig)
 * - Cross-turn detection functions from crossTurnDetection.ts
 */

import { createHash } from 'node:crypto';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('DuplicateDetection');

// ============================================================================
// Cross-Turn Detection Functions
// ============================================================================

// Re-export types from dedicated types file
export type { EmbeddingServiceInterface } from './duplicateDetectionTypes.js';

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
 */
const INTRA_TURN_SIMILARITY_THRESHOLD = 0.8;

/**
 * Default threshold for considering responses "too similar" (cross-turn).
 *
 * Set at 0.85 (85%) to balance catching genuine duplicates vs. false positives.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/**
 * Near-miss threshold for diagnostic logging.
 *
 * When similarity is between NEAR_MISS_THRESHOLD and DEFAULT_SIMILARITY_THRESHOLD,
 * we log at INFO level as a potential false negative.
 */
export const NEAR_MISS_THRESHOLD = 0.7;

/**
 * Threshold for word-level Jaccard similarity detection.
 *
 * Set at 0.75 (75%) to catch duplicates where the same words appear
 * but with different punctuation, formatting, or minor variations.
 */
export const WORD_JACCARD_THRESHOLD = 0.75;

/**
 * Threshold for semantic embedding similarity detection.
 *
 * Set at 0.88 (cosine similarity) to catch semantically identical content
 * that uses different words. This is Layer 4 in the Swiss Cheese model.
 */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.88;

// ============================================================================
// Escalating Retry Constants ("Ladder of Desperation")
// ============================================================================

/**
 * Temperature range for Attempt 2 when normal generation produced a duplicate.
 * Higher temperature increases randomness, helping to break API-level caching.
 *
 * Uses random jitter between 0.95-1.0 instead of a fixed value because:
 * - Fixed values can still hit provider-level caches
 * - Random variation ensures each retry has a different cache key
 * - Capped at 1.0 since some providers (Z.AI, etc.) reject temperature > 1.0
 */
export const RETRY_TEMPERATURE_MIN = 0.95;
export const RETRY_TEMPERATURE_MAX = 1.0;

/**
 * Generate a random temperature for retry attempts.
 * Returns a value between RETRY_TEMPERATURE_MIN and RETRY_TEMPERATURE_MAX (inclusive).
 *
 * The random jitter helps bust API-level caches more effectively than a fixed value.
 */
export function getRetryTemperature(): number {
  const range = RETRY_TEMPERATURE_MAX - RETRY_TEMPERATURE_MIN;
  return RETRY_TEMPERATURE_MIN + Math.random() * range;
}

/**
 * Frequency penalty to use on Attempt 2.
 * Penalizes repeated tokens, encouraging more varied word choice.
 */
export const RETRY_ATTEMPT_2_FREQUENCY_PENALTY = 0.5;

/**
 * Percent of oldest conversation history to remove on Attempt 3.
 * This changes the input significantly, breaking cache keys.
 */
export const RETRY_ATTEMPT_3_HISTORY_REDUCTION = 0.3;

/**
 * Build retry configuration for escalating duplicate detection.
 *
 * @param attempt Current attempt number (1-based)
 * @returns Retry configuration with appropriate overrides for the attempt
 */
export function buildRetryConfig(attempt: number): {
  temperatureOverride?: number;
  frequencyPenaltyOverride?: number;
  historyReductionPercent?: number;
} {
  if (attempt === 1) {
    // Attempt 1: Normal generation, no overrides
    return {};
  }

  if (attempt === 2) {
    // Attempt 2: Increase temperature (with jitter) and frequency penalty
    return {
      temperatureOverride: getRetryTemperature(),
      frequencyPenaltyOverride: RETRY_ATTEMPT_2_FREQUENCY_PENALTY,
    };
  }

  // Attempt 3+: Also reduce history to break cache
  return {
    temperatureOverride: getRetryTemperature(),
    frequencyPenaltyOverride: RETRY_ATTEMPT_2_FREQUENCY_PENALTY,
    historyReductionPercent: RETRY_ATTEMPT_3_HISTORY_REDUCTION,
  };
}

// ============================================================================
// String Similarity Functions
// ============================================================================

/**
 * Calculate similarity ratio between two strings using Dice coefficient on bigrams.
 *
 * @param a First string to compare
 * @param b Second string to compare
 * @returns Similarity ratio between 0 (completely different) and 1 (identical)
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

/**
 * Normalize text for word-level comparison.
 *
 * Performs aggressive normalization to focus on semantic content:
 * - Lowercase
 * - Strip markdown formatting
 * - Remove punctuation
 * - Collapse whitespace
 */
export function normalizeForComparison(text: string): string {
  return (
    text
      .toLowerCase()
      // Remove markdown: *text*, **text**, _text_, __text__, ~~text~~
      .replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1')
      // Remove punctuation except apostrophes in contractions
      .replace(/[^\w\s']/g, ' ')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Calculate word-level Jaccard similarity between two strings.
 *
 * This is "Layer 2" in the Swiss Cheese detection model.
 * Jaccard index = |intersection| / |union|
 */
export function wordJaccardSimilarity(a: string, b: string): number {
  const normalized1 = normalizeForComparison(a);
  const normalized2 = normalizeForComparison(b);

  // Handle edge cases
  if (normalized1 === normalized2) {
    return 1;
  }
  if (normalized1.length === 0 || normalized2.length === 0) {
    return 0;
  }

  // Tokenize into word sets
  const words1 = new Set(normalized1.split(' ').filter(w => w.length > 0));
  const words2 = new Set(normalized2.split(' ').filter(w => w.length > 0));

  if (words1.size === 0 || words2.size === 0) {
    return 0;
  }

  // Calculate intersection
  let intersectionSize = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersectionSize++;
    }
  }

  // Calculate union: |A| + |B| - |A ∩ B|
  const unionSize = words1.size + words2.size - intersectionSize;

  // Jaccard index
  return intersectionSize / unionSize;
}

/**
 * Create a SHA-256 hash of normalized content for exact-match detection.
 */
export function contentHash(content: string): string {
  const normalized = content.toLowerCase().trim();
  return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

// ============================================================================
// Intra-Turn Duplicate Detection
// ============================================================================

/**
 * Remove duplicate content caused by LLM stop-token failure
 *
 * Some models occasionally fail to stop generation properly, causing the model
 * to "forget" what it wrote and regenerate the same response again.
 *
 * Algorithm:
 * 1. Take an "anchor" (first N characters) from the start of the response
 * 2. Search for that anchor appearing later in the text
 * 3. If found, verify using stringSimilarity
 * 4. If similarity >= threshold, return only the first occurrence
 */
export function removeDuplicateResponse(content: string): string {
  const len = content.length;

  // Skip short responses
  if (len < MIN_LENGTH_FOR_DUPLICATION_CHECK) {
    return content;
  }

  // Calculate anchor length (use shorter anchor for shorter responses)
  const anchorLength = Math.min(ANCHOR_LENGTH, Math.floor(len / 3));
  const anchor = content.substring(0, anchorLength);

  // Start searching AFTER the anchor itself
  let candidateIdx = content.indexOf(anchor, anchorLength);

  while (candidateIdx !== -1) {
    // Found a potential split point
    const firstPartRaw = content.substring(0, candidateIdx);
    const secondPartRaw = content.substring(candidateIdx);

    // Trim for comparison only
    const firstPart = firstPartRaw.trim();
    const secondPart = secondPartRaw.trim();

    // Skip if second part is empty
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
