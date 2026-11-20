/**
 * Voice Response Mode Constants
 *
 * The three Voice Response Mode values a character may reply with.
 * Single source for the config-override schema (the stored cascade tier),
 * the voice-resolution view schema, and the `/voice replies` command
 * choices, so the three spellings cannot drift.
 */

/** The Voice Response Mode values, in `/voice replies` choice order. */
export const VOICE_RESPONSE_MODES = ['always', 'voice-only', 'never'] as const;

/** One Voice Response Mode value. */
export type VoiceResponseMode = (typeof VOICE_RESPONSE_MODES)[number];
