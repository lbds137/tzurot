/**
 * Response Cleanup Utilities
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * ignores instructions and adds unwanted prefixes/formatting.
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ResponseCleanup');

/**
 * Strip personality name prefix and timestamp from AI response
 *
 * Despite prompt instructions, some models add prefixes like:
 * - "Emily: [now] actual response"
 * - "Lilith: [2 minutes ago] actual response"
 * - "Personality Name: actual response"
 *
 * This function defensively strips these patterns.
 *
 * @param content - The AI-generated response content
 * @param personalityName - The personality name to look for in prefix
 * @returns Cleaned response content
 *
 * @example
 * ```typescript
 * stripPersonalityPrefix('Emily: [now] Hello!', 'Emily')
 * // Returns: 'Hello!'
 * ```
 *
 * @example
 * ```typescript
 * stripPersonalityPrefix('I am Emily', 'Emily')
 * // Returns: 'I am Emily' (unchanged - not at beginning)
 * ```
 */
export function stripPersonalityPrefix(content: string, personalityName: string): string {
  const originalContent = content;
  let cleaned = content;
  let strippedCount = 0;
  const maxIterations = 5; // Prevent infinite loop on malformed content

  // Aggressive pattern that catches any "Name: [timestamp]" at the start
  // Handles cases where LLM learned pattern and generates multiple prefixes
  const aggressivePattern = /^[\w\s]+?:\s*(?:\[[^\]]+?\]\s*)?/;

  // Keep stripping until no more prefixes found (handles "Lila: [3m ago] Lila: [0m ago]" cases)
  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;
    cleaned = cleaned.replace(aggressivePattern, '').trim();

    if (cleaned === beforeStrip) {
      // No more prefixes found
      break;
    }

    strippedCount++;
  }

  // Log if we stripped anything
  if (cleaned !== originalContent) {
    const strippedPrefix = originalContent.substring(
      0,
      originalContent.length - cleaned.length
    ).trim();

    logger.warn(
      {
        personalityName,
        strippedPrefix,
        strippedCount,
        wasStripped: true,
      },
      `[ResponseCleanup] Stripped ${strippedCount} prefix(es) from response. ` +
        `LLM learned the prefix pattern from conversation history. ` +
        `Prefix(es): "${strippedPrefix.substring(0, 100)}${strippedPrefix.length > 100 ? '...' : ''}"`
    );
  }

  return cleaned;
}
