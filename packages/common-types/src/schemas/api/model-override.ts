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

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/**
 * Summary of a model override (personality + config)
 * Note: ModelOverrideSummary type is exported from types/byok.ts
 * This schema validates the same shape.
 */
const ModelOverrideSummarySchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  configId: z.string().nullable(),
  configName: z.string().nullable(),
});

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

export const ClearDefaultConfigResponseSchema = z.object({
  deleted: z.literal(true),
});
export type ClearDefaultConfigResponse = z.infer<typeof ClearDefaultConfigResponseSchema>;

// ============================================================================
// DELETE /user/model-override/:personalityId
// Removes a model override for a personality
// ============================================================================

export const DeleteModelOverrideResponseSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteModelOverrideResponse = z.infer<typeof DeleteModelOverrideResponseSchema>;
