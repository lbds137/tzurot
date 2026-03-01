/**
 * Settings Dashboard Types
 *
 * Type definitions for the interactive settings dashboard pattern.
 * Used by /admin settings, /channel context, and /character settings commands.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

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
}

/**
 * Source of a resolved setting value.
 * Maps to cascade tiers: admin → 'global', personality → 'personality',
 * channel → 'channel', user-default → 'global', user-personality → 'user-personality',
 * hardcoded → 'default'.
 */
export type SettingSource = 'global' | 'channel' | 'user-personality' | 'personality' | 'default';

/**
 * A single setting definition
 */
export interface SettingDefinition {
  /** Unique setting ID */
  id: string;
  /** Display label */
  label: string;
  /** Emoji for the setting */
  emoji: string;
  /** Description shown in drill-down view */
  description: string;
  /** Type of setting (determines UI) */
  type: SettingType;
  /** For numeric: min value */
  min?: number;
  /** For numeric: max value */
  max?: number;
  /** For duration: placeholder hint */
  placeholder?: string;
  /** Help text for the modal */
  helpText?: string;
}

/**
 * Current value of a setting with source tracking
 */
export interface SettingValue<T = unknown> {
  /** The local value at this level (null = auto/inherit) */
  localValue: T | null;
  /** The effective/resolved value after inheritance */
  effectiveValue: T;
  /** Where the effective value came from */
  source: SettingSource;
}

/**
 * All settings values for the dashboard
 */
export interface SettingsData {
  maxMessages: SettingValue<number>;
  maxAge: SettingValue<number | null>; // null = disabled
  maxImages: SettingValue<number>;
  focusModeEnabled: SettingValue<boolean>;
  crossChannelHistoryEnabled: SettingValue<boolean>;
  shareLtmAcrossPersonalities: SettingValue<boolean>;
  memoryScoreThreshold: SettingValue<number>;
  memoryLimit: SettingValue<number>;
}

/**
 * Dashboard level determines which entity we're editing
 */
export type DashboardLevel = 'global' | 'channel' | 'personality';

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
  /** Available settings */
  settings: SettingDefinition[];
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
