/**
 * Response Cleanup Utilities
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * learns patterns from the conversation history and adds unwanted artifacts.
 *
 * With XML-formatted prompts, models may:
 * - Append </message> tags (learning from chat_log structure)
 * - Add <message speaker="Name"> prefixes
 * - Still occasionally add "Name:" prefixes
 */

import { createLogger, TEXT_LIMITS } from '@tzurot/common-types';

const logger = createLogger('ResponseCleanup');

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
export function stripPersonalityPrefix(content: string, personalityName: string): string {
  const originalContent = content;
  let cleaned = content;
  let strippedCount = 0;
  const maxIterations = 5; // Prevent infinite loop on malformed content

  // Escape special regex characters in personality name
  const escapedName = personalityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // === TRAILING ARTIFACTS (strip from end) ===

  // Pattern: Trailing </message> tag (with optional whitespace)
  // Example: "Hello!</message>" → "Hello!"
  // Example: "Hello!</message>\n" → "Hello!"
  const trailingMessageTag = /<\/message>\s*$/i;

  // === LEADING ARTIFACTS (strip from start) ===

  // Pattern: XML message tag prefix
  // Example: '<message speaker="Emily">Hello' → 'Hello'
  // Example: '<message speaker="Emily" time="now">Hello' → 'Hello'
  const xmlMessagePrefix = new RegExp(`^<message\\s+speaker=["']${escapedName}["'][^>]*>\\s*`, 'i');

  // Pattern: Simple "Name:" prefix (models may still do this)
  // Example: "Emily: Hello" → "Hello"
  // Example: "Emily: [now] Hello" → "Hello" (with optional timestamp)
  const simpleNamePrefix = new RegExp(`^${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`, 'i');

  // Pattern: Standalone timestamp at start (no name)
  // Example: "[2m ago] Hello" → "Hello"
  const standaloneTimestamp = /^\[[^\]]+?\]\s*/;

  // Keep stripping until no more artifacts found
  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;

    // Strip trailing </message> tags first
    cleaned = cleaned.replace(trailingMessageTag, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // Strip leading XML message tag
    cleaned = cleaned.replace(xmlMessagePrefix, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // Strip simple name prefix
    cleaned = cleaned.replace(simpleNamePrefix, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // Strip standalone timestamp
    cleaned = cleaned.replace(standaloneTimestamp, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // No more artifacts found
    break;
  }

  // Log if we stripped anything meaningful
  if (cleaned !== originalContent) {
    const lengthDiff = originalContent.length - cleaned.length;

    if (lengthDiff > 0) {
      // Determine what was stripped for logging
      const strippedFromStart = originalContent.substring(
        0,
        originalContent.indexOf(cleaned.substring(0, 20)) || lengthDiff
      );
      const strippedFromEnd = originalContent.endsWith(cleaned)
        ? ''
        : originalContent.substring(originalContent.lastIndexOf(cleaned) + cleaned.length);

      const strippedContent = (strippedFromStart + strippedFromEnd).trim();

      if (strippedContent.length > 0) {
        logger.warn(
          {
            personalityName,
            strippedContent:
              strippedContent.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW) +
              (strippedContent.length > TEXT_LIMITS.LOG_PERSONA_PREVIEW ? '...' : ''),
            strippedCount,
            wasStripped: true,
          },
          `[ResponseCleanup] Stripped ${strippedCount} artifact(s) from response. ` +
            `LLM learned pattern from conversation history.`
        );
      }
    }
  }

  return cleaned;
}
