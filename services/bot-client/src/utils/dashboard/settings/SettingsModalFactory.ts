/**
 * Settings Modal Factory
 *
 * Creates modals for editing numeric and duration settings.
 * Used when a user clicks "Edit Value" on a setting.
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalActionRowComponentBuilder,
} from 'discord.js';
import { type SettingDefinition, buildSettingsCustomId } from './types.js';

/**
 * Build a modal for editing a setting value
 *
 * @param entityType - Entity type (e.g., 'global', 'channel', 'personality')
 * @param entityId - Entity ID
 * @param setting - Setting definition
 * @param currentValue - Current effective value for display hint
 */
export function buildSettingEditModal(
  entityType: string,
  entityId: string,
  setting: SettingDefinition,
  currentValue: unknown
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildSettingsCustomId(entityType, 'modal', entityId, setting.id))
    .setTitle(`Edit ${setting.label}`);

  // Build the text input
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(setting.label)
    .setStyle(TextInputStyle.Short)
    .setRequired(false); // Allow empty to reset to auto

  // Set placeholder with examples
  if (setting.placeholder !== undefined) {
    input.setPlaceholder(setting.placeholder);
  }

  // Pre-fill with current value
  const valueStr = formatValueForInput(currentValue);
  if (valueStr.length > 0) {
    input.setValue(valueStr);
  }

  // Set max length (generous for duration strings)
  input.setMaxLength(20);

  const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  modal.addComponents(row);

  return modal;
}

/**
 * Format a value for display in the input field
 */
function formatValueForInput(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  // Only numbers and strings are expected for setting values
  return '';
}

/**
 * Parse a numeric value from modal input
 *
 * Returns:
 * - { type: 'auto' } if empty or "auto"
 * - { type: 'value', value: number } if valid number
 * - { type: 'error', message: string } if invalid
 */
export function parseNumericInput(
  input: string,
  min: number,
  max: number
): { type: 'auto' } | { type: 'value'; value: number } | { type: 'error'; message: string } {
  const trimmed = input.trim().toLowerCase();

  // Empty or "auto" means inherit
  if (trimmed === '' || trimmed === 'auto') {
    return { type: 'auto' };
  }

  // Parse as number
  const num = parseInt(trimmed, 10);
  if (Number.isNaN(num)) {
    return { type: 'error', message: `Invalid number: "${input}"` };
  }

  // Validate range
  if (num < min || num > max) {
    return { type: 'error', message: `Value must be between ${min} and ${max}` };
  }

  return { type: 'value', value: num };
}

/**
 * Parse a duration value from modal input
 *
 * Returns:
 * - { type: 'auto' } if "auto"
 * - { type: 'off' } if "off" (disabled)
 * - { type: 'value', seconds: number } if valid duration
 * - { type: 'error', message: string } if invalid
 */
export function parseDurationInput(
  input: string
):
  | { type: 'auto' }
  | { type: 'off' }
  | { type: 'value'; seconds: number }
  | { type: 'error'; message: string } {
  const trimmed = input.trim().toLowerCase();

  // Empty or "auto" means inherit
  if (trimmed === '' || trimmed === 'auto') {
    return { type: 'auto' };
  }

  // "off" means disabled (no limit)
  if (trimmed === 'off' || trimmed === 'disabled' || trimmed === 'none') {
    return { type: 'off' };
  }

  // Try to parse as duration (e.g., "2h", "30m", "1d")
  const durationMatch = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(
    trimmed
  );

  if (durationMatch === null) {
    return {
      type: 'error',
      message: `Invalid duration: "${input}". Use formats like 2h, 30m, 1d, or "off".`,
    };
  }

  const value = parseInt(durationMatch[1], 10);
  const unit = durationMatch[2].toLowerCase();

  let seconds: number;
  switch (unit) {
    case 's':
    case 'sec':
    case 'secs':
    case 'second':
    case 'seconds':
      seconds = value;
      break;
    case 'm':
    case 'min':
    case 'mins':
    case 'minute':
    case 'minutes':
      seconds = value * 60;
      break;
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hour':
    case 'hours':
      seconds = value * 60 * 60;
      break;
    case 'd':
    case 'day':
    case 'days':
      seconds = value * 60 * 60 * 24;
      break;
    default:
      return { type: 'error', message: `Unknown time unit: ${unit}` };
  }

  // Validate minimum (1 minute)
  if (seconds < 60) {
    return { type: 'error', message: 'Duration must be at least 1 minute' };
  }

  return { type: 'value', seconds };
}
