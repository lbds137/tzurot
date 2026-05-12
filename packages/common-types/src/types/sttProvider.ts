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
 * Stable contract: these strings are persisted in
 * `users.default_stt_provider_id` (the surviving column after the cascade
 * simplification migration). Renaming any of them is a database migration
 * — and any new value added here also needs a companion ALTER on the
 * `valid_default_stt_provider_id` CHECK constraint.
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

/** True when a TTS provider also serves as the BYOK STT provider via the tts-derived layer. */
export function isByokAudioProvider(provider: string): provider is 'mistral' | 'elevenlabs' {
  return BYOK_AUDIO_PROVIDERS.has(provider);
}

/**
 * Resolved STT dispatch — the (provider, optional-key) tuple passed through
 * the ai-worker pipeline from `SttResolver` down to `AudioProcessor`. The
 * `apiKey` is undefined when `provider === 'voice-engine'` (self-hosted, no
 * key concept); BYOK paths carry a key from `ApiKeyResolver`.
 *
 * Single source of truth — inline `{ provider: SttProvider; apiKey?: string }`
 * shapes in pipeline code should reference this type instead.
 */
export interface SttDispatch {
  provider: SttProvider;
  apiKey?: string;
}

/**
 * Source layer for an STT resolution result. Canonical declaration alongside
 * the STT provider type. The Zod schema in
 * `packages/common-types/src/schemas/api/voice-resolution.ts` builds its enum
 * from this tuple — keeping the runtime values and the type in one place.
 */
export const STT_RESOLUTION_SOURCES = ['user-default', 'tts-derived', 'hardcoded'] as const;
export type SttResolutionSource = (typeof STT_RESOLUTION_SOURCES)[number];

/**
 * Display + canonical-URL metadata for each STT provider, kept as a single
 * data table so adding a new provider is one entry — display name and
 * canonical URL stay in sync automatically.
 *
 * `displayName` is the user-friendly label rendered in `/voice view` and
 * transcript attribution footers. `infoUrl` points to the canonical model
 * card / project page (vendor docs for Mistral + ElevenLabs, upstream
 * HuggingFace card for the self-hosted Parakeet TDT model). There's no
 * API-discoverable URL for either category, so these are hardcoded — when
 * a vendor rebrands or relocates their docs, this is the one place to update.
 */
const STT_PROVIDER_METADATA: Record<SttProvider, { displayName: string; infoUrl: string }> = {
  mistral: {
    displayName: 'Mistral',
    infoUrl: 'https://mistral.ai/news/voxtral',
  },
  elevenlabs: {
    displayName: 'ElevenLabs',
    infoUrl: 'https://elevenlabs.io/speech-to-text',
  },
  'voice-engine': {
    displayName: 'Self-hosted (Parakeet TDT)',
    infoUrl: 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2',
  },
};

/**
 * User-friendly display name for an STT provider. Used by `/voice view`
 * dashboard sections and embed footers.
 */
export function sttProviderDisplayName(provider: SttProvider): string {
  return STT_PROVIDER_METADATA[provider].displayName;
}

/**
 * Canonical project / vendor page for an STT provider's transcription model.
 * Used to render the transcript attribution as a clickable Discord link, mirroring
 * the LLM model footer's `Model: [name](<url>)` shape.
 */
export function sttProviderInfoUrl(provider: SttProvider): string {
  return STT_PROVIDER_METADATA[provider].infoUrl;
}
