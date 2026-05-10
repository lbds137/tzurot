/**
 * STT Provider Identity
 *
 * Identifies which speech-to-text backend should transcribe an audio
 * attachment. Resolved by `SttResolver` from the user's cascade
 * (per-personality override > user default > TTS-derived > admin default
 *  > voice-engine fallback).
 *
 * Distinct from {@link AudioProviderId}: AudioProviderId only enumerates
 * BYOK providers (elevenlabs, mistral) — single API key serves both TTS
 * and STT for those. SttProvider additionally includes 'voice-engine',
 * the self-hosted free-tier backend that needs no key and is the
 * cascade's hardcoded fallback.
 *
 * Stable contract: these strings are persisted in `users.default_provider`,
 * `users.default_stt_provider_id`, and `user_personality_configs.stt_provider_id`.
 * Renaming any of them is a database migration.
 */
export type SttProvider = 'mistral' | 'elevenlabs' | 'voice-engine';

/**
 * All valid SttProvider values, useful for Zod enums and admin UIs.
 *
 * Const tuple (not `readonly SttProvider[]`) so `z.enum(STT_PROVIDERS)`
 * infers a literal-union output type instead of widening to `string`.
 */
export const STT_PROVIDERS = [
  'mistral',
  'elevenlabs',
  'voice-engine',
] as const satisfies readonly SttProvider[];

/**
 * Type guard: is the given string a known STT provider?
 *
 * Useful at the api-gateway boundary when parsing request bodies and at
 * the SttResolver boundary when reading raw DB strings before narrowing.
 */
export function isSttProvider(value: string): value is SttProvider {
  return (STT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * BYOK audio providers — those where the same key authorizes both TTS and STT.
 * When TTS resolves to one of these, the SttResolver's Layer 3 (`tts-derived`)
 * uses the same provider for STT (the user already has the key).
 *
 * `voice-engine` is excluded because it's self-hosted (no key concept).
 */
const BYOK_AUDIO_PROVIDERS = new Set<string>(['mistral', 'elevenlabs']);

/** True when a TTS provider also serves as the BYOK STT provider via Layer 3. */
export function isByokAudioProvider(provider: string): provider is 'mistral' | 'elevenlabs' {
  return BYOK_AUDIO_PROVIDERS.has(provider);
}

/**
 * Source layer for an STT resolution result. Canonical declaration alongside
 * the STT provider type. The Zod schema in
 * `packages/common-types/src/schemas/api/voice-resolution.ts` builds its enum
 * from this tuple — keeping the runtime values and the type in one place.
 */
export const STT_RESOLUTION_SOURCES = [
  'user-personality',
  'user-default',
  'tts-derived',
  'admin-default',
  'hardcoded',
] as const;
export type SttResolutionSource = (typeof STT_RESOLUTION_SOURCES)[number];

/**
 * User-friendly display name for an STT provider. Used by `/voice view`
 * dashboard sections and embed footers.
 */
export function sttProviderDisplayName(provider: SttProvider): string {
  switch (provider) {
    case 'mistral':
      return 'Mistral';
    case 'elevenlabs':
      return 'ElevenLabs';
    case 'voice-engine':
      return 'Self-hosted (Parakeet TDT)';
  }
}
