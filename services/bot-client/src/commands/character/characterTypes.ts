/**
 * Character Data Type
 *
 * Leaf module defining the API-response shape for a character (personality).
 * Exists to break the circular import between `config.ts` (which composes
 * section definitions into a dashboard config) and `sections.ts` (which
 * declares the section definitions parameterized by `CharacterData`).
 */

import type { PersonalityCharacterFields } from '@tzurot/common-types';
import type { BrowseContext } from '../../utils/dashboard/index.js';

/**
 * Character data structure (from API)
 * Index signature uses `unknown` for Record<string, unknown> compatibility
 * while preserving strict types for known properties.
 */
export interface CharacterData extends PersonalityCharacterFields {
  [key: string]: unknown;
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  characterInfo: string;
  personalityTraits: string;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  isPublic: boolean;
  voiceEnabled: boolean;
  /** Whether the character has a voice reference uploaded (from API) */
  hasVoiceReference: boolean;
  imageEnabled: boolean;
  ownerId: string;
  avatarData: string | null; // Base64-encoded
  createdAt: string;
  updatedAt: string;
  /** Whether the current user can edit this character (set by API based on ownership) */
  canEdit?: boolean;
  /** Browse context when opened from browse (for back navigation) */
  browseContext?: BrowseContext;
}
