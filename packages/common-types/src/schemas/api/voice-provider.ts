/**
 * Zod schemas for /user/voice-provider API endpoints
 *
 * Exposes the foundational `User.defaultProvider` field set by
 * `/voice provider set`. SttResolver reads this as Layer 4 (admin-default)
 * of the STT cascade. Conceptually the "provider preference baseline"
 * that surgical TTS / STT overrides layer above.
 */

import { z } from 'zod';
import { STT_PROVIDERS } from '../../types/sttProvider.js';

const SttProviderSchema = z.enum(STT_PROVIDERS);

// ============================================================================
// GET /user/voice-provider
// ============================================================================

export const GetVoiceProviderResponseSchema = z.object({
  providerId: SttProviderSchema.nullable(),
});
export type GetVoiceProviderResponse = z.infer<typeof GetVoiceProviderResponseSchema>;

// ============================================================================
// PUT /user/voice-provider
// ============================================================================

export const SetVoiceProviderResponseSchema = z.object({
  providerId: SttProviderSchema,
});
export type SetVoiceProviderResponse = z.infer<typeof SetVoiceProviderResponseSchema>;

// ============================================================================
// DELETE /user/voice-provider
// ============================================================================

export const ClearVoiceProviderResponseSchema = z.object({
  deleted: z.literal(true),
  /** True if a default was actually cleared; false on idempotent no-op. */
  wasSet: z.boolean().optional(),
});
export type ClearVoiceProviderResponse = z.infer<typeof ClearVoiceProviderResponseSchema>;

// ============================================================================
// Input schemas
// ============================================================================

export const SetVoiceProviderSchema = z.object({
  providerId: SttProviderSchema,
});
export type SetVoiceProviderInput = z.infer<typeof SetVoiceProviderSchema>;
