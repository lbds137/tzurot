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

/** Sort options for character list */
type CharacterListSortType = 'date' | 'name';

/** Result type for CharacterCustomIds.parse */
interface CharacterParseResult {
  command: 'character';
  action: string;
  characterId?: string;
  sectionId?: string;
  page?: number;
  viewPage?: number;
  fieldName?: string;
  sort?: CharacterListSortType;
}

/** Parse list action parameters */
function parseListAction(parts: string[], result: CharacterParseResult): void {
  // Format: character::list::{page}::{sort} or character::list::info
  if (parts[2] !== 'info' && parts[2] !== undefined) {
    const pageNum = parseInt(parts[2], 10);
    if (!isNaN(pageNum)) {
      result.page = pageNum;
    }
    // Parse sort type from parts[3]
    if (parts[3] === 'date' || parts[3] === 'name') {
      result.sort = parts[3];
    }
  }
}

/** Parse view action parameters */
function parseViewAction(parts: string[], result: CharacterParseResult): void {
  if (parts[2] !== undefined) {
    result.characterId = parts[2];
    if (parts[3] !== undefined && parts[3] !== 'info') {
      const pageNum = parseInt(parts[3], 10);
      if (!isNaN(pageNum)) {
        result.viewPage = pageNum;
      }
    }
  }
}

/** Parse expand action parameters */
function parseExpandAction(parts: string[], result: CharacterParseResult): void {
  if (parts[2] !== undefined) {
    result.characterId = parts[2];
    result.fieldName = parts[3];
  }
}

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

  /**
   * Build list pagination button customId
   * Format: character::list::{page}::{sort}
   */
  listPage: (page: number, sort: CharacterListSortType) =>
    `character::list::${page}::${sort}` as const,

  /** Build list page info button customId (disabled) */
  listInfo: () => 'character::list::info' as const,

  /**
   * Build sort toggle button customId
   * Format: character::sort::{page}::{newSort}
   */
  sortToggle: (page: number, newSort: CharacterListSortType) =>
    `character::sort::${page}::${newSort}` as const,

  /** Build view pagination button customId */
  viewPage: (slug: string, page: number) => `character::view::${slug}::${page}` as const,

  /** Build view page info button customId (disabled) */
  viewInfo: (slug: string) => `character::view::${slug}::info` as const,

  /** Build expand field button customId */
  expand: (slug: string, fieldName: string) => `character::expand::${slug}::${fieldName}` as const,

  /** Build delete confirm button customId */
  deleteConfirm: (slug: string) => `character::delete_confirm::${slug}` as const,

  /** Build delete cancel button customId */
  deleteCancel: (slug: string) => `character::delete_cancel::${slug}` as const,

  /** Parse character customId */
  parse: (customId: string): CharacterParseResult | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'character' || parts.length < 2) {
      return null;
    }

    const action = parts[1];
    const result: CharacterParseResult = { command: 'character', action };

    if (action === 'list' || action === 'sort') {
      // Both list and sort use same format: character::{action}::{page}::{sort}
      parseListAction(parts, result);
    } else if (action === 'view') {
      parseViewAction(parts, result);
    } else if (action === 'expand') {
      parseExpandAction(parts, result);
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
// APIKEY SUBCOMMAND (for /settings apikey)
// ============================================================================

export const ApikeyCustomIds = {
  /** Set API key modal - routes to settings command via settings:: prefix */
  set: (provider: string) => `settings::apikey::set::${provider}` as const,

  /** Parse apikey customId */
  parse: (
    customId: string
  ): {
    command: 'settings';
    subcommandGroup: 'apikey';
    action: string;
    provider?: string;
  } | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    // Format: settings::apikey::action::provider
    if (parts[0] !== 'settings' || parts[1] !== 'apikey' || parts.length < 3) {
      return null;
    }

    return {
      command: 'settings',
      subcommandGroup: 'apikey',
      action: parts[2],
      provider: parts[3],
    };
  },

  /** Check if customId belongs to apikey subcommand */
  isApikey: (customId: string): boolean => customId.startsWith('settings::apikey::'),
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
// DESTRUCTIVE CONFIRMATION (Reusable pattern for dangerous operations)
// ============================================================================

/**
 * Parsed result for destructive confirmation custom IDs
 *
 * Format: {source}::destructive::{action}::{operation}::{entityId}
 * This format ensures the customId routes to the source command's handleButton.
 */
interface DestructiveParseResult {
  /** The source command (e.g., 'history', 'character') */
  source: string;
  /** The action type */
  action: 'confirm_button' | 'cancel_button' | 'modal_submit';
  /** Operation identifier (e.g., 'hard-delete', 'delete') */
  operation: string;
  /** Entity identifier (personality slug, etc.) */
  entityId?: string;
}

export const DestructiveCustomIds = {
  /**
   * Build confirm button customId
   * Format: {source}::destructive::confirm_button::{operation}::{entityId}
   * @param source - Source command (e.g., 'history', 'character')
   * @param operation - Operation name (e.g., 'hard-delete')
   * @param entityId - Optional entity identifier
   */
  confirmButton: (source: string, operation: string, entityId?: string) =>
    entityId !== undefined
      ? (`${source}::destructive::confirm_button::${operation}::${entityId}` as const)
      : (`${source}::destructive::confirm_button::${operation}` as const),

  /**
   * Build cancel button customId
   * Format: {source}::destructive::cancel_button::{operation}::{entityId}
   * @param source - Source command (e.g., 'history', 'character')
   * @param operation - Operation name (e.g., 'hard-delete')
   * @param entityId - Optional entity identifier
   */
  cancelButton: (source: string, operation: string, entityId?: string) =>
    entityId !== undefined
      ? (`${source}::destructive::cancel_button::${operation}::${entityId}` as const)
      : (`${source}::destructive::cancel_button::${operation}` as const),

  /**
   * Build modal submit customId
   * Format: {source}::destructive::modal_submit::{operation}::{entityId}
   * @param source - Source command (e.g., 'history', 'character')
   * @param operation - Operation name (e.g., 'hard-delete')
   * @param entityId - Optional entity identifier
   */
  modalSubmit: (source: string, operation: string, entityId?: string) =>
    entityId !== undefined
      ? (`${source}::destructive::modal_submit::${operation}::${entityId}` as const)
      : (`${source}::destructive::modal_submit::${operation}` as const),

  /**
   * Parse destructive customId
   * Expected format: {source}::destructive::{action}::{operation}::{entityId?}
   */
  parse: (customId: string): DestructiveParseResult | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    // Format: source::destructive::action::operation[::entityId]
    if (parts.length < 4 || parts[1] !== 'destructive') {
      return null;
    }

    const source = parts[0];
    const action = parts[2] as 'confirm_button' | 'cancel_button' | 'modal_submit';
    const operation = parts[3];
    const entityId = parts[4];

    return {
      source,
      action,
      operation,
      entityId,
    };
  },

  /**
   * Check if customId belongs to destructive confirmation flow
   * Checks for "::destructive::" pattern anywhere in the customId
   */
  isDestructive: (customId: string): boolean => customId.includes('::destructive::'),
} as const;

// ============================================================================
// CHANNEL COMMAND
// ============================================================================

/** Sort options for channel list */
type ChannelListSortType = 'date' | 'name';

/** Result type for ChannelCustomIds.parse */
interface ChannelParseResult {
  command: 'channel';
  action: string;
  page?: number;
  sort?: ChannelListSortType;
}

export const ChannelCustomIds = {
  /**
   * Build list pagination button customId
   * Format: channel::list::{page}::{sort}
   */
  listPage: (page: number, sort: ChannelListSortType) => `channel::list::${page}::${sort}` as const,

  /** Build list page info button customId (disabled) */
  listInfo: () => 'channel::list::info' as const,

  /**
   * Build sort toggle button customId
   * Format: channel::sort::{page}::{newSort}
   */
  sortToggle: (page: number, newSort: ChannelListSortType) =>
    `channel::sort::${page}::${newSort}` as const,

  /** Parse channel customId */
  parse: (customId: string): ChannelParseResult | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'channel' || parts.length < 2) {
      return null;
    }

    const action = parts[1];
    const result: ChannelParseResult = { command: 'channel', action };

    // For list and sort actions, parse page and sort
    if ((action === 'list' || action === 'sort') && parts[2] !== undefined && parts[2] !== 'info') {
      const pageNum = parseInt(parts[2], 10);
      if (!isNaN(pageNum)) {
        result.page = pageNum;
      }
      if (parts[3] === 'date' || parts[3] === 'name') {
        result.sort = parts[3];
      }
    }

    return result;
  },

  /** Check if customId belongs to channel command */
  isChannel: (customId: string): boolean => customId.startsWith('channel::'),
} as const;

// ============================================================================
// PERSONA COMMAND
// ============================================================================

/** Sort options for persona browse */
export type PersonaBrowseSortType = 'date' | 'name';

/** Result type for PersonaCustomIds.parse */
interface PersonaParseResult {
  command: 'persona';
  action: string;
  personaId?: string;
  sectionId?: string;
  field?: string;
  personalityId?: string;
  page?: number;
  sort?: PersonaBrowseSortType;
}

export const PersonaCustomIds = {
  // Dashboard actions (entityType = 'persona' for routing)
  /** Build menu customId for dashboard select menu */
  menu: (personaId: string) => `persona::menu::${personaId}` as const,

  /** Build modal customId for section edit */
  modal: (personaId: string, sectionId: string) =>
    `persona::modal::${personaId}::${sectionId}` as const,

  /** Build close button customId */
  close: (personaId: string) => `persona::close::${personaId}` as const,

  /** Build refresh button customId */
  refresh: (personaId: string) => `persona::refresh::${personaId}` as const,

  /** Build delete button customId */
  delete: (personaId: string) => `persona::delete::${personaId}` as const,

  /** Build confirm delete button customId */
  confirmDelete: (personaId: string) => `persona::confirm-delete::${personaId}` as const,

  /** Build cancel delete button customId */
  cancelDelete: (personaId: string) => `persona::cancel-delete::${personaId}` as const,

  // Create actions
  /** Create new persona modal */
  create: () => 'persona::create' as const,

  // View actions
  /** Expand content field button */
  expand: (personaId: string, field: string) => `persona::expand::${personaId}::${field}` as const,

  // Override actions
  /** Create persona for override flow */
  overrideCreate: (personalityId: string) => `persona::override-create::${personalityId}` as const,

  // Browse actions
  /** Build browse pagination button customId */
  browsePage: (page: number, sort: PersonaBrowseSortType) =>
    `persona::browse::${page}::${sort}` as const,

  /** Build browse select menu customId */
  browseSelect: (page: number, sort: PersonaBrowseSortType) =>
    `persona::browse-select::${page}::${sort}` as const,

  /** Build browse info button customId (disabled) */
  browseInfo: () => 'persona::browse::info' as const,

  /** Parse persona customId */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Parser for 5+ custom ID formats with early-return pattern matching per action type
  parse: (customId: string): PersonaParseResult | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'persona' || parts.length < 2) {
      return null;
    }

    const action = parts[1];
    const result: PersonaParseResult = { command: 'persona', action };

    // Handle browse actions
    if (action === 'browse' || action === 'browse-select') {
      if (parts[2] !== 'info' && parts[2] !== undefined) {
        const pageNum = parseInt(parts[2], 10);
        if (!isNaN(pageNum)) {
          result.page = pageNum;
        }
        if (parts[3] === 'date' || parts[3] === 'name') {
          result.sort = parts[3];
        }
      }
      return result;
    }

    // Handle expand action: persona::expand::personaId::field
    if (action === 'expand') {
      result.personaId = parts[2];
      result.field = parts[3];
      return result;
    }

    // Handle override-create action: persona::override-create::personalityId
    if (action === 'override-create') {
      result.personalityId = parts[2];
      return result;
    }

    // Handle modal action: persona::modal::personaId::sectionId
    if (action === 'modal') {
      result.personaId = parts[2];
      result.sectionId = parts[3];
      return result;
    }

    // Default: personaId in third position
    if (parts[2] !== undefined) {
      result.personaId = parts[2];
    }
    if (parts[3] !== undefined) {
      result.sectionId = parts[3];
    }

    return result;
  },

  /** Check if customId belongs to persona command */
  isPersona: (customId: string): boolean => customId.startsWith('persona::'),
} as const;

// ============================================================================
// SHAPES COMMAND
// ============================================================================

/** Result type for ShapesCustomIds.parse */
interface ShapesParseResult {
  command: 'shapes';
  action: string;
  page?: number;
  slug?: string;
  importType?: string;
  personalityId?: string;
}

export const ShapesCustomIds = {
  // --- Auth flow ---
  /** Auth modal - two text inputs for cookie parts */
  auth: () => 'shapes::auth' as const,
  /** Button to open auth modal */
  authContinue: () => 'shapes::auth-continue' as const,
  /** Cancel auth flow */
  authCancel: () => 'shapes::auth-cancel' as const,

  // --- List pagination ---
  /** Previous page button */
  listPrev: (page: number) => `shapes::list-prev::${String(page)}` as const,
  /** Next page button */
  listNext: (page: number) => `shapes::list-next::${String(page)}` as const,
  /** Select menu for choosing a shape */
  listSelect: (page: number) => `shapes::list-select::${String(page)}` as const,
  /** Disabled page info button */
  listInfo: () => 'shapes::list-info' as const,

  // --- Action buttons (after selecting a shape) ---
  /** Import button for a specific shape */
  actionImport: (slug: string) => `shapes::action-import::${slug}` as const,
  /** Export button for a specific shape */
  actionExport: (slug: string) => `shapes::action-export::${slug}` as const,
  /** Back to list button */
  actionBack: () => 'shapes::action-back' as const,

  // --- Import confirmation ---
  /**
   * Confirm import button — encodes slug + import type in customId
   * Format: shapes::import-confirm::slug::importType[::personalityId]
   */
  importConfirm: (slug: string, importType: string, personalityId?: string) =>
    personalityId !== undefined
      ? (`shapes::import-confirm::${slug}::${importType}::${personalityId}` as const)
      : (`shapes::import-confirm::${slug}::${importType}` as const),
  /** Cancel import */
  importCancel: () => 'shapes::import-cancel' as const,

  /** Parse shapes customId */
  parse: (customId: string): ShapesParseResult | null => {
    const parts = customId.split(CUSTOM_ID_DELIMITER);
    if (parts[0] !== 'shapes' || parts.length < 2) {
      return null;
    }

    const action = parts[1];
    const result: ShapesParseResult = { command: 'shapes', action };

    // Pagination: shapes::list-prev::page, shapes::list-next::page
    if (action === 'list-prev' || action === 'list-next' || action === 'list-select') {
      if (parts[2] !== undefined) {
        const pageNum = parseInt(parts[2], 10);
        if (!isNaN(pageNum)) {
          result.page = pageNum;
        }
      }
      return result;
    }

    // Action buttons: shapes::action-import::slug, shapes::action-export::slug
    if (action === 'action-import' || action === 'action-export') {
      result.slug = parts[2];
      return result;
    }

    // Import confirm: shapes::import-confirm::slug::importType[::personalityId]
    if (action === 'import-confirm') {
      result.slug = parts[2];
      result.importType = parts[3];
      result.personalityId = parts[4];
      return result;
    }

    return result;
  },

  /** Check if customId belongs to shapes command */
  isShapes: (customId: string): boolean => customId.startsWith('shapes::'),
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
