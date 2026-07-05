/**
 * Zod schemas for LLM Config API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Includes:
 * - Input schemas for create/update operations (shared between admin and user)
 * - Response schemas for GET operations
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';
import { EntityPermissionsSchema, optionalString, nullableString } from './shared.js';
import { AdvancedParamsSchema } from '../llmAdvancedParams.js';
import {
  MESSAGE_LIMITS,
  AI_DEFAULTS,
  CONFIG_KINDS,
  CONFIG_NAME_MAX_LENGTH,
} from '../../constants/index.js';

// ============================================================================
// Context Settings Schema (shared validation for context history limits)
// ============================================================================

/**
 * Context settings sub-schema - used by both create and update handlers.
 * Validation bounds prevent DoS via excessive history fetch.
 *
 * Fields:
 * - maxMessages: 1-100 (capped at MAX_EXTENDED_CONTEXT), defaults to DEFAULT_MAX_MESSAGES
 * - maxImages: 0-20 (0 disables image processing, capped at MAX_CONTEXT_IMAGES), defaults to DEFAULT_MAX_IMAGES
 * - maxAge: 1-2592000 (30 days) or null/undefined (no time limit applied)
 *
 * Cascade behavior (in PersonalityDefaults.getContextSettings):
 * personalityConfig > globalConfig > hardcoded defaults
 * When both personality and global configs have null/undefined maxAge,
 * no time limit is applied to conversation history fetching.
 */
export const ContextSettingsSchema = z.object({
  maxMessages: z
    .number()
    .int()
    .min(1, 'maxMessages must be at least 1')
    .max(
      MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT,
      `maxMessages cannot exceed ${MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT}`
    )
    .optional(),
  maxAge: z
    .number()
    .int()
    .min(1, 'maxAge must be at least 1 second, or omit/set to null for no time limit')
    .max(
      MESSAGE_LIMITS.MAX_CONTEXT_AGE,
      `maxAge cannot exceed ${MESSAGE_LIMITS.MAX_CONTEXT_AGE} seconds (30 days)`
    )
    .optional()
    .nullable(),
  maxImages: z
    .number()
    .int()
    .min(0, 'maxImages must be at least 0 (0 disables image processing)')
    .max(
      MESSAGE_LIMITS.MAX_CONTEXT_IMAGES,
      `maxImages cannot exceed ${MESSAGE_LIMITS.MAX_CONTEXT_IMAGES}`
    )
    .optional(),
});

// ============================================================================
// Input Schemas (shared between admin and user endpoints)
// ============================================================================

/**
 * Schema for creating a new LLM config.
 *
 * This is the unified schema for both admin and user create operations.
 * The difference in behavior (isGlobal, ownerId) is handled by the service layer.
 *
 * All sampling/reasoning params go into advancedParameters JSONB.
 */
export const LlmConfigCreateSchema = z.object({
  // Required fields
  name: z
    .string()
    .min(1, 'name is required')
    .max(CONFIG_NAME_MAX_LENGTH, `name must be ${CONFIG_NAME_MAX_LENGTH} characters or less`),
  model: z.string().min(1, 'model is required').max(200),

  // Config kind discriminator (text | vision | …). Optional; when omitted the
  // service defaults it to 'text', so a caller that doesn't set it gets a text
  // preset. A 'vision' create is validated for vision capability before it's
  // accepted. NOT present on the update schema — `kind` is immutable (changing
  // it would orphan the per-kind default flags); convert by delete + recreate.
  kind: z.enum(CONFIG_KINDS).optional(),

  // Optional string fields
  description: z.string().max(500).optional().nullable(),
  provider: z.string().max(50).optional(),

  // AI behavior settings
  advancedParameters: AdvancedParamsSchema.optional(),

  // Memory settings — schema has `@default(0.5)` / `@default(20)` (NOT NULL).
  // Optional in the input shape (caller can omit and Prisma fills the default),
  // but not nullable: there's no application semantic for "set to null" on
  // these fields. Per `03-database.md`'s null-semantics rule.
  memoryScoreThreshold: z.number().min(0).max(1).optional(),
  memoryLimit: z.number().int().positive().optional(),
  // contextWindowTokens min(1000) is intentional - reasonable minimum for context windows
  contextWindowTokens: z.number().int().min(1000).optional(),

  // Context settings (conversation history limits)
  ...ContextSettingsSchema.shape,

  /**
   * When true, if the requested `name` collides with an existing config owned
   * by the same user, the server bumps a `(Copy N)` suffix until it finds a
   * free slot instead of returning NAME_COLLISION. Used by the preset clone
   * flow so the client can issue a single HTTP request regardless of how
   * many existing copies are already present.
   *
   * Default: false — regular create calls keep strict name-uniqueness
   * enforcement so accidental name-reuse surfaces as an error.
   */
  autoSuffixOnCollision: z.boolean().optional(),
});

export type LlmConfigCreateInput = z.infer<typeof LlmConfigCreateSchema>;

/**
 * Schema for updating an existing LLM config.
 *
 * Uses empty-to-undefined transforms so clients can send "" to "not update" a field.
 * This is the standard pattern for handling form inputs where clearing a field
 * sends empty string instead of omitting the field.
 */
export const LlmConfigUpdateSchema = z.object({
  // Required DB fields: empty string → undefined (preserve existing value)
  name: optionalString(CONFIG_NAME_MAX_LENGTH),
  provider: optionalString(50),
  model: optionalString(200),

  // Nullable DB fields: empty string → null (clear the value)
  description: nullableString(500),

  // AI behavior settings
  advancedParameters: AdvancedParamsSchema.optional(),

  // Memory settings — see LlmConfigCreateSchema for why these aren't nullable.
  memoryScoreThreshold: z.number().min(0).max(1).optional(),
  memoryLimit: z.number().int().positive().optional(),
  contextWindowTokens: z.number().int().min(1000).optional(),

  // Context settings (shared validation)
  ...ContextSettingsSchema.shape,

  /** Toggle global visibility - users can share their presets */
  isGlobal: z.boolean().optional(),

  // NOTE: `kind` is intentionally absent — it's immutable after creation
  // (changing it would orphan the per-kind default flags + mis-route resolvers).
  // Convert a config to another kind by delete + recreate.
});

export type LlmConfigUpdateInput = z.infer<typeof LlmConfigUpdateSchema>;

// ============================================================================
// Prisma SELECT constants
// ============================================================================

/**
 * Select fields for list queries (summary data).
 * Used when returning arrays of configs.
 */
export const LLM_CONFIG_LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  provider: true,
  model: true,
  // Surfaced in the list summary so browse can fetch all kinds in one call and
  // badge/filter by kind without a per-kind round-trip.
  kind: true,
  isGlobal: true,
  // isDefault/isFreeDefault are NOT selected: default-ness is an AdminSettings
  // pointer relationship (S3), and LlmConfigService.list derives the summary
  // flags from those pointers (applyDefaultFlags), not these columns. The
  // columns were dropped in the legacy-column retirement; the flags are derived.
  ownerId: true,
} as const;

/**
 * Select fields for detail queries (includes all editable fields).
 * Used when returning a single config with full details.
 */
export const LLM_CONFIG_DETAIL_SELECT = {
  ...LLM_CONFIG_LIST_SELECT,
  // `kind` comes through the LIST_SELECT spread (it's now surfaced in the list
  // summary too). Detail queries still rely on it for the getById kind-gate.
  advancedParameters: true,
  // Memory settings
  memoryScoreThreshold: true,
  memoryLimit: true,
  contextWindowTokens: true,
  // Context settings
  maxMessages: true,
  maxAge: true,
  maxImages: true,
} as const;

// ============================================================================
// Default values (used when creating configs)
// ============================================================================

/**
 * Default values for LLM config fields.
 * Used by both admin and user routes for consistency.
 */
export const LLM_CONFIG_DEFAULTS = {
  provider: 'openrouter',
  memoryScoreThreshold: AI_DEFAULTS.MEMORY_SCORE_THRESHOLD,
  memoryLimit: AI_DEFAULTS.MEMORY_LIMIT,
  contextWindowTokens: AI_DEFAULTS.CONTEXT_WINDOW_TOKENS,
  maxMessages: MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
  maxImages: MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
} as const;

// ============================================================================
// Response Schemas (existing - kept for backward compatibility)
// ============================================================================

/**
 * Summary of an LLM configuration.
 *
 * `id` is validated as an RFC 4122 UUID at the gateway's response
 * boundary so non-RFC values are rejected here rather than propagating
 * to autocomplete and failing opaquely at write time against
 * `SetDefaultConfigSchema`. Postgres's `uuid` type accepts any
 * hex-formatted 36-char string (including non-RFC variant bits); Zod's
 * `.uuid()` is stricter. Keeping the two contracts aligned at this
 * boundary prevents the "DB accepts, gateway rejects, user stuck"
 * failure class.
 */
// The LIST shape: the lean projection the gateway emits for `GET /…/llm-config`
// (one row per visible config). Strict (no `.passthrough()`) — list rows must
// NOT carry internal columns like `ownerId`; the gateway projects only these
// public fields via `LlmConfigService.formatConfigSummary`.
export const LlmConfigSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  /**
   * Whether the model accepts image input, sourced live from the model's
   * capabilities (OpenRouter-authoritative → z.ai catalog), NOT from the config.
   * This is the capability-driven signal the browse UI badges/filters on — it
   * supersedes reading `kind` for vision eligibility. `false` when capability is
   * unknown (fail-closed). Populated by the list route, not `formatConfigSummary`.
   */
  supportsVision: z.boolean(),
  /** Config kind discriminator (text | vision). Always present in list responses. */
  kind: z.enum(CONFIG_KINDS),
  isGlobal: z.boolean(),
  isDefault: z.boolean(),
  isFreeDefault: z.boolean(),
  isOwned: z.boolean(),
  permissions: EntityPermissionsSchema,
});

export type LlmConfigSummary = z.infer<typeof LlmConfigSummarySchema>;

// The DETAIL shape: GET-by-id / POST / PUT return the full preset the dashboard
// edits. Extends the list shape with the model-coupled context-window fields and
// the sampling/reasoning `params` object (validated by the same
// `AdvancedParamsSchema` the gateway formats it with). `contextWindowTokens` is
// required (always emitted by `formatConfigDetail`); `modelContextLength` /
// `contextWindowCap` are present only when the OpenRouter model lookup resolves,
// so they're optional. Strict, like the summary — the gateway's extra
// memory/context-history columns are intentionally not part of this contract.
export const LlmConfigDetailSchema = LlmConfigSummarySchema.omit({
  // `supportsVision` is a list-browse display aid populated by the list route;
  // the detail/dashboard path doesn't carry it yet (add when the dashboard
  // wants a vision badge). Omitted so detail handlers needn't compute it.
  supportsVision: true,
  // `isDefault`/`isFreeDefault` are pointer-relationship flags (which config the
  // AdminSettings global/free pointers target), NOT properties of the config
  // entity. The list summary carries them (derived from the pointers) for the
  // ⭐/🆓 browse badges; the canonical detail representation intentionally does
  // not — nothing reads them off the detail, and deriving them would cost a
  // pointer fetch per detail GET. See S4a.
  isDefault: true,
  isFreeDefault: true,
}).extend({
  contextWindowTokens: z.number().int(),
  modelContextLength: z.number().int().optional(),
  contextWindowCap: z.number().int().optional(),
  // True when the model is a z.ai-only coding-plan model (absent from OpenRouter)
  // AND the viewing user has no active z.ai-coding key — the preset can't run for
  // them without one. Drives the dashboard "requires z.ai key" badge; see
  // api-gateway `computeRequiresZaiKey`. `.optional()` because only the
  // user-facing GET/create/update routes emit it (always — as `false` when the
  // badge doesn't apply); the owner-only admin routes intentionally omit it (the
  // owner provisions the keys, so the badge has no audience there).
  requiresZaiKey: z.boolean().optional(),
  params: AdvancedParamsSchema,
});

export type LlmConfigDetail = z.infer<typeof LlmConfigDetailSchema>;

// ============================================================================
// GET /user/llm-config
// Returns list of visible configs (global + user-owned)
// ============================================================================

export const ListLlmConfigsResponseSchema = z.object({
  configs: z.array(LlmConfigSummarySchema),
});

export type ListLlmConfigsResponse = z.infer<typeof ListLlmConfigsResponseSchema>;

// ============================================================================
// POST /user/llm-config
// Creates a new user-owned config
// ============================================================================

export const CreateLlmConfigResponseSchema = z.object({
  config: LlmConfigDetailSchema,
});

export type CreateLlmConfigResponse = z.infer<typeof CreateLlmConfigResponseSchema>;

// ============================================================================
// DELETE /user/llm-config/:id
// Deletes a user-owned config
// ============================================================================

export const DeleteLlmConfigResponseSchema = z.object({
  deleted: z.literal(true),
});

export type DeleteLlmConfigResponse = z.infer<typeof DeleteLlmConfigResponseSchema>;

// ============================================================================
// GET /admin/llm-config/:id and GET /user/llm-config/:id
// Returns a single config (admin: global; user: ownership-checked).
// ============================================================================

export const GetLlmConfigResponseSchema = z.object({
  config: LlmConfigDetailSchema,
});

// ============================================================================
// PUT /admin/llm-config/:id and PUT /user/llm-config/:id
// Updates a config; returns the post-update shape.
// ============================================================================

export const UpdateLlmConfigResponseSchema = z.object({
  config: LlmConfigDetailSchema,
});

// ============================================================================
// PUT /admin/llm-config/:id/set-default
// PUT /admin/llm-config/:id/set-free-default
// Promotes a global config to the paid / free default. The configName field
// echoes what was promoted so the bot-client can render a confirmation.
// ============================================================================

export const SetDefaultLlmConfigResponseSchema = z.object({
  success: z.literal(true),
  configName: z.string(),
});

export type SetDefaultLlmConfigResponse = z.infer<typeof SetDefaultLlmConfigResponseSchema>;

// ============================================================================
// POST /user/llm-config/resolve
// Resolves the effective LLM config for a user+personality combination.
// Body: { personalityId, personalityConfig: LoadedPersonality, channelId? }
// Response shape is the runtime ConfigResolutionResult interface in
// services/LlmConfigResolver.ts (`{ config: ResolvedLlmConfig, source, overrides? }`).
// ResolvedLlmConfig spans the union of ConvertedLlmParams (sampling / reasoning
// JSONB-derived params) and DB columns — too broad to mirror precisely without
// drift risk, so passthrough captures known top-level fields while accepting
// extras. The known fields are what bot-client's PersonalityChatManager reads.
// ============================================================================

export const ResolveLlmConfigInputSchema = z.object({
  personalityId: z.string().min(1),
  // Mirrors the server-side `resolveConfigBodySchema` in llmConfigResolve.ts:
  // we require the three fields the handler always reads (`id`, `name`, `model`)
  // and `.passthrough()` the rest of the LoadedPersonality envelope. This catches
  // an obviously-malformed payload at the schema boundary while leaving the full
  // LoadedPersonality field list to the TS type rather than mirroring it in Zod
  // (which would invite drift). Keep this in sync with the server schema.
  personalityConfig: z
    .object({
      id: z.string(),
      name: z.string(),
      model: z.string(),
    })
    .passthrough(),
  channelId: z.string().optional(),
});

export const ResolveLlmConfigResponseSchema = z
  .object({
    config: z
      .object({
        model: z.string(),
        maxMessages: z.number().int().optional(),
        maxAge: z.number().int().nullable().optional(),
        maxImages: z.number().int().optional(),
      })
      .passthrough(),
    source: z.string(),
    overrides: z.unknown().optional(),
  })
  .passthrough();
