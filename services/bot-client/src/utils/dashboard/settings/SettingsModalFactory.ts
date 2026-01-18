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
import { Duration, DurationParseError } from '@tzurot/common-types';
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

/** Minimum duration: 1 minute (60 seconds) */
const MIN_DURATION_SECONDS = 60;

/**
 * Parse a duration value from modal input
 *
 * Uses the shared Duration class from common-types for parsing, which supports
 * flexible formats like "2h", "30m", "1d", "1 hour", "30 minutes", etc.
 *
 * Returns:
 * - { type: 'auto' } if empty or "auto" (inherit from parent)
 * - { type: 'off' } if "off"/"disabled"/"none" (explicitly disabled)
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

  // Empty or "auto" means inherit from parent - check this BEFORE Duration.parse
  // because Duration treats empty as disabled, but we need it to mean "inherit"
  if (trimmed === '' || trimmed === 'auto') {
    return { type: 'auto' };
  }

  try {
    const duration = Duration.parse(trimmed);

    // If Duration parsed it as disabled (off/disabled/none/0), return 'off'
    if (!duration.isEnabled) {
      return { type: 'off' };
    }

    // Validate minimum duration
    const validation = duration.validate({ min: MIN_DURATION_SECONDS });
    if (!validation.valid) {
      return { type: 'error', message: validation.error ?? 'Duration too short' };
    }

    const seconds = duration.toSeconds();
    if (seconds === null) {
      return { type: 'error', message: 'Failed to parse duration' };
    }

    return { type: 'value', seconds };
  } catch (error) {
    if (error instanceof DurationParseError) {
      return {
        type: 'error',
        message: `Invalid duration: "${input}". Use formats like 2h, 30m, 1d, or "off".`,
      };
    }
    throw error;
  }
}
