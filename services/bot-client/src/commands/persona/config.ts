/**
 * Persona Dashboard Configuration
 *
 * Defines the structure and behavior of the persona editing dashboard.
 * Uses the Dashboard Framework pattern for consistent UX.
 *
 * IMPORTANT: entityType = 'persona' so customIds route via command name
 * (no componentPrefixes hack needed)
 */

import { DISCORD_COLORS } from '@tzurot/common-types';
import {
  SectionStatus,
  type SectionDefinition,
  type DashboardConfig,
} from '../../utils/dashboard/types.js';
import type { ActionButtonOptions } from '../../utils/dashboard/index.js';
import type { FlattenedPersonaData, PersonaDetails } from './types.js';

// Re-export types for convenience
export type { FlattenedPersonaData } from './types.js';

/**
 * Convert API response to flattened form data
 */
export function flattenPersonaData(data: PersonaDetails): FlattenedPersonaData {
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
export function unflattenPersonaData(flat: Partial<FlattenedPersonaData>): Record<string, unknown> {
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
  // Content is required in the database - only include if non-empty.
  // Empty content means "preserve existing value" (don't include in update payload).
  if (flat.content !== undefined && flat.content.length > 0) {
    result.content = flat.content;
  }

  return result;
}

// --- Dashboard Section Definitions ---

/**
 * Identity section - all persona fields
 * Contains name, preferred name, pronouns, description, and content
 * (5 fields = Discord modal maximum)
 */
const identitySection: SectionDefinition<FlattenedPersonaData> = {
  id: 'identity',
  label: '📝 Persona Info',
  description: 'Name, preferred name, pronouns, and description',
  fieldIds: ['name', 'preferredName', 'pronouns', 'description', 'content'],
  fields: [
    {
      id: 'name',
      label: 'Persona Name',
      placeholder: 'My Main Persona',
      required: true,
      style: 'short',
      maxLength: 100,
    },
    {
      id: 'preferredName',
      label: 'Preferred Name (what AI calls you)',
      placeholder: 'e.g., Alex, Your Highness',
      required: false,
      style: 'short',
      maxLength: 100,
    },
    {
      id: 'pronouns',
      label: 'Pronouns',
      placeholder: 'e.g., she/her, they/them, he/him',
      required: false,
      style: 'short',
      maxLength: 50,
    },
    {
      id: 'description',
      label: 'Short Description',
      placeholder: 'Brief description of this persona',
      required: false,
      style: 'short',
      maxLength: 200,
    },
    {
      id: 'content',
      label: 'About You (shared with AI)',
      placeholder: 'Tell the AI about yourself, your interests, preferences...',
      required: false,
      style: 'paragraph',
      maxLength: 2000,
    },
  ],
  getStatus: data => {
    if (!data.name) {
      return SectionStatus.EMPTY;
    }
    // Persona is complete if it has name and at least some content
    const hasExtras = data.preferredName || data.pronouns || data.content;
    return hasExtras ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.name) {
      parts.push(`**Name:** ${data.name}`);
    }
    if (data.preferredName) {
      parts.push(`**Called:** ${data.preferredName}`);
    }
    if (data.pronouns) {
      parts.push(`**Pronouns:** ${data.pronouns}`);
    }
    if (data.content) {
      const preview = data.content.length > 100 ? data.content.slice(0, 100) + '...' : data.content;
      parts.push(`**About:** ${preview}`);
    }
    return parts.length > 0 ? parts.join('\n') : '_Not configured_';
  },
};

// --- Dashboard Config ---

/**
 * Persona dashboard configuration
 *
 * IMPORTANT: entityType = 'persona' matches command name = 'persona'
 * This means customIds like 'persona::menu::...' route correctly without
 * needing componentPrefixes (unlike the /me command which needed 'profile')
 */
export const PERSONA_DASHBOARD_CONFIG: DashboardConfig<FlattenedPersonaData> = {
  entityType: 'persona', // Matches command name - no componentPrefixes needed!
  getTitle: data => `👤 Persona: ${data.name}`,
  getDescription: data => {
    const badges: string[] = [];
    if (data.isDefault) {
      badges.push('⭐ Default Persona');
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
 * Seed modal field definitions for creating a new persona
 * Minimal fields required to create a persona - user can configure more via dashboard
 */
/**
 * Build dashboard button options for personas.
 * Delete button only shown for non-default personas.
 * Back button shown when opened from browse (preserves navigation context).
 */
export function buildPersonaDashboardOptions(data: FlattenedPersonaData): ActionButtonOptions {
  const hasBackContext = data.browseContext !== undefined;
  return {
    showClose: !hasBackContext, // Only show close if not from browse
    showBack: hasBackContext, // Show back if opened from browse
    showRefresh: true,
    showDelete: !data.isDefault, // Can't delete default persona
  };
}

export const personaSeedFields = [
  {
    id: 'name',
    label: 'Persona Name',
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
