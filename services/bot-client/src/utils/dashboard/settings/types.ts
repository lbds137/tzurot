/**
 * Settings Dashboard Types
 *
 * Type definitions for the interactive settings dashboard pattern.
 * Used by /admin settings, /channel context, /character settings, and /settings defaults commands.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import type { ConfigOverrideSource } from '@tzurot/common-types/schemas/api/configOverrides';

/**
 * Setting type determines the UI pattern used
 */
export enum SettingType {
  /** Boolean with auto/on/off - uses 3 buttons */
  TRI_STATE = 'tri_state',
  /** Numeric value with optional auto - uses modal */
  NUMERIC = 'numeric',
  /** Duration string with optional auto/off - uses modal */
  DURATION = 'duration',
  /** Enum with predefined choices - uses buttons like tri-state */
  ENUM = 'enum',
  /** Two-state boolean (On/Off, no auto/inherit) - system settings, uses 2 buttons */
  BOOLEAN = 'boolean',
  /** Free-text string (model ids etc.) - uses modal, validated server-side */
  TEXT = 'text',
}

/**
 * Source of a resolved setting value.
 * 1:1 alias for ConfigOverrideSource — preserves full cascade tier information.
 */
export type SettingSource = ConfigOverrideSource;

/** Common fields shared by all setting types */
interface BaseSettingFields {
  /** Unique setting ID */
  id: string;
  /** Display label */
  label: string;
  /** Emoji for the setting */
  emoji: string;
  /** Description shown in drill-down view */
  description: string;
  /** For numeric: min value */
  min?: number;
  /** For numeric: max value */
  max?: number;
  /** For numeric/duration/text: placeholder hint */
  placeholder?: string;
  /** Help text for the modal */
  helpText?: string;
  /** For text: modal input max length (defaults per type in SettingsModalFactory) */
  maxLength?: number;
  /**
   * Render this setting without cascade semantics (no override/inherit status,
   * no parent value, no Auto affordances). Intrinsic to settings from a
   * NON-CASCADING bag (system settings) — the property rides the definition so
   * a mixed dashboard can host both universes.
   */
  plainDisplay?: boolean;
}

/** Enum setting — choices is required */
interface EnumSettingDefinition extends BaseSettingFields {
  type: SettingType.ENUM;
  choices: { value: string; label: string; emoji: string }[];
}

/** Non-enum setting — choices must not be provided */
interface StandardSettingDefinition extends BaseSettingFields {
  type:
    | SettingType.TRI_STATE
    | SettingType.NUMERIC
    | SettingType.DURATION
    | SettingType.BOOLEAN
    | SettingType.TEXT;
  choices?: never;
}

/**
 * A single setting definition.
 * Discriminated union: ENUM settings require choices; other types forbid them.
 */
export type SettingDefinition = EnumSettingDefinition | StandardSettingDefinition;

/**
 * Current value of a setting with source tracking
 */
export interface SettingValue<T = unknown> {
  /** The local value at this level (null = auto/inherit) */
  localValue: T | null;
  /** True when this tier stores an override for the field — distinguishes a
   * stored null (explicit OFF on null-terminal fields) from "not set here". */
  hasLocalOverride: boolean;
  /** The effective/resolved value after inheritance */
  effectiveValue: T;
  /** Where the effective value came from */
  source: SettingSource;
}

/**
 * All settings values for the dashboard — a keyed map so one dashboard can
 * carry settings from any universe (cascade config overrides, system settings).
 * The cascade data builders keep key-completeness internally by constructing
 * over `CONFIG_FIELDS` as `Record<keyof ConfigOverrides, …>`; the dashboard
 * machinery reads dynamically and never relied on closed keys.
 */
export type SettingsData = Record<string, SettingValue<unknown>>;

/**
 * Dashboard level determines which entity we're editing.
 * - 'global': Admin settings (bot owner)
 * - 'channel': Channel-level overrides (moderators)
 * - 'personality': Per-personality user settings
 * - 'user-default': User's global defaults (any user)
 */
export type DashboardLevel = 'global' | 'channel' | 'personality' | 'user-default';

/**
 * Dashboard view state
 */
export enum DashboardView {
  /** Overview showing all settings */
  OVERVIEW = 'overview',
  /** Drill-down view for a specific setting */
  SETTING = 'setting',
}

/**
 * Dashboard session state
 */
export interface SettingsDashboardSession {
  /** Dashboard level */
  level: DashboardLevel;
  /** Entity ID (channel ID, personality slug, or 'global') */
  entityId: string;
  /** Display name for the entity */
  entityName: string;
  /** Current settings data */
  data: SettingsData;
  /** Current view */
  view: DashboardView;
  /** If in setting view, which setting */
  activeSetting?: string;
  /**
   * Current concern page (paged configs only). Readers clamp via
   * `clampPage(config, session.page)` — pre-page sessions rehydrate without the
   * field (degrade to page 0), and a shrunk page list after a deploy must not
   * render `Page 6/4`.
   */
  page?: number;
  /**
   * The last modal input rejected by validation, kept so the Try-again button
   * can re-open the modal prefilled (design-system D15: never lose typed
   * input to a validation error). Cleared on the next successful update.
   */
  lastRejectedInput?: { settingId: string; value: string };
  /** User ID who owns this session */
  userId: string;
  /** Message ID of the dashboard */
  messageId: string;
  /** Channel ID where dashboard is displayed */
  channelId: string;
  /** Timestamp of last activity */
  lastActivityAt: Date;
}

/**
 * One concern page of a paged dashboard. Pages reference SUBSETS of the
 * config's authoritative flat `settings` list by id — a single source of
 * setting definitions, so page composition can never drift from the
 * definitions themselves.
 */
export interface SettingsPage {
  /** Stable page id (not rendered) */
  id: string;
  /** Page label rendered in the `Page N/M · <Label>` indicator */
  label: string;
  /** Ids of the settings shown on this page (must exist in config.settings) */
  settingIds: string[];
}

/**
 * Configuration for a settings dashboard
 */
export interface SettingsDashboardConfig {
  /** Dashboard level */
  level: DashboardLevel;
  /** Entity type for custom IDs */
  entityType: string;
  /** Title prefix (e.g., "Global", "Channel", "Personality") */
  titlePrefix: string;
  /** Color for the embed */
  color: number;
  /** Available settings — the authoritative flat list (pages reference subsets) */
  settings: SettingDefinition[];
  /**
   * Concern pages (§3.3 pagination-by-concern). When present, the overview
   * renders one page at a time with prev/next navigation and no Close button
   * (D18 — native dismiss suffices on ephemeral dashboards). When absent, the
   * dashboard renders flat exactly as before (channel/character dashboards).
   */
  pages?: SettingsPage[];
  /**
   * How value status renders: 'cascade' (default) shows override/inherit
   * status + parent values; 'plain' shows just the value — for non-cascading
   * bags (system settings) where override semantics would be false.
   */
  statusDisplay?: 'cascade' | 'plain';
  /**
   * Overview embed description. Defaults to the legacy extended-context copy
   * when absent (flat cascade dashboards).
   */
  overviewDescription?: string;
  /** Optional note appended to the overview embed description */
  descriptionNote?: string;
}

/**
 * Result of updating a setting
 */
export interface SettingUpdateResult {
  success: boolean;
  error?: string;
  newData?: SettingsData;
}

/**
 * Handler for setting updates
 */
export type SettingUpdateHandler = (
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: SettingsDashboardSession,
  settingId: string,
  newValue: unknown
) => Promise<SettingUpdateResult>;

/**
 * Does this setting render plain (no cascade semantics)? True when the
 * DEFINITION declares it (a non-cascading setting stays plain on a mixed
 * dashboard) or the whole config does.
 */
export function isPlainSetting(
  config: SettingsDashboardConfig,
  setting: SettingDefinition
): boolean {
  return setting.plainDisplay === true || config.statusDisplay === 'plain';
}

/**
 * Clamp a session page index against the config's page list. Handles the two
 * stale-session shapes: a pre-page session (undefined → 0) and a page index
 * beyond a SHRUNK page list after a deploy (would render `Page 6/4`).
 */
export function clampPage(config: SettingsDashboardConfig, page: number | undefined): number {
  const pageCount = config.pages?.length ?? 0;
  if (pageCount === 0) {
    return 0;
  }
  return Math.min(Math.max(page ?? 0, 0), pageCount - 1);
}

/**
 * The settings visible on the given page — or the full flat list for an
 * unpaged config. Page entries reference the authoritative `config.settings`
 * by id; ids that no longer resolve are skipped (stale page composition after
 * a definition rename degrades to a shorter page, not a crash).
 */
export function getPageSettings(
  config: SettingsDashboardConfig,
  page: number
): SettingDefinition[] {
  if (config.pages === undefined || config.pages.length === 0) {
    return config.settings;
  }
  const currentPage = config.pages[clampPage(config, page)];
  return currentPage.settingIds
    .map(id => config.settings.find(setting => setting.id === id))
    .filter((setting): setting is SettingDefinition => setting !== undefined);
}

/**
 * Custom ID delimiter for settings dashboard
 */
const SETTINGS_CUSTOM_ID_DELIMITER = '::';

/**
 * Build a custom ID for settings dashboard interactions
 */
export function buildSettingsCustomId(
  entityType: string,
  action: string,
  entityId: string,
  extra?: string
): string {
  const parts = [entityType, action, entityId];
  if (extra !== undefined) {
    parts.push(extra);
  }
  return parts.join(SETTINGS_CUSTOM_ID_DELIMITER);
}

/**
 * Parse a settings dashboard custom ID
 *
 * Format: {entityType}::{action}::{entityId}[::{extra}]
 * Example: 'admin-settings::select::global' or 'admin-settings::set::global::enabled:true'
 *
 * Note: entityType should NOT contain '::' delimiter to ensure correct parsing.
 * Use hyphens for compound types (e.g., 'admin-settings' not 'admin::settings').
 */
export function parseSettingsCustomId(customId: string): {
  entityType: string;
  action: string;
  entityId: string;
  extra?: string;
} | null {
  const parts = customId.split(SETTINGS_CUSTOM_ID_DELIMITER);
  if (parts.length < 3) {
    return null;
  }

  // Use destructuring with rest to preserve extra segments
  const [entityType, action, entityId, ...rest] = parts;

  return {
    entityType,
    action,
    entityId,
    // Re-join extra segments in case they contain the delimiter
    extra: rest.length > 0 ? rest.join(SETTINGS_CUSTOM_ID_DELIMITER) : undefined,
  };
}

/**
 * Check if a custom ID belongs to a settings dashboard
 */
export function isSettingsInteraction(customId: string, entityType: string): boolean {
  return customId.startsWith(`${entityType}${SETTINGS_CUSTOM_ID_DELIMITER}`);
}
