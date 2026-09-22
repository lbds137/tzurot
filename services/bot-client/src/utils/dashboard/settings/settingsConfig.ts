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
    id: 'crossChannelHistoryEnabled',
    label: 'Cross-Channel History',
    emoji: '🔀',
    description:
      'Fill unused context budget with conversation history from other channels. ' +
      'When enabled, characters remember conversations from other channels with you.',
    type: SettingType.TRI_STATE,
    helpText:
      'When enabled, fills unused context with conversation history from other channels ' +
      "where you've talked to this character. Privacy note: the character may reference " +
      'those conversations anywhere it talks to you — including channels more public than ' +
      'the one they happened in — so leave this disabled if you keep some conversations separate.',
  },
  {
    id: 'crossChannelRenderMode',
    label: 'Cross-Channel Content',
    emoji: '🗣️',
    description:
      'What the character sees from your conversations in other channels: both sides, ' +
      'or only your own messages. Your-messages-only keeps the continuity without the ' +
      'character re-reading its own past replies.',
    type: SettingType.ENUM,
    choices: [
      { value: 'both', label: 'Both sides', emoji: '💬' },
      { value: 'user-only', label: 'Your messages only', emoji: '🙋' },
    ],
    helpText: 'Only applies when Cross-Channel History is enabled.',
  },
  {
    id: 'crossChannelMaxMessages',
    label: 'Cross-Channel Max Messages',
    emoji: '🔢',
    description:
      'How many recent messages to pull from other channels, across all of them. ' +
      'Leave on auto to follow Max Messages.',
    type: SettingType.NUMERIC,
    min: 1,
    max: 100,
    placeholder: 'Enter a number (1-100) or "auto"',
    nullDisplay: 'Auto (follows Max Messages)',
    helpText:
      'Applies only when Cross-Channel History is enabled. This is a total across ' +
      'channels, not per channel, and it counts messages as fetched — with ' +
      'Cross-Channel Content set to your messages only, the character sees fewer ' +
      'than this number, since the replies are dropped after the fetch.',
  },
  {
    id: 'sameChannelRenderMode',
    label: 'This-Channel Content',
    emoji: '📜',
    description:
      'What the character sees from the older part of THIS channel: every turn, ' +
      'its own older replies replaced by their stored summary, or only your ' +
      'messages. Summarizing keeps what it said without it re-reading its own prose.',
    type: SettingType.ENUM,
    choices: [
      { value: 'both', label: 'Every turn', emoji: '💬' },
      { value: 'summarized', label: 'Summarize its older replies', emoji: '📝' },
      { value: 'user-only', label: 'Your messages only', emoji: '🙋' },
    ],
    helpText: 'The most recent exchanges always stay verbatim — see Verbatim Exchanges.',
  },
  {
    id: 'sameChannelVerbatimExchanges',
    label: 'Verbatim Exchanges',
    emoji: '🔒',
    description:
      'How many of the most recent exchanges in this channel always stay word-for-word, ' +
      'regardless of This-Channel Content. An exchange runs up to and including the ' +
      "character's reply.",
    type: SettingType.NUMERIC,
    min: 1,
    max: 50,
    placeholder: 'Enter a number (1-50) or "auto"',
    nullDisplay: 'Auto (inherits; default 10)',
    helpText: 'Only applies when This-Channel Content is not set to every turn.',
  },
  {
    id: 'shareLtmAcrossPersonalities',
    label: 'Share Memories',
    emoji: '🧠',
    description:
      'Share long-term memories across all characters. ' +
      'When enabled, what you tell one character is remembered by all others.',
    type: SettingType.TRI_STATE,
    helpText:
      'When enabled, long-term memories are shared across all characters ' +
      'instead of being per-character',
  },
  {
    id: 'shareHistoryAcrossPersonalities',
    label: 'Share Chat History',
    emoji: '📜',
    description:
      "Controls whether characters see each other's replies (and your messages to them) " +
      'in the same channel, or only their own conversation with you.',
    type: SettingType.ENUM,
    choices: [
      { value: 'always', label: 'Always Shared', emoji: '📜' },
      { value: 'guilds-only', label: 'Shared in Servers, Isolated in DMs', emoji: '🏰' },
      { value: 'dms-only', label: 'Shared in DMs, Isolated in Servers', emoji: '✉️' },
      { value: 'never', label: 'Always Isolated', emoji: '🔒' },
    ],
    helpText:
      '"Isolated" means a character reads only its own conversation with you. ' +
      "In DMs that covers everything it picks up on its own — no other character's replies, " +
      "and none of your messages to them. Replying directly to another character's message " +
      'still shows that message, since that is you quoting it on purpose. In servers, ' +
      'isolation applies to stored history only: recent messages still visible in the ' +
      'channel can still be included, since everyone there can already see them.',
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

/**
 * Display settings definitions
 */
export const DISPLAY_SETTINGS: SettingDefinition[] = [
  {
    id: 'showModelFooter',
    label: 'Model Footer',
    emoji: '🏷️',
    description:
      'Show the model indicator line (e.g., "Model: [claude-sonnet-4](…)") at the bottom of AI responses. ' +
      'Disabling hides the model line but other indicators (guest mode, fresh mode, incognito) still appear.',
    type: SettingType.TRI_STATE,
    helpText: 'When disabled, the model name is hidden from responses',
  },
];

/**
 * Voice transcription setting — admin tier only.
 * voiceTranscriptionEnabled is only read in VoiceMessageProcessor.ts at the admin level.
 */
const VOICE_TRANSCRIPTION_SETTING: SettingDefinition = {
  id: 'voiceTranscriptionEnabled',
  label: 'Voice Transcription',
  emoji: '🎙️',
  description:
    'Auto-transcribe voice messages to text before AI processing. ' +
    'When enabled, voice messages are converted to text using the voice engine.',
  type: SettingType.TRI_STATE,
  helpText: 'Requires a running voice engine service (VOICE_ENGINE_URL)',
};

/**
 * Voice response mode setting — available at all cascade tiers.
 * voiceResponseMode is read through the full cascade in TTSStep.
 */
const VOICE_RESPONSE_MODE_SETTING: SettingDefinition = {
  id: 'voiceResponseMode',
  label: 'Voice Response Mode',
  emoji: '🔊',
  description:
    'Controls when AI responses are converted to voice audio. ' +
    '"Always" sends voice for every response, "Voice Only" only when the user sends voice, ' +
    '"Never" disables TTS entirely.',
  type: SettingType.ENUM,
  choices: [
    { value: 'always', label: 'Always', emoji: '🔊' },
    { value: 'voice-only', label: 'Voice Only', emoji: '🎙️' },
    { value: 'never', label: 'Never', emoji: '🔇' },
  ],
};

/** All voice settings (admin tier only — includes transcription) */
export const VOICE_SETTINGS: SettingDefinition[] = [
  VOICE_TRANSCRIPTION_SETTING,
  VOICE_RESPONSE_MODE_SETTING,
];

/**
 * Voice cascade settings (voiceResponseMode only — for non-admin tiers).
 * voiceTranscriptionEnabled is only read at admin tier, so exposing it
 * in non-admin dashboards would mislead users.
 */
export const VOICE_CASCADE_SETTINGS: SettingDefinition[] = [VOICE_RESPONSE_MODE_SETTING];

/**
 * All known settings across all groups. Single source of truth for setting lookups.
 * Note: VOICE_CASCADE_SETTINGS is intentionally excluded — it's a render-time subset
 * of VOICE_SETTINGS, not a separate group. All voice settings are included via VOICE_SETTINGS.
 */
export const ALL_SETTINGS: SettingDefinition[] = [
  ...EXTENDED_CONTEXT_SETTINGS,
  ...MEMORY_SETTINGS,
  ...DISPLAY_SETTINGS,
  ...VOICE_SETTINGS,
];

/**
 * The shared D14 concern-page grouping for cascade dashboards (design-system
 * §3.3 pagination-by-concern): Memory · Context & Display · Voice. One map for
 * every tier — the caller passes its tier's voice subset (admin includes the
 * transcription toggle; other tiers pass VOICE_CASCADE_SETTINGS), which keeps
 * the 11-vs-10 discrepancy a render-time filter, not a second grouping.
 */
export function buildCascadePages(voiceSettings: SettingDefinition[]): {
  pages: { id: string; label: string; settingIds: string[] }[];
  settings: SettingDefinition[];
} {
  const settings = [
    ...MEMORY_SETTINGS,
    ...EXTENDED_CONTEXT_SETTINGS,
    ...DISPLAY_SETTINGS,
    ...voiceSettings,
  ];
  return {
    settings,
    pages: [
      { id: 'memory', label: 'Memory', settingIds: MEMORY_SETTINGS.map(s => s.id) },
      {
        id: 'context-display',
        label: 'Context & Display',
        settingIds: [...EXTENDED_CONTEXT_SETTINGS, ...DISPLAY_SETTINGS].map(s => s.id),
      },
      { id: 'voice', label: 'Voice', settingIds: voiceSettings.map(s => s.id) },
    ],
  };
}
