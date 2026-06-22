/**
 * Config Resolution Result Types
 *
 * Shared result/contract shapes for LLM configuration resolution. The resolver
 * CLASSES live in `@tzurot/config-resolver`, but these RESULT types are
 * data-shape contracts consumed across service boundaries — e.g. the gateway
 * `/user/llm-config/resolve` endpoint response that bot-client receives and
 * types against — so they belong in the shared type package (bot-client must
 * not depend on the Prisma-backed config-resolver package).
 */

import type { ConvertedLlmParams } from '../schemas/llmAdvancedParams.js';
import type { ResolvedConfigOverrides } from '../schemas/api/configOverrides.js';

/**
 * Source tier that provided the resolved config.
 *
 * The base waterfall walks `'user-personality' → 'user-default' → 'personality'`
 * — those three tiers are produced directly by the base. `'free-default'` and
 * `'hardcoded'` are tiers some subclasses (currently `TtsConfigResolver`) fall
 * through to inside `extractFromPersonality` when the personality has no inline
 * default. Subclasses signal those tiers via `getExtractSource()` so the outer
 * wrapper's `source` field matches the inner config's source.
 */
export type ConfigResolutionSource =
  | 'user-personality'
  | 'user-default'
  | 'personality'
  | 'free-default'
  | 'hardcoded';

/** Result of cascade resolution, with source tracking. */
export interface BaseConfigResolutionResult<TResolved> {
  /** Effective config (merged with personality defaults where applicable). */
  config: TResolved;
  /** Tier that provided the config. */
  source: ConfigResolutionSource;
  /** Name of the override config (omitted when source === 'personality'). */
  configName?: string;
}

/**
 * Effective resolved LLM config: the converted advanced params (temperature,
 * etc.) plus database-specific fields (memory, context window, context settings).
 */
export interface ResolvedLlmConfig extends ConvertedLlmParams {
  model: string;
  visionModel?: string | null;
  memoryScoreThreshold?: number | null;
  memoryLimit?: number | null;
  contextWindowTokens?: number;
  // Context settings (conversation history limits)
  maxMessages?: number;
  maxAge?: number | null;
  maxImages?: number;
}

/**
 * Result of LLM config resolution.
 *
 * Extends `BaseConfigResolutionResult<ResolvedLlmConfig>` with the optional
 * `overrides` field that the gateway `/user/llm-config/resolve` endpoint adds
 * (cascade-resolved config overrides from `ConfigCascadeResolver`). The resolver
 * itself never sets `overrides` — it's populated by API callers downstream of
 * resolution.
 */
export interface ConfigResolutionResult extends BaseConfigResolutionResult<ResolvedLlmConfig> {
  /** Cascade-resolved config overrides (from ConfigCascadeResolver, returned by resolve endpoint) */
  overrides?: ResolvedConfigOverrides;
}

/**
 * Minimal personality shape the TTS config resolver needs (mirrors the LLM
 * pattern's `LoadedPersonality`, sized to TTS's narrower data needs). Lives here
 * as a shared data shape rather than in the Prisma-backed `@tzurot/config-resolver`
 * package — the resolution LOGIC stays there; the SHAPE is common-types' concern.
 */
export interface LoadedTtsPersonality {
  id: string;
}
