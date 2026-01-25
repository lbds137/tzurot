/**
 * Utility for parsing personality mentions from Discord messages
 *
 * Handles complex cases like:
 * - Multi-word personalities (@Bambi Prime, @Angel Dust)
 * - Overlapping mentions (@Bambi @Bambi Prime → prefers longer)
 * - Multiple personalities in one message
 *
 * **Performance**: Batches all personality lookups to minimize database calls
 */

import { createLogger } from '@tzurot/common-types';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';

const logger = createLogger('PersonalityMentionParser');
const MAX_MENTION_WORDS = 4;
const MAX_POTENTIAL_MENTIONS = 10; // Security: Prevent resource exhaustion from excessive @mentions

export interface PersonalityMentionResult {
  personalityName: string;
  cleanContent: string;
}

interface PotentialMention {
  name: string;
  wordCount: number;
}

/**
 * Find the best matching personality mention in a message
 *
 * **Behavior: Word Count First, Then Length**
 * Prioritizes multi-word personalities over single-word, then character length as tiebreaker.
 * Only ONE personality is returned - multi-personality responses are not yet supported.
 *
 * **Priority Rules:**
 * 1. Word count (more words = higher priority)
 * 2. Character length (longer = higher priority, as tiebreaker)
 * 3. Order of appearance (if tied on word count and length)
 *
 * **Examples:**
 * - "@Bambi @Bambi Prime" → Returns "Bambi Prime" (2 words > 1 word)
 * - "@Bambi Prime @Administrator" → Returns "Bambi Prime" (2 words > 1 word, even though Administrator is longer)
 * - "@Lilith @Sarcastic" → Returns "Sarcastic" (both 1 word, so 9 chars > 6 chars)
 * - "@Unknown @Lilith" → Returns "Lilith" (ignores unknown personalities)
 *
 * **Duplicate Mention Behavior:**
 * When the selected personality is mentioned multiple times, ALL occurrences are removed from cleanContent.
 * - "@Bambi Prime @Bambi Prime, how are you?" → Returns "Bambi Prime" with cleanContent ", how are you?"
 * This is intentional to avoid leaving redundant mentions in the message.
 *
 * **Discord User Filtering:**
 * Ignores numeric-only mentions (Discord user IDs like <@123456789>)
 *
 * **Security:**
 * Limits processing to MAX_POTENTIAL_MENTIONS (10) to prevent resource exhaustion attacks
 *
 * **Access Control:**
 * When userId is provided, only matches personalities that the user has access to
 * (public personalities or ones they own)
 *
 * **Performance:**
 * Batches all personality lookups into a single Promise.all() to minimize database calls
 *
 * @param content - The message content to search
 * @param mentionChar - The character used for mentions (from BOT_MENTION_CHAR config)
 * @param personalityService - Service to validate personality names
 * @param userId - Discord user ID for access control
 * @returns The best matching personality and cleaned content, or null if none found
 */
export async function findPersonalityMention(
  content: string,
  mentionChar: string,
  personalityService: IPersonalityLoader,
  userId: string
): Promise<PersonalityMentionResult | null> {
  logger.debug({ content, mentionChar }, '[PersonalityMentionParser] Parsing mentions');

  const escapedChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionCharRegex = new RegExp(`^${escapedChar}`);
  // Discord markdown chars (*_~|) plus standard punctuation - used to strip after extraction
  const trailingPunctuationRegex = /[.,!?;:)"'*_~|]+$/; // No 'g' flag needed - replace() doesn't use lastIndex

  // Step 1: Extract all potential personality names from the message
  const potentialMentions = extractPotentialMentions(
    content,
    escapedChar,
    mentionCharRegex,
    trailingPunctuationRegex
  );

  if (potentialMentions.length === 0) {
    logger.debug('[PersonalityMentionParser] No potential mentions found');
    return null;
  }

  // Security: Limit number of mentions to prevent resource exhaustion
  if (potentialMentions.length > MAX_POTENTIAL_MENTIONS) {
    logger.warn(
      { count: potentialMentions.length, limit: MAX_POTENTIAL_MENTIONS },
      '[PersonalityMentionParser] Too many mentions, truncating to prevent abuse'
    );
    potentialMentions.length = MAX_POTENTIAL_MENTIONS;
  }

  logger.debug(
    { potentialMentions: potentialMentions.map(m => m.name) },
    `[PersonalityMentionParser] Found ${potentialMentions.length} potential mention(s)`
  );

  // Step 2: Batch lookup all potential personalities at once (performance optimization)
  // Pass userId for access control - only matches accessible personalities
  const lookupResults = await Promise.all(
    potentialMentions.map(async ({ name, wordCount }) => {
      const personality = await personalityService.loadPersonality(name, userId);
      return personality ? { name, wordCount, isValid: true } : null;
    })
  );

  // Step 3: Filter out invalid personalities and sort by priority
  const validMentions = lookupResults
    .filter(
      (result): result is { name: string; wordCount: number; isValid: true } => result !== null
    )
    .sort((a, b) => {
      // Priority 1: Word count (multi-word beats single-word)
      if (a.wordCount !== b.wordCount) {
        return b.wordCount - a.wordCount; // Descending
      }
      // Priority 2: Character length (tiebreaker)
      return b.name.length - a.name.length; // Descending
    });

  if (validMentions.length === 0) {
    logger.debug('[PersonalityMentionParser] No valid personalities found');
    return null;
  }

  // Step 4: Return the highest priority match
  const bestMatch = validMentions[0];

  logger.debug(
    {
      personalityName: bestMatch.name,
      wordCount: bestMatch.wordCount,
      allMatches: validMentions.map(m => m.name),
    },
    '[PersonalityMentionParser] Found personality mention (highest priority match)'
  );

  // Step 5: Clean the content by removing the matched personality mention
  // Include Discord markdown chars (*_~|) as valid word boundaries
  const matchRegex = new RegExp(
    `${escapedChar}${bestMatch.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[.,!?;:)"'*_~|]|\\s|$)`,
    'gi' // Note: 'gi' flag removes ALL occurrences of the mention
  );
  const cleanContent = content.replace(matchRegex, '').trim();

  return {
    personalityName: bestMatch.name,
    cleanContent,
  };
}

/**
 * Extract all potential personality mentions from message content
 *
 * This function performs a two-pass extraction to find both multi-word and single-word
 * personality mentions, then deduplicates them to minimize database lookups.
 *
 * **Extraction Strategy:**
 * 1. **Multi-word pass**: Extracts mentions like "@Bambi Prime", "@Angel Dust"
 *    - Tries all word combinations from longest to shortest (up to MAX_MENTION_WORDS)
 *    - Example: "@Bambi Prime" generates candidates: "Bambi Prime", "Bambi"
 * 2. **Single-word pass**: Extracts mentions like "@Lilith", "@Sarcastic"
 *    - Filters out Discord user IDs (all-numeric mentions)
 *    - Filters out empty/whitespace-only names
 *
 * **Deduplication:**
 * Uses a Map to track unique personality names and their word counts.
 * This prevents redundant database lookups for the same personality.
 *
 * **Example:**
 * Input: "@Bambi @Bambi Prime @Lilith"
 * Output: [
 *   { name: "Bambi", wordCount: 1 },
 *   { name: "Bambi Prime", wordCount: 2 },
 *   { name: "Lilith", wordCount: 1 }
 * ]
 *
 * @param content - The message content to parse
 * @param escapedChar - The escaped mention character (e.g., "\\@")
 * @param mentionCharRegex - Regex to match and remove the mention character
 * @param trailingPunctuationRegex - Regex to remove trailing punctuation
 * @returns Array of unique potential mentions with their word counts
 */
function extractPotentialMentions(
  content: string,
  escapedChar: string,
  mentionCharRegex: RegExp,
  trailingPunctuationRegex: RegExp
): PotentialMention[] {
  const potentialMentions = new Map<string, number>(); // name -> word count (for deduplication)

  // Extract multi-word mentions (e.g., @Bambi Prime, @Angel Dust)
  // Regex: first word + up to (MAX_MENTION_WORDS - 1) more words = MAX_MENTION_WORDS total
  const multiWordRegex = new RegExp(
    `${escapedChar}([^\\s${escapedChar}\\n]+(?:\\s+[^\\s${escapedChar}\\n]+){0,${MAX_MENTION_WORDS - 1}})`,
    'gi'
  );
  const multiWordMatches = content.match(multiWordRegex);

  if (multiWordMatches) {
    for (const fullMatch of multiWordMatches) {
      // Clean up the matched text
      const capturedText = fullMatch
        .replace(mentionCharRegex, '') // Remove mention char
        .replace(trailingPunctuationRegex, ''); // Remove trailing punctuation

      // Split into words and remove punctuation from each
      const words = capturedText
        .split(/\s+/)
        .map(word => word.replace(trailingPunctuationRegex, ''));

      // Try combinations from longest to shortest for this match
      for (let wordCount = Math.min(MAX_MENTION_WORDS, words.length); wordCount >= 1; wordCount--) {
        const potentialName = words.slice(0, wordCount).join(' ').trim();

        // Only store non-empty names that we haven't seen yet
        if (potentialName && !potentialMentions.has(potentialName)) {
          potentialMentions.set(potentialName, wordCount);
        }
      }
    }
  }

  // Extract single-word mentions (e.g., @Lilith, @Ha-Shem)
  // Include Discord markdown chars (*_~|) as valid word boundaries
  const singleWordRegex = new RegExp(`${escapedChar}([\\w-]+)(?:[.,!?;:)"'*_~|]|\\s|$)`, 'gi');
  const singleWordMatches = content.match(singleWordRegex);

  if (singleWordMatches) {
    for (const fullMatch of singleWordMatches) {
      const personalityName = fullMatch
        .replace(mentionCharRegex, '')
        .replace(trailingPunctuationRegex, '')
        .trim();

      // Ignore Discord user ID mentions (all digits) or empty strings
      if (!personalityName || /^\d+$/.test(personalityName)) {
        continue;
      }

      // Deduplicate: only store if we haven't seen this name yet
      if (!potentialMentions.has(personalityName)) {
        potentialMentions.set(personalityName, 1); // Single word = word count of 1
      }
    }
  }

  // Convert Map to array of objects
  return Array.from(potentialMentions.entries()).map(([name, wordCount]) => ({
    name,
    wordCount,
  }));
}
