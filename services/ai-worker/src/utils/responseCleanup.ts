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
 */
export function stripPersonalityPrefix(
  content: string,
  personalityName: string
): string {
  // Pattern: "PersonalityName: [timestamp] rest of content"
  // or: "PersonalityName: rest of content"
  const prefixPattern = new RegExp(
    `^${escapeRegex(personalityName)}:\\s*(?:\\[.*?\\]\\s*)?`,
    'i' // Case insensitive
  );

  const cleaned = content.replace(prefixPattern, '').trim();

  if (cleaned !== content) {
    logger.warn(
      {
        personalityName,
        originalPrefix: content.substring(0, Math.min(100, content.indexOf('\n') || 100)),
        wasStripped: true
      },
      '[ResponseCleanup] Stripped personality prefix from response (model ignored prompt instructions)'
    );
  }

  return cleaned;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
