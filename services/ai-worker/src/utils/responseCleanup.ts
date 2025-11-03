/**
 * Response Cleanup Utilities
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * ignores instructions and adds unwanted prefixes/formatting.
 */

import { createLogger } from '@tzurot/common-types';

const logger = createLogger('ResponseCleanup');

// Cache compiled regex patterns per personality for performance
const patternCache = new Map<string, RegExp>();

// Track which personalities we've logged about to prevent spam
// (some models consistently add prefixes)
const loggedPersonalities = new Set<string>();

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
  // Get cached pattern or create new one
  let prefixPattern = patternCache.get(personalityName);

  if (!prefixPattern) {
    // Pattern: "PersonalityName: [timestamp] rest of content"
    // or: "PersonalityName: rest of content"
    // Note: [^\\]]+ ensures timestamp doesn't span lines or contain closing brackets
    prefixPattern = new RegExp(
      `^${escapeRegex(personalityName)}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`,
      'i' // Case insensitive
    );
    patternCache.set(personalityName, prefixPattern);
  }

  const cleaned = content.replace(prefixPattern, '').trim();

  if (cleaned !== content) {
    // Log only once per personality to avoid spam
    // (some models like Claude Haiku consistently add prefixes)
    if (!loggedPersonalities.has(personalityName)) {
      logger.info(
        {
          personalityName,
          originalPrefix: content.substring(0, Math.min(100, content.indexOf('\n') || 100)),
          wasStripped: true,
        },
        '[ResponseCleanup] Stripped personality prefix from response (model ignored prompt instructions). ' +
          'Further occurrences for this personality will not be logged.'
      );
      loggedPersonalities.add(personalityName);
    }
  }

  return cleaned;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
