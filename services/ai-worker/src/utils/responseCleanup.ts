/**
 * Response Cleanup Utilities
 *
 * Defensive cleaning of AI-generated responses to handle cases where the model
 * ignores instructions and adds unwanted prefixes/formatting.
 */

import { createLogger, TEXT_LIMITS } from '@tzurot/common-types';

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

  // Pattern 1a: Markdown bold around name - strip entirely
  // Examples: "**Emily:** content" → "content", "**COLD**: content" → "content"
  // The colon can be inside (**NAME:**) or outside (**NAME**:) the bold
  const boldNamePattern = new RegExp(
    `^\\*\\*${escapedName}:?\\*?\\*?:?\\s*(?:\\[[^\\]]+?\\]\\s*)?`,
    'i'
  );

  // Pattern 1b-i: Closed roleplay asterisk around name - strip entirely
  // When the prefix has BOTH leading and trailing asterisks WITH NO SPACE between them
  // Example: "*COLD: [timestamp]*content" → "content"
  // Example: "*COLD: [timestamp]**roleplay*" → "*roleplay*"
  // IMPORTANT: No \s* before closing \* - if there's a space, the asterisk is
  // the START of roleplay content, not the end of the name wrapper
  // Example: "*Name: [timestamp] *giggles*" → the space+* is start of action
  const closedRoleplayNamePattern = new RegExp(
    `^\\*${escapedName}:\\s*(?:\\[[^\\]]+?\\])?\\*`,
    'i'
  );

  // Pattern 1b-ii: Space-separated roleplay prefix followed by content asterisk
  // When space separates prefix from content AND content starts with its own asterisk,
  // the asterisks are separate elements - strip prefix entirely (including its asterisk)
  // Example: "*Name: [ts] *giggles*" → "*giggles*"
  // Uses positive lookahead (?=\\*) to match without consuming the content asterisk
  const spaceSeparatedRoleplayPattern = new RegExp(
    `^\\*${escapedName}:\\s*(?:\\[[^\\]]+?\\])?\\s+(?=\\*)`,
    'i'
  );

  // Pattern 1b-iii: Open roleplay asterisk before name - preserve the asterisk
  // When only the leading asterisk exists, it continues into the content
  // Example: "*COLD: content" → "*content"
  const openRoleplayNamePattern = new RegExp(
    `^(\\*)${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`,
    'i'
  );

  // Pattern 1c: Plain name prefix - strip entirely
  // Example: "Lilith: [2m ago] content" → "content"
  const plainNamePattern = new RegExp(`^${escapedName}:\\s*(?:\\[[^\\]]+?\\]\\s*)?`, 'i');

  // Pattern 2: Standalone "[timestamp]" at the start (no name prefix)
  // Example: "[2m ago] content" - happens when AI strips name but leaves timestamp
  const standaloneTimestampPattern = /^\[[^\]]+?\]\s*/;

  // Keep stripping until no more prefixes found
  while (strippedCount < maxIterations) {
    const beforeStrip = cleaned;

    // Try patterns in order of specificity
    // 1. Markdown bold (**NAME:**) - strip entirely
    cleaned = cleaned.replace(boldNamePattern, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // 2a. Closed roleplay asterisk (*NAME:*) - strip entirely
    cleaned = cleaned.replace(closedRoleplayNamePattern, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // 2b. Space-separated roleplay (*NAME: *content) - strip prefix entirely
    // Must come before open pattern since it's more specific
    cleaned = cleaned.replace(spaceSeparatedRoleplayPattern, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // 2c. Open roleplay asterisk (*NAME:) - preserve the asterisk
    cleaned = cleaned.replace(openRoleplayNamePattern, '$1').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // 3. Plain name prefix (NAME:) - strip entirely
    cleaned = cleaned.replace(plainNamePattern, '').trim();
    if (cleaned !== beforeStrip) {
      strippedCount++;
      continue;
    }

    // 4. Standalone timestamp
    cleaned = cleaned.replace(standaloneTimestampPattern, '').trim();
    if (cleaned === beforeStrip) {
      // No more prefixes found
      break;
    }

    strippedCount++;
  }

  // Log if we stripped anything (but skip if only whitespace was removed)
  if (cleaned !== originalContent) {
    const strippedPrefix = originalContent
      .substring(0, originalContent.length - cleaned.length)
      .trim();

    // Only log if we actually stripped meaningful content (not just whitespace)
    if (strippedPrefix.length > 0) {
      logger.warn(
        {
          personalityName,
          strippedPrefix,
          strippedCount,
          wasStripped: true,
        },
        `[ResponseCleanup] Stripped ${strippedCount} prefix(es) from response. ` +
          `LLM learned the prefix pattern from conversation history. ` +
          `Prefix(es): "${strippedPrefix.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW)}${strippedPrefix.length > TEXT_LIMITS.LOG_PERSONA_PREVIEW ? '...' : ''}"`
      );
    }
  }

  return cleaned;
}
