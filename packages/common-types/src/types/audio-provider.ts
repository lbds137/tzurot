/**
 * Audio Provider Identity
 *
 * Identifies a provider that supplies BOTH TTS and STT endpoints under a
 * single API key. Used as the key type for `audioProviderKeys` on
 * `ResolvedAuth` — one key, all that provider's audio endpoints.
 *
 * Distinct from `AIProvider`: AIProvider enumerates ALL the provider clients
 * the bot talks to (LLM + audio), while `AudioProviderId` is the narrower
 * audio-specific subset.
 *
 * Stable DB contract: these strings are persisted in `tts_configs.provider`
 * and matched at runtime to dispatch to the correct provider implementation.
 * Renaming any of these is a database migration.
 */
export type AudioProviderId = 'elevenlabs' | 'mistral';

/**
 * Type guard: is the given string a known AudioProviderId?
 *
 * Useful when receiving provider strings from external sources (DB rows,
 * Discord interactions, gateway requests) that haven't been narrowed yet.
 */
export function isAudioProviderId(value: string): value is AudioProviderId {
  return value === 'elevenlabs' || value === 'mistral';
}
