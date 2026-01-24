/**
 * Profile Dashboard Configuration
 *
 * Defines the structure and behavior of the profile editing dashboard.
 * Uses the Dashboard Framework pattern for consistent UX.
 */

import { DISCORD_COLORS } from '@tzurot/common-types';
import type { DashboardConfig } from '../../../utils/dashboard/types.js';
import type { FlattenedProfileData, PersonaDetails } from './types.js';
import { identitySection } from './profileSections.js';

// Re-export types for backward compatibility
export type { FlattenedProfileData, PersonaDetails } from './types.js';

/**
 * Convert API response to flattened form data
 */
export function flattenProfileData(data: PersonaDetails): FlattenedProfileData {
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? '',
    preferredName: data.preferredName ?? '',
    pronouns: data.pronouns ?? '',
    content: data.content ?? '',
    isDefault: data.isDefault,
  };
}

/**
 * Convert flattened form data back to API update payload
 */
export function unflattenProfileData(flat: Partial<FlattenedProfileData>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (flat.name !== undefined && flat.name.length > 0) {
    result.name = flat.name;
  }
  if (flat.description !== undefined) {
    result.description = flat.description.length > 0 ? flat.description : null;
  }
  if (flat.preferredName !== undefined) {
    result.preferredName = flat.preferredName.length > 0 ? flat.preferredName : null;
  }
  if (flat.pronouns !== undefined) {
    result.pronouns = flat.pronouns.length > 0 ? flat.pronouns : null;
  }
  if (flat.content !== undefined) {
    result.content = flat.content.length > 0 ? flat.content : null;
  }

  return result;
}

// --- Dashboard Config ---

export const PROFILE_DASHBOARD_CONFIG: DashboardConfig<FlattenedProfileData> = {
  entityType: 'profile',
  getTitle: data => `👤 Profile: ${data.name}`,
  getDescription: data => {
    const badges: string[] = [];
    if (data.isDefault) {
      badges.push('⭐ Default Profile');
    }
    if (data.preferredName) {
      badges.push(`📛 "${data.preferredName}"`);
    }
    if (data.pronouns) {
      badges.push(`🏷️ ${data.pronouns}`);
    }
    return badges.length > 0 ? badges.join(' • ') : '';
  },
  sections: [identitySection],
  actions: [], // No custom dropdown actions - delete is handled via button
  getFooter: () => 'Select a section to edit • Changes save automatically',
  color: DISCORD_COLORS.BLURPLE,
};

/**
 * Seed modal field definitions for creating a new profile
 * Minimal fields required to create a profile - user can configure more via dashboard
 */
export const profileSeedFields = [
  {
    id: 'name',
    label: 'Profile Name',
    placeholder: 'e.g., Main, Work, Creative',
    required: true,
    style: 'short' as const,
    maxLength: 100,
  },
  {
    id: 'preferredName',
    label: 'Preferred Name (what AI calls you)',
    placeholder: 'e.g., Alex, Your Majesty',
    required: false,
    style: 'short' as const,
    maxLength: 100,
  },
];
