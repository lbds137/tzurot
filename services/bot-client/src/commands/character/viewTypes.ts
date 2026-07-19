/**
 * Character View Types and Constants
 */

import { DISCORD_LIMITS, TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import type { CharacterData } from './characterTypes.js';

/** Field info for tracking truncation */
export interface FieldInfo {
  value: string;
  wasTruncated: boolean;
  originalLength: number;
}

/**
 * Truncate text to fit Discord embed field limit (1024 chars)
 * Returns info about whether truncation occurred. Shared by the embed and
 * Components-V2 renderers so both truncate identically.
 */
export function truncateField(
  text: string | null | undefined,
  maxLength = DISCORD_LIMITS.EMBED_FIELD - TEXT_LIMITS.TRUNCATION_SUFFIX.length
): FieldInfo {
  if (text === null || text === undefined || text.length === 0) {
    return { value: '_Not set_', wasTruncated: false, originalLength: 0 };
  }
  // Ensure maxLength doesn't exceed Discord's limit minus suffix
  const safeMax = Math.min(
    maxLength,
    DISCORD_LIMITS.EMBED_FIELD - TEXT_LIMITS.TRUNCATION_SUFFIX.length
  );
  if (text.length <= safeMax) {
    return { value: text, wasTruncated: false, originalLength: text.length };
  }
  return {
    value: text.slice(0, safeMax) + TEXT_LIMITS.TRUNCATION_SUFFIX,
    wasTruncated: true,
    originalLength: text.length,
  };
}

/** Number of pages for character view */
export const VIEW_TOTAL_PAGES = 4;

/** Page titles for character view - aligned with edit section names */
export const VIEW_PAGE_TITLES = [
  '🏷️ Identity & Basics',
  '📖 Biography & Appearance',
  '❤️ Preferences',
  '💬 Conversation',
];

/**
 * Fields counted by the overview's "Configured:" line — shared by the embed
 * and Components-V2 renderers so they can't drift on what counts.
 */
export const OVERVIEW_FIELDS = [
  { key: 'characterInfo' as const, label: 'Background' },
  { key: 'personalityTraits' as const, label: 'Traits' },
  { key: 'personalityTone' as const, label: 'Tone' },
  { key: 'conversationalGoals' as const, label: 'Goals' },
  { key: 'conversationalExamples' as const, label: 'Examples' },
] as const;

/** Labels of the overview fields the character has filled in. */
export function getConfiguredFields(character: CharacterData): string[] {
  return OVERVIEW_FIELDS.filter(({ key }) => (character[key]?.length ?? 0) > 0).map(
    ({ label }) => label
  );
}

/** Map of field names to their display labels and character data keys */
export const EXPANDABLE_FIELDS: Record<string, { label: string; key: keyof CharacterData }> = {
  characterInfo: { label: '📝 Character Info', key: 'characterInfo' },
  personalityTraits: { label: '🎭 Personality Traits', key: 'personalityTraits' },
  personalityTone: { label: '🎨 Tone', key: 'personalityTone' },
  personalityAge: { label: '📅 Age', key: 'personalityAge' },
  personalityAppearance: { label: '👤 Appearance', key: 'personalityAppearance' },
  personalityLikes: { label: '❤️ Likes', key: 'personalityLikes' },
  personalityDislikes: { label: '💔 Dislikes', key: 'personalityDislikes' },
  conversationalGoals: { label: '🎯 Conversational Goals', key: 'conversationalGoals' },
  conversationalExamples: { label: '💬 Example Dialogues', key: 'conversationalExamples' },
  errorMessage: { label: '⚠️ Error Message', key: 'errorMessage' },
};
