/**
 * Config Cascade Overrides Schema
 *
 * Defines the shape of JSONB config override columns used in the 5-tier config cascade:
 *   hardcoded defaults < admin < personality < channel < user-default < user+personality
 *
 * All fields are optional in the schema (partial overrides). The resolver merges
 * tiers bottom-up to produce a fully-resolved object with no undefined fields.
 */

import { z } from 'zod';

// ============================================================================
// Config Overrides Schema (JSONB column shape)
// ============================================================================

/**
 * Schema for JSONB config override columns.
 * All fields optional — each tier only specifies the fields it wants to override.
 * `.strip()` discards unknown keys to prevent JSONB column drift.
 */
export const ConfigOverridesSchema = z
  .object({
    /** Max messages to include in conversation context (1-100) */
    maxMessages: z.number().int().min(1).max(100).optional(),
    /** Max age in seconds for context messages (null = no limit, 0 = disabled) */
    maxAge: z.number().int().min(0).nullable().optional(),
    /** Max images to process from extended context (0-20) */
    maxImages: z.number().int().min(0).max(20).optional(),
    /** Minimum similarity score for memory retrieval (0-1) */
    memoryScoreThreshold: z.number().min(0).max(1).optional(),
    /** Maximum number of memories to retrieve (0 = disabled) */
    memoryLimit: z.number().int().min(0).optional(),
    /** Focus mode: disable LTM retrieval (memories still saved) */
    focusModeEnabled: z.boolean().optional(),
    /** Fill unused context budget with history from other channels */
    crossChannelHistoryEnabled: z.boolean().optional(),
    /** Share long-term memories across all personalities (migrated from Persona column) */
    shareLtmAcrossPersonalities: z.boolean().optional(),
    /** Whether to show the model indicator footer on AI responses */
    showModelFooter: z.boolean().optional(),
    /** Voice response mode: 'always' = every response, 'voice-only' = when user sends voice, 'never' = disabled */
    voiceResponseMode: z.enum(['always', 'voice-only', 'never']).optional(),
    /** Whether to auto-transcribe voice messages (runtime control; VOICE_ENGINE_URL remains infrastructure config) */
    voiceTranscriptionEnabled: z.boolean().optional(),
  })
  .strip();

export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>;

// ============================================================================
// Hardcoded Defaults
// ============================================================================

/**
 * Hardcoded defaults for all config override fields.
 * These are the values used when no tier provides an override.
 * Must include every field in ConfigOverrides (fully resolved, no undefined).
 */
export const HARDCODED_CONFIG_DEFAULTS: {
  readonly maxMessages: 50;
  readonly maxAge: null;
  readonly maxImages: 10;
  readonly memoryScoreThreshold: 0.5;
  readonly memoryLimit: 20;
  readonly focusModeEnabled: false;
  readonly crossChannelHistoryEnabled: false;
  readonly shareLtmAcrossPersonalities: false;
  readonly showModelFooter: true;
  readonly voiceResponseMode: 'always';
  readonly voiceTranscriptionEnabled: true;
} = {
  maxMessages: 50,
  maxAge: null,
  maxImages: 10,
  memoryScoreThreshold: 0.5,
  memoryLimit: 20,
  focusModeEnabled: false,
  crossChannelHistoryEnabled: false,
  shareLtmAcrossPersonalities: false,
  showModelFooter: true,
  voiceResponseMode: 'always',
  voiceTranscriptionEnabled: true,
};

// ============================================================================
// Source Tracking
// ============================================================================

/**
 * Source of a resolved config override value.
 * Tracks which tier provided each field in the final resolved config.
 *
 * Cascade order (lowest → highest priority):
 *   hardcoded → admin → personality → channel → user-default → user-personality
 */
export type ConfigOverrideSource =
  'hardcoded' | 'admin' | 'personality' | 'channel' | 'user-default' | 'user-personality';

/**
 * Fully resolved config overrides with source tracking.
 * Every field is guaranteed to have a value (no undefined).
 */
export interface ResolvedConfigOverrides {
  /** Effective values (fully resolved, never undefined) */
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  memoryScoreThreshold: number;
  memoryLimit: number;
  focusModeEnabled: boolean;
  crossChannelHistoryEnabled: boolean;
  shareLtmAcrossPersonalities: boolean;
  showModelFooter: boolean;
  voiceResponseMode: 'always' | 'voice-only' | 'never';
  voiceTranscriptionEnabled: boolean;

  /** Per-field source tracking: which tier provided each value */
  sources: Record<keyof ConfigOverrides, ConfigOverrideSource>;
}

// ============================================================================
// Runtime schemas for resolved + raw config-overrides API endpoints
// ============================================================================

const ConfigOverrideSourceSchema = z.enum([
  'hardcoded',
  'admin',
  'personality',
  'channel',
  'user-default',
  'user-personality',
]);

/**
 * Runtime tuple of `ConfigOverrides` field names.
 *
 * Single source of truth for the known finite key set; `keyof ConfigOverrides`
 * is type-only and can't reach Zod at runtime. The `satisfies` clause forces
 * the compiler to verify every key in the tuple exists on `ConfigOverrides`;
 * the test in `configOverrides.test.ts` asserts the inverse (every key in
 * `ConfigOverrides` is present here). Together those make drift impossible.
 */
export const CONFIG_OVERRIDES_KEYS = [
  'maxMessages',
  'maxAge',
  'maxImages',
  'memoryScoreThreshold',
  'memoryLimit',
  'focusModeEnabled',
  'crossChannelHistoryEnabled',
  'shareLtmAcrossPersonalities',
  'showModelFooter',
  'voiceResponseMode',
  'voiceTranscriptionEnabled',
] as const satisfies readonly (keyof ConfigOverrides)[];

const ConfigOverridesKeySchema = z.enum(CONFIG_OVERRIDES_KEYS);

/**
 * Runtime Zod schema mirroring the ResolvedConfigOverrides interface above.
 * Used as the response schema for cascade-resolution endpoints.
 *
 * Derived from `ConfigOverridesSchema.required()` so the field list and
 * validators stay in sync automatically when a new override is added —
 * `.required()` strips the per-field `.optional()` wrappers but preserves
 * nullable types (e.g., `maxAge` remains `number | null`), which matches
 * the `ResolvedConfigOverrides` interface above. The `.extend()` adds the
 * resolver-specific `sources` field.
 *
 * `sources` uses exhaustive `z.record(enum, value)` (Zod v4: this requires
 * every enum member as a key) because both emission paths —
 * `ConfigCascadeResolver.mergeTiers` and the flat `handleResolveUserDefaults`
 * handler — initialize every key to `'hardcoded'` before applying overrides.
 * The exhaustive shape gives callers tighter type inference
 * (`Record<KnownKey, Source>` rather than `Partial<...>`).
 */
export const ResolvedConfigOverridesSchema = ConfigOverridesSchema.required().extend({
  sources: z.record(ConfigOverridesKeySchema, ConfigOverrideSourceSchema),
});

/**
 * Compile-time collision guard. Proves `keyof ConfigOverrides` has empty
 * intersection with the reserved meta-keys (`sources`, `userOverrides`).
 * If a future contributor adds a `ConfigOverrides` field named `sources`
 * or `userOverrides`, this type assertion fails to compile, catching the
 * flat-spread collision risk at the type level rather than at runtime.
 */
type _ReservedKeysDoNotCollide =
  Extract<keyof ConfigOverrides, 'sources' | 'userOverrides'> extends never ? true : false;
const _reservedKeysCheck: _ReservedKeysDoNotCollide = true;
// Reference the check so `noUnusedLocals` keeps it. Compile-time guard only.
void _reservedKeysCheck;

/**
 * Response for GET /user/config-overrides/resolve-defaults.
 *
 * Flat shape: each `ConfigOverrides` field appears at the top level alongside
 * `sources` (per-field provenance) and `userOverrides` (the raw user tier
 * stored in DB, or null if unset).
 *
 * Derived from `ConfigOverridesSchema.required().extend({ sources, userOverrides })`
 * so callers get the strongly-typed `ConfigOverrides` fields at root
 * (`maxMessages: number | null`, `voiceResponseMode: enum`, etc.) instead of
 * the previous `.passthrough()` shape that yielded `{ [k: string]: unknown }`.
 * Field collisions with `sources` / `userOverrides` are prevented at compile
 * time by the `_ReservedKeysDoNotCollide` assertion above.
 */
export const ResolveUserConfigDefaultsResponseSchema = ConfigOverridesSchema.required().extend({
  sources: z.record(ConfigOverridesKeySchema, ConfigOverrideSourceSchema),
  userOverrides: z.record(z.string(), z.unknown()).nullable(),
});

/** Response for GET /user/config-overrides/defaults — the raw JSONB column (or null). */
export const GetUserConfigDefaultsResponseSchema = z.object({
  configDefaults: z.record(z.string(), z.unknown()).nullable(),
});

/** Response for PATCH /user/config-overrides/defaults — merged result echoed back. */
export const UpdateConfigDefaultsResponseSchema = z.object({
  configDefaults: z.record(z.string(), z.unknown()),
});

/** Response for DELETE /user/config-overrides/defaults — bare success ack. */
export const ClearUserConfigDefaultsResponseSchema = z.object({
  success: z.literal(true),
});

/** Response for PATCH /user/config-overrides/:personalityId — merged per-personality overrides. */
export const UpdatePersonalityConfigOverridesResponseSchema = z.object({
  configOverrides: z.record(z.string(), z.unknown()),
});

/** Response for DELETE /user/config-overrides/:personalityId — bare success ack. */
export const ClearPersonalityConfigOverridesResponseSchema = z.object({
  success: z.literal(true),
});

// ============================================================================
// Channel-tier overrides (/user/channel/:channelId/config-overrides)
// ============================================================================

/** Response for GET /user/channel/:channelId/config-overrides — raw JSONB (or null if no row). */
export const GetChannelConfigOverridesResponseSchema = z.object({
  configOverrides: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * Request for PATCH /user/channel/:channelId/config-overrides — partial merge.
 * Bare record (not `ConfigOverridesSchema.partial()`) because the wire format
 * accepts `null` for ANY field to clear it (dashboard "auto" buttons), not
 * just the schema's `.nullable()` fields. The gateway-side
 * `handleUpdateChannelConfigOverrides` handler runs `mergeConfigOverrides`
 * which normalizes null → undefined and validates against
 * `ConfigOverridesSchema.partial()` — that's where the real type check happens.
 * Caller-side typo protection on field names lives upstream in the dashboard
 * config layer (typed `settingId → apiField` map).
 */
export const UpdateChannelConfigOverridesRequestSchema = z.record(z.string(), z.unknown());
/** Response for PATCH /user/channel/:channelId/config-overrides — merged result echoed back. */
export const UpdateChannelConfigOverridesResponseSchema = z.object({
  configOverrides: z.record(z.string(), z.unknown()),
});

/** Response for DELETE /user/channel/:channelId/config-overrides — bare success ack. */
export const ClearChannelConfigOverridesResponseSchema = z.object({
  success: z.literal(true),
});
