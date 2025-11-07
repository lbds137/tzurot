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

  // Escape special regex characters in personality name
  const escapedName = personalityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Pattern 1: Specific personality name with optional timestamp
  // Example: "Lilith: [2m ago] content" or "Emily: content"
  const namePattern = new RegExp(`^${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`, 'i');

  // Pattern 2: Standalone "[timestamp]" at the start (no name prefix)
  // Example: "[2m ago] content" - happens when AI strips name but leaves timestamp
  const standaloneTimestampPattern = /^\[[^\]]+?\]\s*/;

  // Keep stripping until no more prefixes found
  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;

    // Try name-specific pattern first
    cleaned = cleaned.replace(namePattern, '').trim();
    if (cleaned === beforeStrip) {
      // Name pattern didn't match, try standalone timestamp
      cleaned = cleaned.replace(standaloneTimestampPattern, '').trim();
    }

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
