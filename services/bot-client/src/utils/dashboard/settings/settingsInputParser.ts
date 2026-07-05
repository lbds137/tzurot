/**
 * Settings modal input parsers
 *
 * Pure coercion helpers shared by the settings dashboard modal handler. They
 * translate raw text-input strings into the handler's value format
 * (null = inherit/auto, CONFIG_WIRE_OFF = off sentinel, number = concrete value) or an error
 * message. Extracted from SettingsDashboardHandler to keep that file under the
 * max-lines limit and to make the parsing rules independently testable.
 */

import { CONFIG_WIRE_OFF } from '@tzurot/common-types/schemas/api/configOverrides';
import { parseDurationInput } from './SettingsModalFactory.js';

/** Result of parsing a modal text input: a value (number | null) or an error. */
export interface ParsedSettingValue {
  value?: number | null;
  error?: string;
}

/**
 * Parse numeric input value
 */
export function parseNumericInputValue(
  input: string,
  min: number,
  max: number
): ParsedSettingValue {
  const trimmed = input.trim().toLowerCase();

  // Empty or "auto" means inherit
  if (trimmed === '' || trimmed === 'auto') {
    return { value: null };
  }

  // Number() supports decimals (e.g. memoryScoreThreshold 0-1) and rejects mixed input like '50abc'
  const num = Number(trimmed);
  if (Number.isNaN(num)) {
    return { error: `Invalid number: "${input}"` };
  }

  // Validate range
  if (num < min || num > max) {
    return { error: `Value must be between ${min} and ${max}` };
  }

  return { value: num };
}

/**
 * Parse duration input and convert to simple value format
 *
 * Adapts the canonical parseDurationInput from SettingsModalFactory
 * to the format used by this handler (null=auto, -1=off, number=seconds).
 */
export function parseDurationInputValue(input: string): ParsedSettingValue {
  const result = parseDurationInput(input);

  switch (result.type) {
    case 'auto':
      return { value: null };
    case 'off':
      // The canonical wire OFF sentinel — persisted by the gateway as stored
      // null (explicit terminal OFF); see CONFIG_WIRE_OFF's contract.
      return { value: CONFIG_WIRE_OFF };
    case 'value':
      return { value: result.seconds };
    case 'error':
      return { error: result.message };
  }
}
