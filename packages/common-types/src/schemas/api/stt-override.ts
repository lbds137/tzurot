/**
 * Zod schemas for /user/stt-override API endpoints
 *
 * STT is user-scoped (no per-personality dimension). Endpoints:
 *   GET    /user/stt-override → user's current STT preference
 *   PUT    /user/stt-override → set
 *   DELETE /user/stt-override → clear
 *
 * Cascade context (when no preference is set): transcription derives from
 * the user's default TTS provider (Mistral / ElevenLabs use the same key
 * for both audio directions), otherwise falls back to voice-engine.
 */

import { z } from 'zod';
import { STT_PROVIDERS } from '../../types/sttProvider.js';

const SttProviderSchema = z.enum(STT_PROVIDERS);

/** User's STT preference reference. */
export const UserDefaultSttProviderSchema = z.object({
  providerId: SttProviderSchema.nullable(),
});
export type UserDefaultSttProvider = z.infer<typeof UserDefaultSttProviderSchema>;

// ============================================================================
// PUT /user/stt-override
// ============================================================================

export const SetSttDefaultProviderResponseSchema = z.object({
  default: UserDefaultSttProviderSchema,
});
// ============================================================================
// DELETE /user/stt-override
// ============================================================================

export const ClearSttDefaultProviderResponseSchema = z.object({
  deleted: z.literal(true),
  /** True if a preference was actually cleared; false on idempotent no-op. */
  wasSet: z.boolean().optional(),
});
// ============================================================================
// Input schemas (request body validation)
// ============================================================================

/** Set the user's STT preference. */
export const SetSttDefaultProviderSchema = z.object({
  providerId: SttProviderSchema,
});
