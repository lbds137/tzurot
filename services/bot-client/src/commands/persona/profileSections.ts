/**
 * Profile Dashboard Section Definitions
 *
 * Defines the UI sections for the profile editing dashboard.
 * Profile has fewer fields than presets, so we use a single section.
 */

import { SectionStatus, type SectionDefinition } from '../../utils/dashboard/types.js';
import type { FlattenedPersonaData } from './types.js';

/**
 * Identity section - all profile fields
 * Contains name, preferred name, pronouns, description, and content
 * (5 fields = Discord modal maximum)
 */
export const identitySection: SectionDefinition<FlattenedPersonaData> = {
  id: 'identity',
  label: '📝 Profile Info',
  description: 'Name, preferred name, pronouns, and description',
  fieldIds: ['name', 'preferredName', 'pronouns', 'description', 'content'],
  fields: [
    {
      id: 'name',
      label: 'Profile Name',
      placeholder: 'My Main Profile',
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
      placeholder: 'Brief description of this profile',
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
    // Profile is complete if it has name and at least some content
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
