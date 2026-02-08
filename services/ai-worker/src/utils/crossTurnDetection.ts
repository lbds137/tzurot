/**
 * Cross-Turn Duplicate Detection
 *
 * Detects when the LLM gives the same response to different user inputs,
 * typically caused by API-level caching on free-tier models.
 *
 * Uses a "Swiss Cheese" model with 4 detection layers:
 * - Layer 1: Exact hash (O(1), catches byte-identical)
 * - Layer 2: Word Jaccard (O(n), catches same words different formatting)
 * - Layer 3: Bigram similarity (O(n), catches character-level changes)
 * - Layer 4: Semantic embedding (O(n) + embedding, catches meaning equivalence)
 */

import { createLogger, stripBotFooters } from '@tzurot/common-types';
import {
  stringSimilarity,
  wordJaccardSimilarity,
  contentHash,
  DEFAULT_SIMILARITY_THRESHOLD,
  NEAR_MISS_THRESHOLD,
  WORD_JACCARD_THRESHOLD,
  SEMANTIC_SIMILARITY_THRESHOLD,
} from './duplicateDetection.js';
import type { EmbeddingServiceInterface } from './duplicateDetectionTypes.js';

// Re-export types for convenience
const logger = createLogger('CrossTurnDetection');

/** Minimum response length to check for cross-turn similarity */
const MIN_LENGTH_FOR_SIMILARITY_CHECK = 30;

// ============================================================================
// Helper Functions
// ============================================================================

/** Create a snippet for logging (first N characters with ellipsis) */
function snippet(content: string, maxLength = 60): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength) + '...';
}

/** Log diagnostic info about duplicate detection outcome */
function logDuplicateCheckResult(params: {
  outcome: 'NEAR_MISS' | 'PASSED';
  maxSimilarity: number;
  threshold: number;
  maxSimilarityIndex: number;
  recentMessagesCount: number;
  newResponseLength: number;
  newResponseSnippet: string;
  closestMatchSnippet: string;
  newResponseHash: string;
}): void {
  const {
    outcome,
    maxSimilarity,
    threshold,
    maxSimilarityIndex,
    recentMessagesCount,
    newResponseLength,
    newResponseSnippet,
    closestMatchSnippet,
    newResponseHash,
  } = params;

  if (outcome === 'NEAR_MISS') {
    logger.info(
      {
        outcome,
        maxSimilarity: maxSimilarity.toFixed(3),
        threshold,
        nearMissThreshold: NEAR_MISS_THRESHOLD,
        maxSimilarityIndex,
        turnsBack: maxSimilarityIndex + 1,
        recentMessagesCount,
        newResponseLength,
        newResponseSnippet,
        closestMatchSnippet,
        newResponseHash,
      },
      `[CrossTurnDetection] NEAR-MISS: Similarity ${(maxSimilarity * 100).toFixed(1)}% ` +
        `is high but below ${(threshold * 100).toFixed(0)}% threshold.`
    );
  } else {
    logger.info(
      {
        outcome,
        maxSimilarity: maxSimilarity.toFixed(3),
        threshold,
        maxSimilarityIndex,
        recentMessagesCount,
        newResponseLength,
        newResponseSnippet: snippet(newResponseSnippet, 40),
        closestMatchSnippet: snippet(closestMatchSnippet, 40),
      },
      '[CrossTurnDetection] Check complete - no duplicate detected'
    );
  }
}

// ============================================================================
// Cross-Turn Detection Functions
// ============================================================================

/**
 * Check if a new response is too similar to a previous response.
 *
 * @param newResponse The newly generated response
 * @param previousResponse The previous bot response
 * @param threshold Similarity threshold (default 0.85)
 * @returns true if responses are too similar (likely a cache hit)
 */
export function isCrossTurnDuplicate(
  newResponse: string,
  previousResponse: string,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): boolean {
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
      '[CrossTurnDetection] Cross-turn duplication detected. Possible API-level caching.'
    );
  }

  return isDuplicate;
}

/**
 * Check if a new response is too similar to ANY recent assistant messages.
 *
 * Runs layers 1-3 of the Swiss Cheese model synchronously:
 * - Layer 1: Exact hash match
 * - Layer 2: Word Jaccard similarity
 * - Layer 3: Bigram similarity
 *
 * @param newResponse The newly generated response
 * @param recentMessages Array of recent assistant messages (most recent first)
 * @param threshold Similarity threshold (default 0.85)
 * @returns Object with isDuplicate flag and matchIndex
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Swiss cheese detection: hash, Jaccard, bigram, and semantic similarity layers with early exits
export function isRecentDuplicate(
  newResponse: string,
  recentMessages: string[],
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): { isDuplicate: boolean; matchIndex: number } {
  const cleanNewResponse = stripBotFooters(newResponse);
  const newResponseHash = contentHash(cleanNewResponse);

  if (cleanNewResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK) {
    logger.debug(
      { newResponseLength: cleanNewResponse.length, minLength: MIN_LENGTH_FOR_SIMILARITY_CHECK },
      '[CrossTurnDetection] Skipping - response too short'
    );
    return { isDuplicate: false, matchIndex: -1 };
  }

  let highestSimilarity = 0;
  let highestSimilarityIndex = -1;
  let closestMatchSnippet = '';

  for (let i = 0; i < recentMessages.length; i++) {
    const cleanPreviousResponse = stripBotFooters(recentMessages[i]);

    if (cleanPreviousResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK) {
      continue;
    }

    const previousHash = contentHash(cleanPreviousResponse);

    // LAYER 1: Exact hash match
    if (previousHash === newResponseHash) {
      logger.warn(
        {
          detectionMethod: 'exact_hash',
          matchIndex: i,
          turnsBack: i + 1,
          newResponseLength: cleanNewResponse.length,
          newResponseSnippet: snippet(cleanNewResponse),
          hash: newResponseHash,
        },
        `[CrossTurnDetection] EXACT MATCH via hash. Identical to ${i + 1} turn(s) ago.`
      );
      return { isDuplicate: true, matchIndex: i };
    }

    // LAYER 2: Word Jaccard similarity
    const jaccardSimilarity = wordJaccardSimilarity(cleanNewResponse, cleanPreviousResponse);
    if (jaccardSimilarity >= WORD_JACCARD_THRESHOLD) {
      logger.warn(
        {
          detectionMethod: 'word_jaccard',
          similarity: jaccardSimilarity.toFixed(3),
          threshold: WORD_JACCARD_THRESHOLD,
          matchIndex: i,
          turnsBack: i + 1,
          newResponseLength: cleanNewResponse.length,
          previousResponseLength: cleanPreviousResponse.length,
          newResponseSnippet: snippet(cleanNewResponse),
          matchedSnippet: snippet(cleanPreviousResponse),
        },
        `[CrossTurnDetection] Word-level duplication (Jaccard ${(jaccardSimilarity * 100).toFixed(0)}%).`
      );
      return { isDuplicate: true, matchIndex: i };
    }

    // LAYER 3: Bigram similarity
    const similarity = stringSimilarity(cleanNewResponse, cleanPreviousResponse);

    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      highestSimilarityIndex = i;
      closestMatchSnippet = snippet(cleanPreviousResponse);
    }

    if (similarity >= threshold) {
      logger.warn(
        {
          detectionMethod: 'similarity',
          similarity: similarity.toFixed(3),
          threshold,
          matchIndex: i,
          turnsBack: i + 1,
          newResponseLength: cleanNewResponse.length,
          previousResponseLength: cleanPreviousResponse.length,
          newResponseSnippet: snippet(cleanNewResponse),
          matchedSnippet: snippet(cleanPreviousResponse),
        },
        `[CrossTurnDetection] Bigram similarity match from ${i + 1} turn(s) ago.`
      );
      return { isDuplicate: true, matchIndex: i };
    }
  }

  // Log diagnostic result for every check
  if (recentMessages.length > 0) {
    const isNearMiss = highestSimilarity >= NEAR_MISS_THRESHOLD && highestSimilarity < threshold;
    logDuplicateCheckResult({
      outcome: isNearMiss ? 'NEAR_MISS' : 'PASSED',
      maxSimilarity: highestSimilarity,
      threshold,
      maxSimilarityIndex: highestSimilarityIndex,
      recentMessagesCount: recentMessages.length,
      newResponseLength: cleanNewResponse.length,
      newResponseSnippet: snippet(cleanNewResponse),
      closestMatchSnippet,
      newResponseHash,
    });
  }

  return { isDuplicate: false, matchIndex: -1 };
}

/**
 * Check for semantic duplicate using embedding similarity (Layer 4).
 */
async function checkSemanticDuplicate(
  cleanNewResponse: string,
  newResponseHash: string,
  embeddingService: EmbeddingServiceInterface
): Promise<{ isDuplicate: boolean; similarity: number; matchedHash: string }> {
  const newEmbedding = await embeddingService.getEmbedding(cleanNewResponse);

  if (newEmbedding === undefined) {
    logger.debug({}, '[CrossTurnDetection] Failed to generate embedding, skipping semantic check');
    return { isDuplicate: false, similarity: 0, matchedHash: '' };
  }

  const storedEmbeddings = embeddingService.getAllStoredEmbeddings();
  let highestSimilarity = 0;
  let matchedHash = '';

  for (const stored of storedEmbeddings) {
    const similarity = embeddingService.cosineSimilarity(newEmbedding, stored.vector);
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      matchedHash = stored.hash;
    }
  }

  const isDuplicate = highestSimilarity >= SEMANTIC_SIMILARITY_THRESHOLD;

  // Store embedding regardless of duplicate status
  embeddingService.storeEmbedding(newResponseHash, newEmbedding);

  return { isDuplicate, similarity: highestSimilarity, matchedHash };
}

/**
 * Async version of isRecentDuplicate with optional semantic embedding layer.
 *
 * This is the full "Swiss Cheese" model with 4 layers:
 * - Layer 1: Exact hash (O(1), catches byte-identical)
 * - Layer 2: Word Jaccard (O(n), catches same words different formatting)
 * - Layer 3: Bigram similarity (O(n), catches character-level changes)
 * - Layer 4: Semantic embedding (O(n) + embedding, catches meaning equivalence)
 *
 * Layer 4 only runs if layers 1-3 didn't catch the duplicate and an embedding
 * service is provided and ready.
 *
 * @param newResponse The newly generated response
 * @param recentMessages Array of recent assistant messages (most recent first)
 * @param embeddingService Optional embedding service for semantic comparison
 * @param threshold Similarity threshold for bigram check (default 0.85)
 * @returns Promise resolving to isDuplicate flag and matchIndex
 */
export async function isRecentDuplicateAsync(
  newResponse: string,
  recentMessages: string[],
  embeddingService?: EmbeddingServiceInterface,
  threshold = DEFAULT_SIMILARITY_THRESHOLD
): Promise<{ isDuplicate: boolean; matchIndex: number }> {
  // Run synchronous layers first (1-3)
  const syncResult = isRecentDuplicate(newResponse, recentMessages, threshold);

  if (syncResult.isDuplicate) {
    return syncResult;
  }

  // Layer 4: Semantic embedding check (only if service available)
  if (embeddingService?.isServiceReady() === true) {
    const cleanNewResponse = stripBotFooters(newResponse);

    if (cleanNewResponse.length < MIN_LENGTH_FOR_SIMILARITY_CHECK) {
      return syncResult;
    }

    const newResponseHash = contentHash(cleanNewResponse);
    const semanticResult = await checkSemanticDuplicate(
      cleanNewResponse,
      newResponseHash,
      embeddingService
    );

    if (semanticResult.isDuplicate) {
      logger.warn(
        {
          detectionMethod: 'semantic_embedding',
          similarity: semanticResult.similarity.toFixed(3),
          threshold: SEMANTIC_SIMILARITY_THRESHOLD,
          matchedHash: semanticResult.matchedHash,
          newResponseHash,
          newResponseLength: cleanNewResponse.length,
          newResponseSnippet: snippet(cleanNewResponse),
        },
        `[CrossTurnDetection] Semantic duplication detected (${(semanticResult.similarity * 100).toFixed(0)}% similar).`
      );
      return { isDuplicate: true, matchIndex: -1 };
    }

    logger.debug(
      {
        semanticSimilarity: semanticResult.similarity.toFixed(3),
        threshold: SEMANTIC_SIMILARITY_THRESHOLD,
        storedEmbeddingsCount: embeddingService.getAllStoredEmbeddings().length,
      },
      '[CrossTurnDetection] Semantic check passed - no semantic duplicate found'
    );
  }

  return syncResult;
}
