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
import { truncateByCodePoints } from '../../modal/toolkit.js';
import { Duration, DurationParseError } from '@tzurot/common-types/utils/Duration';
import { type SettingDefinition, buildSettingsCustomId, SettingType } from './types.js';

/**
 * Default input max length by setting type. Numeric/duration values are short;
 * TEXT values (model ids like `anthropic/claude-sonnet-4.5`) routinely exceed
 * the old blanket 20 — and discord.js THROWS at modal-build time if a prefill
 * value is longer than maxLength, so the cap must fit the data, not just the
 * typing.
 */
const DEFAULT_MAX_LENGTH = 20;
const TEXT_MAX_LENGTH = 100;

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
  // eslint-disable-next-line no-restricted-syntax -- settings-dashboard modal factory: single-input modal whose customId encodes the settings routing contract; not expressible via the toolkit's item union
  const modal = new ModalBuilder()
    .setCustomId(buildSettingsCustomId(entityType, 'modal', entityId, setting.id))
    .setTitle(`Edit ${setting.label}`);

  const maxLength =
    setting.maxLength ?? (setting.type === SettingType.TEXT ? TEXT_MAX_LENGTH : DEFAULT_MAX_LENGTH);

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

  // Pre-fill with current value, truncated to the cap — a longer prefill
  // throws in TextInputBuilder validation.
  const valueStr = formatValueForInput(currentValue);
  if (valueStr.length > 0) {
    input.setValue(truncateByCodePoints(valueStr, maxLength));
  }

  input.setMaxLength(maxLength);

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

  // Number() supports decimals (e.g. memoryScoreThreshold 0-1) and rejects mixed input like '50abc'
  const num = Number(trimmed);
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
