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
 * This function detects when the response contains an exact (or near-exact)
 * duplication of itself and removes the duplicate portion.
 *
 * Algorithm:
 * 1. Take an "anchor" (first N characters) from the start of the response
 * 2. Search for that anchor appearing later in the text
 * 3. If found at index k, verify that text[k:] matches text[0:len-k] using O(1) memory
 * 4. If it matches, return only the first occurrence (text[:k])
 *
 * Performance: O(N) time with zero heap allocations in the comparison loop.
 * Uses charCodeAt for direct memory access instead of string slicing.
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
 * // Partial duplication (model cut off mid-repeat)
 * removeDuplicateResponse('Hello world! Hello wor')
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

  // Search for the anchor appearing later in the text
  let candidateIdx = content.indexOf(anchor, 1);

  while (candidateIdx !== -1) {
    // Found a potential split point
    // The text might be: Part_A (length candidateIdx) + Part_A (or partial)
    const suffixStart = candidateIdx;
    const suffixLength = len - suffixStart;

    // OPTIMIZATION 1: Quick fail check
    // Compare the last character first - if it doesn't match, skip the full comparison
    // This fails fast for the vast majority of false positives
    if (content.charCodeAt(len - 1) !== content.charCodeAt(suffixLength - 1)) {
      candidateIdx = content.indexOf(anchor, candidateIdx + 1);
      continue;
    }

    // OPTIMIZATION 2: Zero-allocation comparison using charCodeAt
    // Compare characters directly without creating new string objects
    let isMatch = true;
    for (let i = 0; i < suffixLength; i++) {
      if (content.charCodeAt(suffixStart + i) !== content.charCodeAt(i)) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      // Confirmed duplication! Only allocate memory here, once.
      const deduplicated = content.substring(0, suffixStart).trimEnd();

      logger.warn(
        {
          originalLength: len,
          deduplicatedLength: deduplicated.length,
          duplicateLength: suffixLength,
          splitPoint: suffixStart,
        },
        '[ResponseCleanup] Detected and removed duplicate response content. ' +
          'Model likely experienced stop-token failure.'
      );

      return deduplicated;
    }

    // Not a match - try the next occurrence of the anchor
    candidateIdx = content.indexOf(anchor, candidateIdx + 1);
  }

  // No duplication detected
  return content;
}
