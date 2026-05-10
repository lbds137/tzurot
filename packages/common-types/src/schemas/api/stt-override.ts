/**
 * Zod schemas for /user/stt-override API endpoints
 *
 * Parallel to `tts-override.ts`. STT overrides resolve a provider choice
 * (string enum) rather than a config-row UUID, so the validation shape
 * differs slightly: `providerId` is enforced against the SttProvider enum
 * instead of a UUID format.
 *
 * Cascade context (the columns these endpoints write):
 *   PUT /user/stt-override                 → UserPersonalityConfig.sttProviderId  (Layer 1)
 *   PUT /user/stt-override/default         → User.defaultSttProviderId            (Layer 2)
 *   DELETE /user/stt-override/:personalityId → clears Layer 1 for that personality
 *   DELETE /user/stt-override/default      → clears Layer 2
 */

import { z } from 'zod';
import { STT_PROVIDERS } from '../../types/sttProvider.js';

// ============================================================================
// Shared sub-schemas
// ============================================================================

const SttProviderSchema = z.enum(STT_PROVIDERS);

/** Summary of a per-personality STT override. */
export const SttOverrideSummarySchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  providerId: SttProviderSchema.nullable(),
});
export type SttOverrideSummary = z.infer<typeof SttOverrideSummarySchema>;

/** User's default STT provider reference. */
export const UserDefaultSttProviderSchema = z.object({
  providerId: SttProviderSchema.nullable(),
});
export type UserDefaultSttProvider = z.infer<typeof UserDefaultSttProviderSchema>;

// ============================================================================
// GET /user/stt-override
// ============================================================================

export const ListSttOverridesResponseSchema = z.object({
  overrides: z.array(SttOverrideSummarySchema),
});
export type ListSttOverridesResponse = z.infer<typeof ListSttOverridesResponseSchema>;

// ============================================================================
// PUT /user/stt-override
// ============================================================================

export const SetSttOverrideResponseSchema = z.object({
  override: SttOverrideSummarySchema,
});
export type SetSttOverrideResponse = z.infer<typeof SetSttOverrideResponseSchema>;

// ============================================================================
// PUT /user/stt-override/default
// ============================================================================

export const SetSttDefaultProviderResponseSchema = z.object({
  default: UserDefaultSttProviderSchema,
});
export type SetSttDefaultProviderResponse = z.infer<typeof SetSttDefaultProviderResponseSchema>;

// ============================================================================
// DELETE /user/stt-override/default
// ============================================================================

export const ClearSttDefaultProviderResponseSchema = z.object({
  deleted: z.literal(true),
  /** True if a default was actually cleared; false on idempotent no-op. */
  wasSet: z.boolean().optional(),
});
export type ClearSttDefaultProviderResponse = z.infer<typeof ClearSttDefaultProviderResponseSchema>;

// ============================================================================
// DELETE /user/stt-override/:personalityId
// ============================================================================

export const DeleteSttOverrideResponseSchema = z.object({
  deleted: z.literal(true),
  wasSet: z.boolean().optional(),
});
export type DeleteSttOverrideResponse = z.infer<typeof DeleteSttOverrideResponseSchema>;

// ============================================================================
// Input schemas (request body validation)
// ============================================================================

/** Set an STT override for a personality. */
export const SetSttOverrideSchema = z.object({
  personalityId: z.string().uuid('Invalid personalityId format'),
  providerId: SttProviderSchema,
});
export type SetSttOverrideInput = z.infer<typeof SetSttOverrideSchema>;

/** Set user's global default STT provider. */
export const SetSttDefaultProviderSchema = z.object({
  providerId: SttProviderSchema,
});
export type SetSttDefaultProviderInput = z.infer<typeof SetSttDefaultProviderSchema>;
