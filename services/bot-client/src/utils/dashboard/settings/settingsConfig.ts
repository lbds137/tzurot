/**
 * Settings Configuration
 *
 * Defines the available settings for the extended context dashboard.
 * Shared across /admin settings, /channel context, and /character settings.
 */

import { SettingType, type SettingDefinition } from './types.js';

/**
 * Extended context settings definitions
 */
export const EXTENDED_CONTEXT_SETTINGS: SettingDefinition[] = [
  {
    id: 'maxMessages',
    label: 'Max Messages',
    emoji: '💬',
    description:
      'Maximum number of recent messages to include in context. ' +
      'Higher values provide more context but increase processing time.',
    type: SettingType.NUMERIC,
    min: 1,
    max: 100,
    placeholder: 'Enter a number (1-100) or "auto"',
    helpText: 'Discord API limit: 100 messages per fetch',
  },
  {
    id: 'maxAge',
    label: 'Max Age',
    emoji: '⏱️',
    description:
      'Maximum age of messages to include. Messages older than this are excluded. ' +
      'Use "off" to disable age filtering (only count-based limits apply).',
    type: SettingType.DURATION,
    placeholder: 'e.g., 2h, 30m, 1d, or "off"',
    helpText: 'Examples: 30m (30 minutes), 2h (2 hours), 1d (1 day)',
  },
  {
    id: 'maxImages',
    label: 'Max Images',
    emoji: '🖼️',
    description:
      'Maximum number of images to process with vision AI. ' +
      'Set to 0 to disable proactive image processing (images are only processed when explicitly referenced).',
    type: SettingType.NUMERIC,
    min: 0,
    max: 20,
    placeholder: 'Enter a number (0-20) or "auto"',
    helpText: '0 = lazy mode (process on reference), higher values = proactive processing',
  },
];

/**
 * Get a setting definition by ID
 */
export function getSettingDefinition(settingId: string): SettingDefinition | undefined {
  return EXTENDED_CONTEXT_SETTINGS.find(s => s.id === settingId);
}
