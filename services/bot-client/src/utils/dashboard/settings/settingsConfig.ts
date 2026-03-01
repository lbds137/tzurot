/**
 * Settings Configuration
 *
 * Defines the available settings for the settings dashboard.
 * Shared across /admin settings, /channel context, and /character settings.
 *
 * Settings are grouped by category:
 * - EXTENDED_CONTEXT_SETTINGS: Message count, age, image limits
 * - MEMORY_SETTINGS: LTM and cross-channel history behavior
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
 * Memory and cross-channel settings definitions
 */
export const MEMORY_SETTINGS: SettingDefinition[] = [
  {
    id: 'focusModeEnabled',
    label: 'Focus Mode',
    emoji: '🎯',
    description:
      'When enabled, only the most recent messages are used for context. ' +
      'Disables extended context features like cross-channel history and memory retrieval.',
    type: SettingType.TRI_STATE,
    helpText: 'Useful for performance-sensitive channels or when context is not needed',
  },
  {
    id: 'crossChannelHistoryEnabled',
    label: 'Cross-Channel History',
    emoji: '🔀',
    description:
      'Fill unused context budget with conversation history from other channels. ' +
      'When enabled, personalities remember conversations from other channels with you.',
    type: SettingType.TRI_STATE,
    helpText:
      'When enabled, fills unused context with conversation history from other channels ' +
      "where you've talked to this personality",
  },
  {
    id: 'shareLtmAcrossPersonalities',
    label: 'Share Memories',
    emoji: '🧠',
    description:
      'Share long-term memories across all personalities. ' +
      'When enabled, what you tell one personality is remembered by all others.',
    type: SettingType.TRI_STATE,
    helpText:
      'When enabled, long-term memories are shared across all personalities ' +
      'instead of being per-personality',
  },
  {
    id: 'memoryScoreThreshold',
    label: 'Memory Relevance',
    emoji: '📊',
    description:
      'Minimum similarity score for memory retrieval. ' +
      'Higher values return only highly relevant memories; lower values cast a wider net.',
    type: SettingType.NUMERIC,
    min: 0,
    max: 1,
    placeholder: 'Enter a number (0-1) or "auto"',
    helpText: 'Default: 0.5. Range 0 (everything) to 1 (exact match only)',
  },
  {
    id: 'memoryLimit',
    label: 'Memory Limit',
    emoji: '📝',
    description:
      'Maximum number of long-term memories to retrieve per message. ' +
      'Higher values provide more context but increase processing time.',
    type: SettingType.NUMERIC,
    min: 0,
    max: 100,
    placeholder: 'Enter a number (0-100) or "auto"',
    helpText: 'Default: 20. Set to 0 to disable memory retrieval',
  },
];

/** All known settings across all groups. Single source of truth for setting lookups. */
export const ALL_SETTINGS: SettingDefinition[] = [...EXTENDED_CONTEXT_SETTINGS, ...MEMORY_SETTINGS];
