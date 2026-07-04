/**
 * TtsConfigMapper — Prisma row → application-shape mapping for TtsConfig.
 *
 * Mirrors `LlmConfigMapper` for TTS. Significantly simpler than the LLM
 * version because TTS has only one structured field (`advancedParameters`
 * JSONB); per-provider knobs (stability, similarity, etc.) live in the
 * JSONB and are validated per-provider.
 */

import { isTtsProviderId, type TtsAdvancedParams, type TtsProviderId } from './tts/TtsProvider.js';

/**
 * Prisma `select` shape used to load a TtsConfig with all fields the resolver
 * needs (ownership flags, provider/modelId, advancedParameters JSONB).
 *
 * Note: `name` is NOT included here so that this select can be reused in
 * places that don't care about display name. Use `TTS_CONFIG_SELECT_WITH_NAME`
 * when the caller needs `name` for source-tracking.
 */
export const TTS_CONFIG_SELECT = {
  provider: true,
  modelId: true,
  advancedParameters: true,
  isGlobal: true,
} as const;

/**
 * Same as `TTS_CONFIG_SELECT` but additionally pulls `name` for source tracking
 * (the resolver returns `configName` so callers know which config produced
 * the result).
 */
export const TTS_CONFIG_SELECT_WITH_NAME = {
  ...TTS_CONFIG_SELECT,
  name: true,
} as const;

/** Raw shape from a Prisma query selecting TTS_CONFIG_SELECT_WITH_NAME. */
export interface RawTtsConfigFromDb {
  name: string;
  provider: string;
  modelId: string | null;
  advancedParameters: unknown;
  isGlobal: boolean;
}

/** Application-shape mapped TtsConfig (post-DB → app translation). */
export interface MappedTtsConfigWithName {
  name: string;
  provider: TtsProviderId;
  modelId: string | null;
  advancedParameters: TtsAdvancedParams;
}

/**
 * Map a raw Prisma TtsConfig row to the application shape.
 *
 * - `provider` is narrowed from `string` to `TtsProviderId` via the shared
 *   `isTtsProviderId` type guard from `TtsProvider.ts` — single source of
 *   truth so future provider additions (e.g. NeuTTS Air) don't
 *   require updating both places. Non-matching values fall back silently
 *   to `'self-hosted'` (no logging) — DB rows with stale provider strings
 *   shouldn't crash the cascade. The dispatcher will produce a normal
 *   "no usable provider" error path for the affected row.
 * - `advancedParameters` is parsed leniently: `null` becomes `{}`. Validation
 *   against the per-provider schema happens at the provider layer, not here.
 */
export function mapTtsConfigFromDbWithName(raw: RawTtsConfigFromDb): MappedTtsConfigWithName {
  const provider: TtsProviderId = isTtsProviderId(raw.provider) ? raw.provider : 'self-hosted';

  return {
    name: raw.name,
    provider,
    modelId: raw.modelId,
    advancedParameters:
      raw.advancedParameters !== null && typeof raw.advancedParameters === 'object'
        ? (raw.advancedParameters as TtsAdvancedParams)
        : {},
  };
}
