/**
 * Zod schemas for /user/model-override API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';
import { CONFIG_KINDS } from '../../constants/ai.js';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/**
 * Summary of a model override (personality + config)
 */
export const ModelOverrideSummarySchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  configId: z.string().nullable(),
  configName: z.string().nullable(),
  /**
   * Config kind of the override (text | vision). Nullable to match `configId`:
   * null when there's no override; set when one exists. The all-kinds list emits
   * one row per kind, so browse can badge + carry the kind through clear.
   */
  kind: z.enum(CONFIG_KINDS).nullable(),
  /**
   * Whether the override's config MODEL supports vision — sourced live from the
   * model's capabilities (OpenRouter-authoritative → z.ai catalog), NOT from
   * `kind`. This is the capability-driven signal the override-browse 👁 badge
   * uses (mirrors `LlmConfigSummary.supportsVision`). `false` when capability is
   * unknown (fail-closed). Populated by the override-list route, not the schema.
   */
  supportsVision: z.boolean(),
});

export type ModelOverrideSummary = z.infer<typeof ModelOverrideSummarySchema>;

/** User's default LLM config reference */
export const UserDefaultConfigSchema = z.object({
  configId: z.string().nullable(),
  configName: z.string().nullable(),
});

export type UserDefaultConfig = z.infer<typeof UserDefaultConfigSchema>;

// ============================================================================
// GET /user/model-override
// Returns list of user's model overrides
// ============================================================================

export const ListModelOverridesResponseSchema = z.object({
  overrides: z.array(ModelOverrideSummarySchema),
});

export type ListModelOverridesResponse = z.infer<typeof ListModelOverridesResponseSchema>;

// ============================================================================
// PUT /user/model-override
// Sets a model override for a personality
// ============================================================================

export const SetModelOverrideResponseSchema = z.object({
  override: ModelOverrideSummarySchema,
});

export type SetModelOverrideResponse = z.infer<typeof SetModelOverrideResponseSchema>;

// ============================================================================
// PUT /user/model-override/default
// Sets user's global default LLM config
// ============================================================================

export const SetDefaultConfigResponseSchema = z.object({
  default: UserDefaultConfigSchema,
});

export type SetDefaultConfigResponse = z.infer<typeof SetDefaultConfigResponseSchema>;

// ============================================================================
// DELETE /user/model-override/default
// Clears user's global default LLM config
// ============================================================================

/** A resolved free-default config the user falls back to for one slot. */
const FreeDefaultRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const ClearDefaultConfigResponseSchema = z.object({
  deleted: z.literal(true),
  /** Whether a default was actually set before this call (idempotent vs. real clear). */
  wasSet: z.boolean().optional(),
  /** System free defaults the user falls back to, keyed by the slot(s) THIS call
   *  cleared. A key is present iff that slot was cleared; its value is the free
   *  default config for that slot, or `null` when no admin free default exists for
   *  it (bot-client renders a built-in-fallback notice). An `all` clear populates
   *  BOTH keys (so the confirmation names both fallbacks, not just chat); a
   *  single-slot clear populates just the one. */
  newEffectiveDefaults: z.object({
    text: FreeDefaultRefSchema.nullable().optional(),
    vision: FreeDefaultRefSchema.nullable().optional(),
  }),
});

export type ClearDefaultConfigResponse = z.infer<typeof ClearDefaultConfigResponseSchema>;

// ============================================================================
// DELETE /user/model-override/:personalityId
// Removes a model override for a personality
// ============================================================================

export const DeleteModelOverrideResponseSchema = z.object({
  deleted: z.literal(true),
  /** `true` when an override existed and was deleted; `false` on idempotent
   *  no-op (no override to delete). Optional on the schema for forward-compat
   *  with hypothetical older clients — current handlers always emit it. */
  wasSet: z.boolean().optional(),
});

export type DeleteModelOverrideResponse = z.infer<typeof DeleteModelOverrideResponseSchema>;

// ============================================================================
// Input Schemas (request body validation)
// ============================================================================

/**
 * Schema for setting a model override for a personality.
 */
export const SetModelOverrideSchema = z.object({
  personalityId: z.string().uuid('Invalid personalityId format'),
  configId: z.string().uuid('Invalid configId format'),
});

/**
 * Schema for setting user's global default LLM config.
 */
export const SetDefaultConfigSchema = z.object({
  configId: z.string().uuid('Invalid configId format'),
});
