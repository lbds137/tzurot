/**
 * Character View Types and Constants
 */

import type { CharacterData } from './characterTypes.js';

/** Number of pages for character view */
export const VIEW_TOTAL_PAGES = 4;

/** Page titles for character view - aligned with edit section names */
export const VIEW_PAGE_TITLES = [
  '🏷️ Identity & Basics',
  '📖 Biography & Appearance',
  '❤️ Preferences',
  '💬 Conversation',
];

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
