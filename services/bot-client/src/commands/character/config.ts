/**
 * Character Dashboard Configuration
 *
 * Defines the dashboard layout for character (personality) editing.
 * Organizes fields into logical sections that fit Discord's 5-field modal limit.
 */

import { DISCORD_COLORS, formatDateShort } from '@tzurot/common-types';
import { type DashboardConfig, type ActionButtonOptions } from '../../utils/dashboard/index.js';
import {
  identitySection,
  biographySection,
  preferencesSection,
  conversationSection,
  adminSection,
} from './sections.js';
import type { CharacterData } from './characterTypes.js';

/** Browse filter options */
export type CharacterBrowseFilter = 'all' | 'mine' | 'public';

/** Sort options */
export type CharacterBrowseSortType = 'date' | 'name';

/**
 * Session data stored during character dashboard editing.
 * Extends CharacterData with admin flag for audit/debugging only.
 */
export interface CharacterSessionData extends CharacterData {
  /**
   * Whether the session was opened by a bot admin.
   * Stored for audit/debugging only - always re-verify with isBotOwner() for authorization.
   */
  _isAdmin?: boolean;
}

/**
 * Build dashboard action button options based on character state.
 *
 * Controls which dashboard chrome buttons (close, back, refresh, delete)
 * are visible. Close and Back are mutually exclusive: Back appears when
 * the dashboard was opened from a browse list, Close appears otherwise.
 *
 * @param data - Current character data (needs canEdit and browseContext)
 * @returns Action button visibility flags for buildDashboardComponents
 */
export function buildCharacterDashboardOptions(data: CharacterData): ActionButtonOptions {
  const hasBackContext = data.browseContext !== undefined;
  return {
    showClose: !hasBackContext, // Only show close if not from browse
    showBack: hasBackContext, // Show back if opened from browse
    showRefresh: true,
    showDelete: data.canEdit, // Only show delete for owned characters
  };
}

/**
 * Base character dashboard configuration.
 *
 * Not exported — callers MUST use {@link getCharacterDashboardConfig} to get a
 * config with the correct admin sections and conditional voice actions applied.
 */
const baseCharacterDashboardConfig: DashboardConfig<CharacterData> = {
  entityType: 'character',
  getTitle: (data: CharacterData) => {
    const displayName = data.displayName ?? data.name;
    return `📝 Editing: ${displayName}`;
  },
  getDescription: (data: CharacterData) => {
    const visibility = data.isPublic ? '🌐 Public' : '🔒 Private';
    // Show voice status only when a voice reference exists
    const voice = data.hasVoiceReference
      ? data.voiceEnabled
        ? '🎤 Voice On'
        : '🔇 Voice Off'
      : '';
    const image = data.imageEnabled ? '🖼️ Images On' : '';
    const features = [visibility, voice, image].filter(Boolean).join(' • ');

    return `**Slug:** \`${data.slug}\`\n${features}`;
  },
  sections: [identitySection, biographySection, preferencesSection, conversationSection],
  actions: [
    {
      id: 'visibility',
      label: 'Toggle Visibility',
      description: 'Switch between public and private',
      emoji: '👁️',
    },
    {
      id: 'avatar',
      label: 'Change Avatar',
      description: 'Upload a new avatar image',
      emoji: '🖼️',
    },
    {
      id: 'voice',
      label: 'Change Voice',
      description: 'Upload or clear a voice reference for TTS',
      emoji: '🎤',
    },
  ],
  getFooter: (data: CharacterData) => {
    const created = formatDateShort(data.createdAt);
    const updated = formatDateShort(data.updatedAt);
    return `Created: ${created} • Updated: ${updated}`;
  },
  color: DISCORD_COLORS.BLURPLE,
};

/**
 * Get character dashboard config with optional admin sections and conditional actions.
 *
 * Use this instead of `baseCharacterDashboardConfig` directly so that admin-only
 * sections and voice-dependent actions are correctly included/excluded.
 *
 * @param isAdmin - Whether the current user is a bot owner (adds admin section)
 * @param hasVoiceReference - Whether the character has a voice reference uploaded
 *   (adds "Toggle Voice" action when true)
 */
export function getCharacterDashboardConfig(
  isAdmin: boolean,
  hasVoiceReference: boolean
): DashboardConfig<CharacterData> {
  const sections = [identitySection, biographySection, preferencesSection, conversationSection];
  if (isAdmin) {
    sections.push(adminSection);
  }

  const actions = [...(baseCharacterDashboardConfig.actions ?? [])];
  if (hasVoiceReference) {
    actions.push({
      id: 'voice-toggle',
      label: 'Toggle Voice',
      description: 'Enable or disable TTS responses',
      emoji: '🔊',
    });
  }

  return { ...baseCharacterDashboardConfig, sections, actions };
}

/**
 * Seed modal field definitions for creating a new character
 * Minimal fields required to create a character
 */
export const characterSeedFields = [
  {
    id: 'name',
    label: 'Character Name',
    placeholder: 'e.g., Luna',
    required: true,
    style: 'short' as const,
    maxLength: 255,
  },
  {
    id: 'slug',
    label: 'Unique ID (Slug)',
    placeholder: 'e.g., luna (lowercase, hyphens only)',
    required: true,
    style: 'short' as const,
    maxLength: 255,
  },
  {
    id: 'characterInfo',
    label: 'Character Info',
    placeholder: 'Brief background and description...',
    required: true,
    style: 'paragraph' as const,
    maxLength: 2000,
  },
  {
    id: 'personalityTraits',
    label: 'Personality Traits',
    placeholder: 'Key traits and behaviors...',
    required: true,
    style: 'paragraph' as const,
    maxLength: 2000,
  },
];
