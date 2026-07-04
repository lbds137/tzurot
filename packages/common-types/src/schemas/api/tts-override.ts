/**
 * Zod schemas for /user/tts-override API endpoints
 *
 * Parallel to `model-override.ts` (LLM overrides). Same shape, different
 * domain — TTS overrides act on `UserPersonalityConfig.ttsConfigId` and
 * `User.defaultTtsConfigId` instead of the LLM equivalents.
 *
 * Usage mirrors model-override:
 *   - Gateway parses request bodies via `SetTtsOverrideSchema` /
 *     `SetTtsDefaultConfigSchema` and validates response shapes against
 *     the *ResponseSchema declarations.
 *   - Bot-client imports the response types to type its `callGatewayApi`
 *     invocations.
 */

import { z } from 'zod';

// ============================================================================
// Shared sub-schemas
// ============================================================================

/** Summary of a TTS override (personality + tts-config).
 *
 *  Note: `configId` / `configName` are nullable for schema symmetry with the
 *  underlying DB (UserPersonalityConfig.ttsConfigId is `String?`), but the
 *  GET /user/tts-override list handler filters with `where: { ttsConfigId:
 *  { not: null } }`, so list responses never emit null in practice. The
 *  nullable declaration is defensive — kept to mirror model-override's
 *  shape and to type-check correctly if a future caller hands the schema
 *  a row pulled directly without the not-null filter. */
export const TtsOverrideSummarySchema = z.object({
  personalityId: z.string(),
  personalityName: z.string(),
  configId: z.string().nullable(),
  configName: z.string().nullable(),
});
export type TtsOverrideSummary = z.infer<typeof TtsOverrideSummarySchema>;

/** User's default TTS config reference. */
export const UserDefaultTtsConfigSchema = z.object({
  configId: z.string().nullable(),
  configName: z.string().nullable(),
});
export type UserDefaultTtsConfig = z.infer<typeof UserDefaultTtsConfigSchema>;

// ============================================================================
// GET /user/tts-override
// ============================================================================

export const ListTtsOverridesResponseSchema = z.object({
  overrides: z.array(TtsOverrideSummarySchema),
});
// ============================================================================
// PUT /user/tts-override
// ============================================================================

export const SetTtsOverrideResponseSchema = z.object({
  override: TtsOverrideSummarySchema,
});
// ============================================================================
// GET /user/tts-override/default
// ============================================================================

export const GetTtsDefaultConfigResponseSchema = z.object({
  default: UserDefaultTtsConfigSchema,
});
// ============================================================================
// PUT /user/tts-override/default
// ============================================================================

export const SetTtsDefaultConfigResponseSchema = z.object({
  default: UserDefaultTtsConfigSchema,
});
// ============================================================================
// DELETE /user/tts-override/default
// ============================================================================

export const ClearTtsDefaultConfigResponseSchema = z.object({
  deleted: z.literal(true),
  /** True if a default was actually cleared; false on idempotent no-op. */
  wasSet: z.boolean().optional(),
  /** System free default the user falls back to. `null` only if no admin
   *  has configured a free default (rare in practice — bot-client renders
   *  a hardcoded-fallback notice when null). */
  newEffectiveDefault: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
});
export type ClearTtsDefaultConfigResponse = z.infer<typeof ClearTtsDefaultConfigResponseSchema>;

// ============================================================================
// DELETE /user/tts-override/:personalityId
// ============================================================================

export const DeleteTtsOverrideResponseSchema = z.object({
  deleted: z.literal(true),
  /** True if an override was actually cleared; false on idempotent no-op. */
  wasSet: z.boolean().optional(),
});
// ============================================================================
// Input schemas (request body validation)
// ============================================================================

/** Set a TTS override for a personality. */
export const SetTtsOverrideSchema = z.object({
  personalityId: z.string().uuid('Invalid personalityId format'),
  configId: z.string().uuid('Invalid configId format'),
});
/** Set user's global default TTS config. */
export const SetTtsDefaultConfigSchema = z.object({
  configId: z.string().uuid('Invalid configId format'),
});
