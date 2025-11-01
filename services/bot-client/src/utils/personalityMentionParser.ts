/**
 * Utility for parsing personality mentions from Discord messages
 *
 * Handles complex cases like:
 * - Multi-word personalities (@Bambi Prime, @Angel Dust)
 * - Overlapping mentions (@Bambi @Bambi Prime → prefers longer)
 * - Multiple personalities in one message
 */

import type { PersonalityService } from '@tzurot/common-types';

const MAX_MENTION_WORDS = 4;

export interface PersonalityMentionResult {
  personalityName: string;
  cleanContent: string;
}

/**
 * Find the best matching personality mention in a message
 *
 * **Behavior: Longest Match Wins**
 * When multiple personalities are mentioned (e.g., "@Bambi @Bambi Prime"),
 * returns the LONGEST valid personality match to handle overlapping names.
 * Only ONE personality is returned - multi-personality responses are not yet supported.
 *
 * **Examples:**
 * - "@Bambi @Bambi Prime" → Returns "Bambi Prime" (12 chars > 5 chars)
 * - "@Lilith @Sarcastic" → Returns "Sarcastic" (9 chars > 6 chars)
 * - "@Unknown @Lilith" → Returns "Lilith" (ignores unknown personalities)
 *
 * **Discord User Filtering:**
 * Ignores numeric-only mentions (Discord user IDs like <@123456789>)
 *
 * @param content - The message content to search
 * @param mentionChar - The character used for mentions (from BOT_MENTION_CHAR config)
 * @param personalityService - Service to validate personality names
 * @returns The best matching personality and cleaned content, or null if none found
 */
export async function findPersonalityMention(
  content: string,
  mentionChar: string,
  personalityService: PersonalityService
): Promise<PersonalityMentionResult | null> {
  const escapedChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Try multi-word mentions FIRST (e.g., @Angel Dust, @Bambi Prime)
  const multiWordMatch = await findMultiWordMention(content, escapedChar, personalityService);
  if (multiWordMatch) {
    return multiWordMatch;
  }

  // Fall back to single-word mentions (e.g., @Lilith, @Ha-Shem)
  return findSingleWordMention(content, escapedChar, personalityService);
}

/**
 * Find multi-word personality mentions (up to MAX_MENTION_WORDS)
 * Returns the LONGEST successful match when multiple mentions exist
 */
async function findMultiWordMention(
  content: string,
  escapedChar: string,
  personalityService: PersonalityService
): Promise<PersonalityMentionResult | null> {
  // Pattern: @word1 word2 word3... (up to MAX_MENTION_WORDS)
  // Stops at next @ or whitespace boundary
  const multiWordRegex = new RegExp(
    `${escapedChar}([^\\s${escapedChar}\\n]+(?:\\s+[^\\s${escapedChar}\\n]+){0,${MAX_MENTION_WORDS - 1}})`,
    'gi'
  );

  const matches = content.match(multiWordRegex);
  if (!matches) {
    return null;
  }

  // Check ALL matches and return the LONGEST successful match
  // This ensures "@Bambi Prime" is preferred over "@Bambi" when both are present
  let longestMatch: PersonalityMentionResult | null = null;
  let longestMatchLength = 0;

  for (const fullMatch of matches) {
    // Clean up the matched text
    const capturedText = fullMatch
      .replace(new RegExp(`^${escapedChar}`), '') // Remove mention char
      .replace(/[.,!?;:)"']+$/, ''); // Remove trailing punctuation

    // Split into words and remove punctuation from each
    const words = capturedText.split(/\s+/).map(word =>
      word.replace(/[.,!?;:)"']+$/g, '')
    );

    // Try combinations from longest to shortest for this match
    for (let wordCount = Math.min(MAX_MENTION_WORDS, words.length); wordCount >= 1; wordCount--) {
      const potentialName = words.slice(0, wordCount).join(' ');

      // Check if this personality exists
      const personality = await personalityService.loadPersonality(potentialName);
      if (personality && potentialName.length > longestMatchLength) {
        // Found a longer match! Update our result
        const matchRegex = new RegExp(
          `${escapedChar}${potentialName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[.,!?;:)"']|\\s|$)`,
          'gi' // Note: 'gi' flag removes ALL occurrences of the mention
        );
        const cleanContent = content.replace(matchRegex, '').trim();
        longestMatch = { personalityName: potentialName, cleanContent };
        longestMatchLength = potentialName.length;
        break; // Found a match for this captured text, move to next match
      }
    }
  }

  return longestMatch;
}

/**
 * Find single-word personality mentions
 * Fallback when multi-word matching finds nothing
 * Checks ALL matches and returns the longest valid personality
 */
async function findSingleWordMention(
  content: string,
  escapedChar: string,
  personalityService: PersonalityService
): Promise<PersonalityMentionResult | null> {
  // Pattern: @name followed by punctuation, whitespace, or end of string
  const singleWordRegex = new RegExp(
    `${escapedChar}([\\w-]+)(?:[.,!?;:)"']|\\s|$)`,
    'gi'
  );

  const matches = content.match(singleWordRegex);
  if (!matches) {
    return null;
  }

  // Check ALL matches and return the longest valid personality
  let longestMatch: PersonalityMentionResult | null = null;
  let longestMatchLength = 0;

  for (const fullMatch of matches) {
    const personalityName = fullMatch
      .replace(new RegExp(`^${escapedChar}`), '')
      .replace(/[.,!?;:)"']+$/g, '')
      .trim();

    // Ignore Discord user ID mentions (all digits)
    if (/^\d+$/.test(personalityName)) {
      continue;
    }

    const personality = await personalityService.loadPersonality(personalityName);
    if (personality && personalityName.length > longestMatchLength) {
      const matchRegex = new RegExp(
        `${escapedChar}${personalityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[.,!?;:)"']|\\s|$)`,
        'gi'
      );
      const cleanContent = content.replace(matchRegex, '').trim();
      longestMatch = { personalityName, cleanContent };
      longestMatchLength = personalityName.length;
    }
  }

  return longestMatch;
}
