/**
 * Centralized Custom ID Management
 *
 * Discord custom IDs have a 100 character limit and are used to identify
 * interactive components (buttons, select menus, modals).
 *
 * This module provides type-safe builders and parsers for all custom IDs
 * in the bot, using `::` as the delimiter to avoid conflicts with UUIDs
 * and slugs that contain hyphens.
 *
 * Pattern: {command}::{action}::{...params}
 *
 * IMPORTANT: Never use `-` as delimiter because:
 * - UUIDs contain hyphens: abc12345-def6-7890-abcd-ef1234567890
 * - Slugs may contain hyphens: my-personality-name
 * Using `-` would cause parsing to fail when splitting.
 */

/** Delimiter used between custom ID segments */
export const CUSTOM_ID_DELIMITER = '::';

// ============================================================================
// CHARACTER COMMAND
// ============================================================================

export const CharacterCustomIds = {
  /** Build seed modal customId (create new character) */
  seed: () => 'character::seed' as const,

  /** Build menu customId for dashboard select menu */
  menu: (characterId: string) => `character::menu::${characterId}` as const,

  /** Build modal customId for section edit */
  modal: (characterId: string, sectionId: string) =>
    `character::modal::${characterId}::${sectionId}` as const,

  /** Build close button customId */
  close: (characterId: string) => `character::close::${characterId}` as const,

  /** Build refresh button customId */
  refresh: (characterId: string) => `character::refresh::${characterId}` as const,

  /** Build list pagination button customId */
  listPage: (page: number) => `character::list::${page}` as const,

  /** Build list page info button customId (disabled) */
  listInfo: () => 'character::list::info' as const,

  /** Build view pagination button customId */
  viewPage: (slug: string, page: number) => `character::view::${slug}::${page}` as const,

  /** Build view page info button customId (disabled) */
  viewInfo: (slug: string) => `character::view::${slug}::info` as const,

  /** Build expand field button customId */
  expand: (slug: string, fieldName: string) => `character::expand::${slug}::${fieldName}` as const,

  /** Parse character customId */
  parse: (
    customId: string
  ): {
    command: 'character';
    action: string;
    characterId?: string;
    sectionId?: string;
    page?: number;
    viewPage?: number;
    fieldName?: string;
  } | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'character' || parts.length < 2) {
      return null;
    }

    const action = parts[1];
    const result: ReturnType<typeof CharacterCustomIds.parse> = {
      command: 'character',
      action,
    };

    if (action === 'list') {
      if (parts[2] === 'info') {
        // Info button - no page number
      } else if (parts[2] !== undefined) {
        const pageNum = parseInt(parts[2], 10);
        if (!isNaN(pageNum)) {
          result.page = pageNum;
        }
      }
    } else if (action === 'view') {
      // Format: character::view::{slug}::{page|info}
      if (parts[2] !== undefined) {
        result.characterId = parts[2];
        if (parts[3] !== undefined && parts[3] !== 'info') {
          const pageNum = parseInt(parts[3], 10);
          if (!isNaN(pageNum)) {
            result.viewPage = pageNum;
          }
        }
      }
    } else if (action === 'expand') {
      // Format: character::expand::{slug}::{fieldName}
      if (parts[2] !== undefined) {
        result.characterId = parts[2];
        result.fieldName = parts[3];
      }
    } else if (parts[2] !== undefined) {
      result.characterId = parts[2];
      if (parts[3] !== undefined) {
        result.sectionId = parts[3];
      }
    }

    return result;
  },

  /** Check if customId belongs to character command */
  isCharacter: (customId: string): boolean => customId.startsWith('character::'),
} as const;

// ============================================================================
// ME COMMAND (Profile, Override, Settings)
// ============================================================================

export const MeCustomIds = {
  // Profile actions
  profile: {
    /** Create new profile modal */
    create: () => 'me::profile::create' as const,

    /** Edit profile modal */
    edit: (personaId: string) => `me::profile::edit::${personaId}` as const,

    /** Edit modal for creating new profile (from edit flow) */
    editNew: () => 'me::profile::edit::new' as const,
  },

  // Override actions
  override: {
    /** Create profile for override flow */
    createForOverride: (personalityId: string) => `me::override::create::${personalityId}` as const,
  },

  /** Parse me customId */
  parse: (
    customId: string
  ): {
    command: 'me';
    group: 'profile' | 'override';
    action: string;
    entityId?: string;
  } | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'me' || parts.length < 3) {
      return null;
    }

    const group = parts[1] as 'profile' | 'override';
    const action = parts[2];

    return {
      command: 'me',
      group,
      action,
      entityId: parts[3],
    };
  },

  /** Check if customId belongs to me command */
  isMe: (customId: string): boolean => customId.startsWith('me::'),
} as const;

// ============================================================================
// WALLET COMMAND
// ============================================================================

export const WalletCustomIds = {
  /** Set API key modal */
  set: (provider: string) => `wallet::set::${provider}` as const,

  /** Parse wallet customId */
  parse: (
    customId: string
  ): {
    command: 'wallet';
    action: string;
    provider?: string;
  } | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'wallet' || parts.length < 2) {
      return null;
    }

    return {
      command: 'wallet',
      action: parts[1],
      provider: parts[2],
    };
  },

  /** Check if customId belongs to wallet command */
  isWallet: (customId: string): boolean => customId.startsWith('wallet::'),
} as const;

// ============================================================================
// PRESET COMMAND
// ============================================================================

export const PresetCustomIds = {
  /** Build menu customId for dashboard select menu */
  menu: (presetId: string) => `preset::menu::${presetId}` as const,

  /** Build modal customId for section edit */
  modal: (presetId: string, sectionId: string) =>
    `preset::modal::${presetId}::${sectionId}` as const,

  /** Parse preset customId */
  parse: (
    customId: string
  ): {
    command: 'preset';
    action: string;
    presetId?: string;
    sectionId?: string;
  } | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'preset' || parts.length < 2) {
      return null;
    }

    return {
      command: 'preset',
      action: parts[1],
      presetId: parts[2],
      sectionId: parts[3],
    };
  },

  /** Check if customId belongs to preset command */
  isPreset: (customId: string): boolean => customId.startsWith('preset::'),
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the command name from a customId
 *
 * All customIds use the `::` delimiter format: `command::action::param1::param2`
 * Returns null if the customId doesn't contain the delimiter.
 */
export function getCommandFromCustomId(customId: string): string | null {
  const delimiterIndex = customId.indexOf(CUSTOM_ID_DELIMITER);
  if (delimiterIndex === -1) {
    return null;
  }
  return customId.substring(0, delimiterIndex);
}
