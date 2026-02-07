/**
 * Tri-State Setting Helpers
 *
 * Shared utilities for tri-state (null/true/false) settings.
 * Used by both channel context and character settings commands.
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 */

import type { SettingSource } from '@tzurot/common-types';

/**
 * Format tri-state value for display
 * null = Auto, true = On, false = Off
 */
export function formatTriState(value: boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return 'Auto';
  }
  return value ? 'On' : 'Off';
}

/**
 * Format effective value with source
 * @param enabled - Whether the feature is effectively enabled
 * @param source - Where the setting came from
 */
export function formatEffective(enabled: boolean, source: SettingSource): string {
  const status = enabled ? 'enabled' : 'disabled';
  return `**${status}** (from ${source})`;
}

/**
 * Configuration for building status messages
 */
interface StatusMessageConfig {
  /** The setting name (e.g., "Extended Context") */
  settingName: string;
  /** The target name (e.g., character name or "this channel") */
  targetName: string;
  /** Current setting value (null/true/false) */
  currentValue: boolean | null | undefined;
  /** Whether the feature is effectively enabled */
  effectiveEnabled: boolean;
  /** Where the effective setting came from */
  source: SettingSource;
  /** Description of what the setting does */
  description: string;
}

/**
 * Build status message for tri-state settings
 */
export function buildTriStateStatusMessage(config: StatusMessageConfig): string {
  const { settingName, targetName, currentValue, effectiveEnabled, source, description } = config;
  return (
    `**${settingName} for ${targetName}**\n\n` +
    `Setting: **${formatTriState(currentValue)}**\n` +
    `Effective: ${formatEffective(effectiveEnabled, source)}\n\n` +
    description
  );
}

/**
 * Configuration for building update confirmation messages
 */
interface UpdateMessageConfig {
  /** The setting name (e.g., "Extended Context") */
  settingName: string;
  /** The target name (e.g., character name or "this channel") */
  targetName: string;
  /** New setting value (null/true/false) */
  newValue: boolean | null;
  /** Whether the feature is effectively enabled (for Auto mode) */
  effectiveEnabled?: boolean;
  /** Where the effective setting comes from (for Auto mode) */
  source?: string;
  /** Whether this is a channel or character setting */
  targetType: 'channel' | 'character';
}

/**
 * Build confirmation message for tri-state update
 */
export function buildTriStateUpdateMessage(config: UpdateMessageConfig): string {
  const { settingName, targetName, newValue, effectiveEnabled, source, targetType } = config;
  const valueLabel = formatTriState(newValue);

  let message = `**${settingName} set to ${valueLabel}** for **${targetName}**.\n\n`;

  if (newValue === null && effectiveEnabled !== undefined && source !== undefined) {
    message += `This will follow ${source} settings.\n`;
    message += `Currently: ${effectiveEnabled ? '**enabled**' : '**disabled**'}`;
  } else if (newValue === true) {
    message += `Extended context is now always enabled for this ${targetType}.`;
  } else {
    message += `Extended context is now always disabled for this ${targetType}.`;
  }

  return message;
}

/**
 * Extended context description for status messages
 */
export const EXTENDED_CONTEXT_DESCRIPTION =
  'Extended context allows recent channel messages (up to 100) to be included ' +
  'when the AI generates responses, providing better conversational awareness.';
