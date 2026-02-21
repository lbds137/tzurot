/**
 * Character Dashboard Configuration
 *
 * Defines the dashboard layout for character (personality) editing.
 * Organizes fields into logical sections that fit Discord's 5-field modal limit.
 */

import { escapeMarkdown } from 'discord.js';
import { DISCORD_COLORS, DISCORD_LIMITS, formatDateShort } from '@tzurot/common-types';
import {
  type DashboardConfig,
  type SectionDefinition,
  type DashboardContext,
  type BrowseContext,
  type ActionButtonOptions,
  SectionStatus,
} from '../../utils/dashboard/index.js';

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
 * Character data structure (from API)
 * Index signature uses `unknown` for Record<string, unknown> compatibility
 * while preserving strict types for known properties.
 */
export interface CharacterData {
  [key: string]: unknown;
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  errorMessage: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  isPublic: boolean;
  voiceEnabled: boolean;
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
const identitySection: SectionDefinition<CharacterData> = {
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
const biographySection: SectionDefinition<CharacterData> = {
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
const preferencesSection: SectionDefinition<CharacterData> = {
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
const conversationSection: SectionDefinition<CharacterData> = {
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
const adminSection: SectionDefinition<CharacterData> = {
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

/**
 * Build dashboard action button options based on character data.
 *
 * @param data - Character data with optional browseContext
 * @returns ActionButtonOptions for buildDashboardComponents
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
 * Character Dashboard Configuration
 */
export const characterDashboardConfig: DashboardConfig<CharacterData> = {
  entityType: 'character',
  getTitle: (data: CharacterData) => {
    const displayName = data.displayName ?? data.name;
    return `📝 Editing: ${displayName}`;
  },
  getDescription: (data: CharacterData) => {
    const visibility = data.isPublic ? '🌐 Public' : '🔒 Private';
    const voice = data.voiceEnabled ? '🎤 Voice On' : '';
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
  ],
  getFooter: (data: CharacterData) => {
    const created = formatDateShort(data.createdAt);
    const updated = formatDateShort(data.updatedAt);
    return `Created: ${created} • Updated: ${updated}`;
  },
  color: DISCORD_COLORS.BLURPLE,
};

/**
 * Get character dashboard config with optional admin sections
 *
 * Use this function instead of characterDashboardConfig directly when
 * you need to conditionally include admin-only sections.
 *
 * @param isAdmin - Whether the current user is a bot admin
 * @returns Dashboard config with appropriate sections
 */
export function getCharacterDashboardConfig(isAdmin: boolean): DashboardConfig<CharacterData> {
  const sections = [identitySection, biographySection, preferencesSection, conversationSection];

  if (isAdmin) {
    sections.push(adminSection);
  }

  return {
    ...characterDashboardConfig,
    sections,
  };
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
