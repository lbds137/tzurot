/**
 * Zod schemas for TTS Config API endpoints
 *
 * Mirrors `llm-config.ts` shape for the TTS provider-config CRUD surface.
 * BOTH api-gateway and bot-client should import these to ensure type safety.
 *
 * Includes:
 * - Input schemas for create/update operations (shared between admin and user)
 * - Response schemas for GET operations
 * - Prisma SELECT constants
 * - Default values for new configs
 */

import { z } from 'zod';
import { EntityPermissionsSchema, optionalString, nullableString } from './shared.js';
import { isTtsProviderId } from '../../services/tts/TtsProvider.js';
import { CONFIG_NAME_MAX_LENGTH } from '../../constants/index.js';

// ============================================================================
// Provider validation (mirrors `isTtsProviderId` runtime guard)
// ============================================================================

/**
 * Zod schema for the TTS provider id. Refines a string against the
 * runtime guard `isTtsProviderId` so any new providers added there
 * automatically flow through to schema validation.
 */
export const TtsProviderIdSchema = z
  .string()
  .refine(isTtsProviderId, "provider must be one of 'self-hosted', 'elevenlabs', 'mistral'");

// ============================================================================
// Advanced parameters schema
// ============================================================================

/**
 * Provider-specific knobs (e.g. ElevenLabs' stability/similarity, Mistral's
 * voice_settings). Permissive shape — record-of-unknown — because each
 * provider validates its own params at synthesize time and the cross-provider
 * union of valid keys would be unwieldy to encode here. Keeping this loose
 * is also what `TtsAdvancedParams` (the runtime type) declares.
 *
 * If per-provider strict validation is later desired, branch on `provider`
 * inside `TtsConfigCreateSchema.refine(...)` and switch to a discriminated
 * union here.
 */
export const TtsAdvancedParamsSchema = z.record(z.string(), z.unknown());

// ============================================================================
// Input Schemas (shared between admin and user endpoints)
// ============================================================================

/**
 * Schema for creating a new TTS config.
 *
 * Unified schema for both admin and user create operations. The difference
 * in behavior (isGlobal, ownerId) is handled by the service layer.
 */
export const TtsConfigCreateSchema = z.object({
  // Required fields
  name: z
    .string()
    .min(1, 'name is required')
    .max(CONFIG_NAME_MAX_LENGTH, 'name must be 100 characters or less'),
  provider: TtsProviderIdSchema,

  // Optional fields
  description: z.string().max(500).optional().nullable(),
  /** Provider-specific model id (e.g. `'eleven_multilingual_v2'`,
   *  `'voxtral-mini-tts-2603'`). NULL/omitted for providers with no model
   *  dimension (e.g. self-hosted). */
  modelId: z.string().max(255).optional().nullable(),
  advancedParameters: TtsAdvancedParamsSchema.optional(),

  /**
   * When true, if the requested `name` collides with an existing config owned
   * by the same user, the server bumps a `(Copy N)` suffix until it finds a
   * free slot instead of returning NAME_COLLISION. Mirrors the LlmConfig
   * preset clone flow.
   *
   * Default: false — regular create calls keep strict name-uniqueness
   * enforcement so accidental name-reuse surfaces as an error.
   */
  autoSuffixOnCollision: z.boolean().optional(),
});

export type TtsConfigCreateInput = z.infer<typeof TtsConfigCreateSchema>;

/**
 * Schema for updating an existing TTS config.
 *
 * Uses empty-to-undefined transforms so clients can send "" to "not update"
 * a field (matches the LlmConfigUpdate pattern used by the dashboard form
 * inputs).
 */
export const TtsConfigUpdateSchema = z.object({
  // Required DB fields: empty string → undefined (preserve existing value)
  name: optionalString(CONFIG_NAME_MAX_LENGTH),
  /** Provider can be re-pointed (e.g. swap a config from elevenlabs to
   *  mistral) — empty string preserves existing. */
  provider: optionalString(40),

  // Nullable DB fields: empty string → null (clear the value)
  description: nullableString(500),
  modelId: nullableString(255),

  advancedParameters: TtsAdvancedParamsSchema.optional(),

  /** Toggle global visibility — users can share their TTS configs */
  isGlobal: z.boolean().optional(),
});

export type TtsConfigUpdateInput = z.infer<typeof TtsConfigUpdateSchema>;

// ============================================================================
// Prisma SELECT constants
// ============================================================================

/**
 * Select fields for list queries (summary data).
 * Used when returning arrays of configs.
 *
 * isDefault/isFreeDefault are NOT selected: default-ness derives from the
 * AdminSettings TTS pointers (the columns are stale, pending-DROP) — the
 * service decorates rows with pointer-derived flags before they leave.
 */
export const TTS_CONFIG_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  provider: true,
  modelId: true,
  isGlobal: true,
  ownerId: true,
} as const;

/**
 * Select fields for detail queries (includes all editable fields).
 * Used when returning a single config with full details.
 */
export const TTS_CONFIG_DETAIL_SELECT = {
  ...TTS_CONFIG_LIST_SELECT,
  advancedParameters: true,
} as const;

// ============================================================================
// Default values (used when creating configs)
// ============================================================================

/**
 * Defaults for TTS config fields. Used by both admin and user routes for
 * consistency with the LlmConfigService pattern. Note: TTS has no shared
 * memory/context/sampling defaults — the only field worth defaulting is
 * the provider, and even that is required at creation time, so this object
 * is intentionally minimal. Kept as a named constant for parity with
 * `LLM_CONFIG_DEFAULTS` and to give future shared defaults a place to land.
 */
export const TTS_CONFIG_DEFAULTS = {
  /** Sentinel — TtsConfigCreateSchema requires `provider` so this default
   *  is informational; the schema rejects an omitted provider before this
   *  value would apply. Kept for documentation parity with LLM_CONFIG_DEFAULTS. */
  provider: 'self-hosted',
} as const;

// ============================================================================
// Response Schemas
// ============================================================================

/**
 * Summary of a TTS configuration.
 *
 * `id` is validated as an RFC 4122 UUID at the gateway's response boundary
 * (matches the LlmConfigSummary pattern — DB accepts non-RFC variants but
 * Zod's `.uuid()` is stricter, and we want the boundaries aligned).
 */
export const TtsConfigSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  provider: TtsProviderIdSchema,
  modelId: z.string().nullable(),
  isGlobal: z.boolean(),
  isDefault: z.boolean(),
  isOwned: z.boolean(),
  permissions: EntityPermissionsSchema,
});

export type TtsConfigSummary = z.infer<typeof TtsConfigSummarySchema>;

// ============================================================================
// GET /user/tts-config
// Returns list of visible configs (global + user-owned)
// ============================================================================

export const ListTtsConfigsResponseSchema = z.object({
  configs: z.array(TtsConfigSummarySchema),
});

// ============================================================================
// POST /user/tts-config
// Creates a new user-owned config
// ============================================================================

export const CreateTtsConfigResponseSchema = z.object({
  config: TtsConfigSummarySchema,
});

// ============================================================================
// DELETE /user/tts-config/:id
// Deletes a user-owned config
// ============================================================================

export const DeleteTtsConfigResponseSchema = z.object({
  deleted: z.literal(true),
});

// ============================================================================
// GET /admin/tts-config/:id and GET /user/tts-config/:id
// Returns a single TTS config (admin: global; user: ownership-checked).
// ============================================================================

export const GetTtsConfigResponseSchema = z.object({
  config: TtsConfigSummarySchema,
});

// ============================================================================
// PUT /admin/tts-config/:id and PUT /user/tts-config/:id
// Updates a TTS config; returns the post-update shape.
// ============================================================================

export const UpdateTtsConfigResponseSchema = z.object({
  config: TtsConfigSummarySchema,
});

// ============================================================================
// PUT /admin/tts-config/:id/set-default
// PUT /admin/tts-config/:id/set-free-default
// Promotes a global TTS config to the paid / free default; mirrors the
// LLM-config set-default shape.
// ============================================================================

export const SetDefaultTtsConfigResponseSchema = z.object({
  success: z.literal(true),
  configName: z.string(),
});
