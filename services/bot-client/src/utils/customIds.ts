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
 *
 * New command customId families are declared with `defineCustomIdFamily`
 * (`./customIdFamily.ts`), which derives typed build/parse/is helpers from a
 * segment-list-per-action declaration. The per-command objects still
 * hand-written directly in this file are pending migration to that factory.
 */

import {
  CUSTOM_ID_DELIMITER,
  defineCustomIdFamily,
  destructivePreset,
  seg,
  type CustomIdFamily,
  type DestructiveStep,
} from './customIdFamily.js';

// Re-exported for the many existing importers of `CUSTOM_ID_DELIMITER` from
// this file; `customIdFamily.ts` owns the constant (see its JSDoc for why).
export { CUSTOM_ID_DELIMITER };

// ============================================================================
// CHARACTER COMMAND
// ============================================================================

/** Sort options for `/character browse` */
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

  /** Build view Edit button customId (opens the edit dashboard from view) */
  viewEdit: (slug: string) => `character::view-edit::${slug}` as const,

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
 * Format: {source}::destructive::{action}::{operation}::{entityId?}
 * The source segment routes the customId to the source command's handlers.
 * Invoker ownership is NOT carried here — a Discord snowflake (~19 chars)
 * would eat the 100-char customId budget that entityId needs; the Tier-B
 * flow asserts ownership from the parent message's `interactionMetadata`
 * instead.
 *
 * entityId is a single `::`-free segment. Keep it SHORT (a snowflake, a
 * fixed token): unbounded values (e.g. a personality slug, up to 50 chars)
 * blow the 100-char cap, and the build itself throws a named Error (the
 * family core's length assertion) — such state rides the
 * warning embed's `footerText` and is read back from the parent message
 * (see history-purge's `parsePurgeSlugFromFooter`).
 */
export interface DestructiveParseResult {
  /** The source command (e.g., 'history', 'character') */
  source: string;
  /** The action type */
  action: DestructiveStep;
  /** Operation identifier (e.g., 'hard-delete', 'delete') */
  operation: string;
  /** Entity identifier (personality slug, etc.) */
  entityId?: string;
}

type DestructiveFamily = ReturnType<typeof defineDestructiveFamily>;

function defineDestructiveFamily(
  source: string
): CustomIdFamily<string, ReturnType<typeof destructivePreset>> {
  return defineCustomIdFamily(source, destructivePreset());
}

/**
 * Per-source families, populated ONLY by the builders (sources come from
 * code, so the set is finite). `parse` reads the cache but never writes it:
 * its source is Discord-supplied, and caching it would grow without bound.
 */
const destructiveFamilies = new Map<string, DestructiveFamily>();

function destructiveFamilyForBuild(source: string): DestructiveFamily {
  let family = destructiveFamilies.get(source);
  if (family === undefined) {
    family = defineDestructiveFamily(source);
    destructiveFamilies.set(source, family);
  }
  return family;
}

function buildDestructiveId(
  step: DestructiveStep,
  source: string,
  operation: string,
  entityId?: string
): string {
  return destructiveFamilyForBuild(source).build.destructive(step, operation, entityId);
}

export const DestructiveCustomIds = {
  /**
   * Build confirm button customId
   * Format: {source}::destructive::confirm_button::{operation}::{entityId?}
   */
  confirmButton: (source: string, operation: string, entityId?: string) =>
    buildDestructiveId('confirm_button', source, operation, entityId),

  /**
   * Build cancel button customId
   * Format: {source}::destructive::cancel_button::{operation}::{entityId?}
   */
  cancelButton: (source: string, operation: string, entityId?: string) =>
    buildDestructiveId('cancel_button', source, operation, entityId),

  /**
   * Build modal submit customId
   * Format: {source}::destructive::modal_submit::{operation}::{entityId?}
   */
  modalSubmit: (source: string, operation: string, entityId?: string) =>
    buildDestructiveId('modal_submit', source, operation, entityId),

  /**
   * Build the modal-submit customId from a PARSED button customId. This is the
   * only sanctioned path from confirm-button to modal: deriving from the
   * button's own segments makes it impossible for a re-built config to route
   * the modal to a different command than the button it came from.
   */
  modalSubmitFromParsed: (parsed: DestructiveParseResult) =>
    buildDestructiveId('modal_submit', parsed.source, parsed.operation, parsed.entityId),

  /**
   * Parse destructive customId
   * Expected format: {source}::destructive::{action}::{operation}::{entityId?}
   * Returns null on fewer than four segments, a second segment other than
   * `destructive`, a step outside the three-value enum, an empty operation,
   * or extra segments past entityId.
   */
  parse: (customId: string): DestructiveParseResult | null => {
    const source = getCommandFromCustomId(customId);
    if (source === null || source === '') {
      return null;
    }

    const family = destructiveFamilies.get(source) ?? defineDestructiveFamily(source);
    const parsed = family.parse(customId);
    if (parsed === null) {
      return null;
    }
    const result: DestructiveParseResult = {
      source,
      action: parsed.step,
      operation: parsed.operation,
    };
    if (parsed.entityId !== undefined) {
      result.entityId = parsed.entityId;
    }
    return result;
  },

  /**
   * Check if customId belongs to destructive confirmation flow.
   * Checks that the second segment is exactly `destructive`.
   */
  isDestructive: (customId: string): boolean => {
    const source = getCommandFromCustomId(customId);
    return (
      source !== null &&
      source !== '' &&
      customId.startsWith(`${source}${CUSTOM_ID_DELIMITER}destructive${CUSTOM_ID_DELIMITER}`)
    );
  },
} as const;

// ============================================================================
// PERSONA COMMAND
// ============================================================================

const entityId = seg.str('entityId');
const sectionId = seg.str('sectionId');

const personaFamily = defineCustomIdFamily('persona', {
  // Dashboard actions — these strings are ALSO produced by
  // `buildDashboardCustomId`/`ModalFactory`/`truncationGate/buttons.ts`; the
  // two conventions must agree on segment order (pinned by the agreement
  // tests in customIds.test.ts).
  menu: [entityId],
  modal: [entityId, sectionId],
  close: [entityId],
  refresh: [entityId],
  back: [entityId],
  delete: [entityId],
  'confirm-delete': [entityId],
  'cancel-delete': [entityId],
  edit_truncated: [entityId, sectionId],
  open_editor: [entityId, sectionId],
  view_full: [entityId, sectionId],
  cancel_edit: [entityId, seg.optional(sectionId)],
  // Per-command actions
  create: [],
  expand: [entityId, seg.str('field')],
  'override-create': [seg.str('personalityId')],
});

export const PersonaCustomIds = {
  menu: personaFamily.build.menu,
  modal: personaFamily.build.modal,
  close: personaFamily.build.close,
  refresh: personaFamily.build.refresh,
  delete: personaFamily.build.delete,
  confirmDelete: personaFamily.build['confirm-delete'],
  cancelDelete: personaFamily.build['cancel-delete'],
  create: personaFamily.build.create,
  expand: personaFamily.build.expand,
  overrideCreate: personaFamily.build['override-create'],
  parse: personaFamily.parse,
  isPersona: personaFamily.is,
} as const;

// ============================================================================
// SHAPES COMMAND
// ============================================================================

/** Result type for ShapesCustomIds.parse */
interface ShapesParseResult {
  command: 'shapes';
  action: string;
  /** Import type for detail-import or import-confirm actions */
  importType?: string;
}

export const ShapesCustomIds = {
  // --- Auth flow ---
  /** Auth modal - two text inputs for cookie parts */
  auth: () => 'shapes::auth' as const,
  /** Button to open auth modal */
  authContinue: () => 'shapes::auth-continue' as const,
  /** Cancel auth flow */
  authCancel: () => 'shapes::auth-cancel' as const,

  // --- Detail view actions (slug is in embed footer, not custom ID) ---
  /** Import button from detail view — encodes import type */
  detailImport: (importType: string) => `shapes::detail-import::${importType}` as const,
  /** Export button from detail view */
  detailExport: () => 'shapes::detail-export' as const,
  /** Refresh job status in detail view */
  detailRefresh: () => 'shapes::detail-refresh' as const,
  /** Back to browse list from detail view */
  detailBack: () => 'shapes::detail-back' as const,

  // --- Import confirmation ---
  /**
   * Confirm import button — encodes import type.
   * The slug is NOT in the custom ID — it's extracted from the embed footer
   * at click time, avoiding Discord's 100-char custom ID limit.
   * Format: shapes::import-confirm::importType
   */
  importConfirm: (importType: string) => `shapes::import-confirm::${importType}` as const,
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

    // Detail import: shapes::detail-import::importType
    if (action === 'detail-import') {
      result.importType = parts[2];
      return result;
    }

    // Import confirm: shapes::import-confirm::importType
    // Slug is extracted from embed footer at click time, not encoded here
    if (action === 'import-confirm') {
      result.importType = parts[2];
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
