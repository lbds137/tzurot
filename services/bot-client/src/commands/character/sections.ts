/**
 * Character Dashboard Section Definitions
 *
 * Defines the editable sections for the character dashboard.
 * Each section maps to a Discord modal with up to 5 fields.
 *
 * Extracted from config.ts to keep files under the max-lines limit
 * without trimming documentation.
 */

import { escapeMarkdown } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';
import {
  type SectionDefinition,
  type DashboardContext,
  SectionStatus,
} from '../../utils/dashboard/index.js';
import type { CharacterData } from './characterTypes.js';

/**
 * Truncate text for preview display
 */
function truncatePreview(text: string | null | undefined, maxLength = 100): string {
  if (text === null || text === undefined || text.length === 0) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Identity & Basics Section
 * Fields: name, displayName, personalityTraits, personalityTone, personalityAge
 * All short/medium fields grouped together (5 fields = Discord modal max)
 */
export const identitySection: SectionDefinition<CharacterData> = {
  id: 'identity',
  label: '🏷️ Identity & Basics',
  description: 'Name, traits, tone, and age',
  fieldIds: ['name', 'displayName', 'personalityTraits', 'personalityTone', 'personalityAge'],
  fields: [
    {
      id: 'name',
      label: 'Name',
      placeholder: 'Internal name for the character',
      required: true,
      style: 'short',
      maxLength: 255,
    },
    {
      id: 'displayName',
      label: 'Display Name',
      placeholder: 'Optional display name (shown in Discord)',
      required: false,
      style: 'short',
      maxLength: 255,
    },
    {
      id: 'personalityTraits',
      label: 'Personality Traits',
      placeholder: 'Key traits and behaviors...',
      required: true,
      style: 'paragraph',
      maxLength: 1000,
    },
    {
      id: 'personalityTone',
      label: 'Tone',
      placeholder: 'e.g., friendly, sarcastic, professional',
      required: false,
      style: 'short',
      maxLength: 255,
    },
    {
      id: 'personalityAge',
      label: 'Age',
      placeholder: 'Apparent age or age range',
      required: false,
      style: 'short',
      maxLength: 100,
    },
  ],
  getStatus: (data: CharacterData) => {
    const hasName = data.name !== null && data.name.length > 0;
    const hasTraits = data.personalityTraits.length > 0;
    if (hasName && hasTraits) {
      return SectionStatus.COMPLETE;
    }
    if (hasName) {
      return SectionStatus.PARTIAL;
    }
    return SectionStatus.EMPTY;
  },
  getPreview: (data: CharacterData) => {
    const display = escapeMarkdown(data.displayName ?? data.name);
    const parts: string[] = [`**${display}** (slug: \`${data.slug}\`)`];
    if (data.personalityTone !== null && data.personalityTone.length > 0) {
      parts.push(`🎭 ${escapeMarkdown(data.personalityTone)}`);
    }
    if (data.personalityAge !== null && data.personalityAge.length > 0) {
      parts.push(`📅 ${escapeMarkdown(data.personalityAge)}`);
    }
    return parts.join(' • ');
  },
};

/**
 * Biography & Appearance Section
 * Fields: characterInfo, personalityAppearance
 * Both are long fields (4000 chars each)
 */
export const biographySection: SectionDefinition<CharacterData> = {
  id: 'biography',
  label: '📖 Biography & Appearance',
  description: 'Character background and physical description',
  fieldIds: ['characterInfo', 'personalityAppearance'],
  fields: [
    {
      id: 'characterInfo',
      label: 'Character Info',
      placeholder: 'Background, history, and description...',
      required: true,
      style: 'paragraph',
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
    },
    {
      id: 'personalityAppearance',
      label: 'Appearance',
      placeholder: 'Physical description...',
      required: false,
      style: 'paragraph',
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
    },
  ],
  getStatus: (data: CharacterData) => {
    const hasInfo = data.characterInfo.length > 0;
    const hasAppearance =
      data.personalityAppearance !== null && data.personalityAppearance.length > 0;
    if (hasInfo && hasAppearance) {
      return SectionStatus.COMPLETE;
    }
    if (hasInfo) {
      return SectionStatus.PARTIAL;
    }
    return SectionStatus.EMPTY;
  },
  getPreview: (data: CharacterData) => {
    const infoPrev = truncatePreview(data.characterInfo, 80);
    const appearancePrev = truncatePreview(data.personalityAppearance, 80);
    const parts: string[] = [];
    if (infoPrev.length > 0) {
      parts.push(`*Bio:* ${infoPrev}`);
    }
    if (appearancePrev.length > 0) {
      parts.push(`*Appearance:* ${appearancePrev}`);
    }
    return parts.length > 0 ? parts.join('\n') : '_Not configured_';
  },
};

/**
 * Preferences Section
 * Fields: personalityLikes, personalityDislikes
 * Both are long fields (4000 chars each)
 */
export const preferencesSection: SectionDefinition<CharacterData> = {
  id: 'preferences',
  label: '❤️ Preferences',
  description: 'Likes and dislikes',
  fieldIds: ['personalityLikes', 'personalityDislikes'],
  fields: [
    {
      id: 'personalityLikes',
      label: 'Likes',
      placeholder: 'Things this character enjoys...',
      required: false,
      style: 'paragraph',
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
    },
    {
      id: 'personalityDislikes',
      label: 'Dislikes',
      placeholder: 'Things this character avoids...',
      required: false,
      style: 'paragraph',
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
    },
  ],
  getStatus: (data: CharacterData) => {
    const hasLikes = data.personalityLikes !== null && data.personalityLikes.length > 0;
    const hasDislikes = data.personalityDislikes !== null && data.personalityDislikes.length > 0;
    if (hasLikes && hasDislikes) {
      return SectionStatus.COMPLETE;
    }
    if (hasLikes || hasDislikes) {
      return SectionStatus.PARTIAL;
    }
    return SectionStatus.DEFAULT;
  },
  getPreview: (data: CharacterData) => {
    const parts: string[] = [];
    if (data.personalityLikes !== null && data.personalityLikes.length > 0) {
      parts.push(`❤️ ${truncatePreview(data.personalityLikes, 60)}`);
    }
    if (data.personalityDislikes !== null && data.personalityDislikes.length > 0) {
      parts.push(`💔 ${truncatePreview(data.personalityDislikes, 60)}`);
    }
    return parts.length > 0 ? parts.join('\n') : '_Preferences not set_';
  },
};

/**
 * Conversation Section
 * Fields: conversationalGoals, conversationalExamples, errorMessage
 * Goals and examples are long fields (4000 chars), errorMessage is shorter (1000 chars)
 */
export const conversationSection: SectionDefinition<CharacterData> = {
  id: 'conversation',
  label: '💬 Conversation',
  description: 'Goals, examples, and error handling',
  fieldIds: ['conversationalGoals', 'conversationalExamples', 'errorMessage'],
  fields: [
    {
      id: 'conversationalGoals',
      label: 'Conversational Goals',
      placeholder: 'What should conversations achieve?',
      required: false,
      style: 'paragraph',
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
    },
    {
      id: 'conversationalExamples',
      label: 'Example Dialogues',
      placeholder: 'Sample conversations to guide the AI...',
      required: false,
      style: 'paragraph',
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
    },
    {
      id: 'errorMessage',
      label: 'Error Message',
      placeholder: "What should the character say when there's an error?",
      required: false,
      style: 'paragraph',
      maxLength: 1000,
    },
  ],
  getStatus: (data: CharacterData) => {
    const hasGoals = data.conversationalGoals !== null && data.conversationalGoals.length > 0;
    const hasExamples =
      data.conversationalExamples !== null && data.conversationalExamples.length > 0;
    const hasError = data.errorMessage !== null && data.errorMessage.length > 0;
    if (hasGoals && hasExamples) {
      return SectionStatus.COMPLETE;
    }
    if (hasGoals || hasExamples || hasError) {
      return SectionStatus.PARTIAL;
    }
    return SectionStatus.DEFAULT;
  },
  getPreview: (data: CharacterData) => {
    const parts: string[] = [];
    if (data.conversationalGoals !== null && data.conversationalGoals.length > 0) {
      parts.push(`🎯 ${truncatePreview(data.conversationalGoals, 50)}`);
    }
    if (data.conversationalExamples !== null && data.conversationalExamples.length > 0) {
      parts.push(`💬 ${truncatePreview(data.conversationalExamples, 50)}`);
    }
    if (data.errorMessage !== null && data.errorMessage.length > 0) {
      parts.push(`⚠️ Custom error set`);
    }
    return parts.length > 0 ? parts.join('\n') : '_Default conversation style_';
  },
};

/**
 * Admin Settings Section (admin-only)
 * Fields: slug
 * Only visible to bot owners for making corrections to system identifiers
 *
 * Note: The `hidden` property uses a context-aware function that evaluates
 * at render time. The section itself is conditionally included via
 * getCharacterDashboardConfig(isAdmin), and this field-level hidden property
 * provides defense-in-depth.
 */
export const adminSection: SectionDefinition<CharacterData> = {
  id: 'admin',
  label: '⚙️ Admin Settings',
  description: 'Bot owner only - system identifiers',
  fieldIds: ['slug'],
  fields: [
    {
      id: 'slug',
      label: 'Slug (URL Identifier)',
      placeholder: 'lowercase-with-hyphens',
      required: true,
      style: 'short',
      maxLength: 255,
      // Only visible to admins (defense-in-depth - section is also conditionally included)
      hidden: (ctx: DashboardContext) => !ctx.isAdmin,
    },
  ],
  // Admin section is always "configured" since slug is required
  getStatus: () => SectionStatus.DEFAULT,
  getPreview: (data: CharacterData) => `\`${data.slug}\``,
};
