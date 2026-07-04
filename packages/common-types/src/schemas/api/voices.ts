/**
 * Zod schemas for /user/voices API endpoints
 *
 * Manages user-cloned TTS voices across audio providers (ElevenLabs, Mistral).
 * All routes require a provisioned user. Voices are tzurot-prefix-filtered
 * server-side; bot-client never sees other voices on the user's provider account.
 */

import { z } from 'zod';
import { AUDIO_PROVIDER_IDS } from '../../types/audio-provider.js';

/**
 * Provider id derived from the canonical `AudioProviderId` tuple. Adding a
 * new provider in `types/audio-provider.ts` automatically updates this Zod
 * schema — no drift risk.
 */
const AudioProviderIdSchema = z.enum(AUDIO_PROVIDER_IDS);

/** A single tzurot-prefixed cloned voice, tagged with provider for routing. */
export const TaggedVoiceSchema = z.object({
  provider: AudioProviderIdSchema,
  voiceId: z.string(),
  name: z.string(),
  slug: z.string(),
});
/** Per-provider warning surfaced when one provider fails but the request succeeded. */
export const ProviderWarningSchema = z.object({
  provider: AudioProviderIdSchema,
  message: z.string(),
});
// ============================================================================
// GET /user/voices
// ============================================================================

export const ListVoicesResponseSchema = z.object({
  voices: z.array(TaggedVoiceSchema),
  totalVoices: z.number().int().nonnegative(),
  tzurotCount: z.number().int().nonnegative(),
  warnings: z.array(ProviderWarningSchema).optional(),
});
// ============================================================================
// GET /user/voices/models
// ============================================================================

export const VoiceModelSchema = z.object({
  modelId: z.string(),
  name: z.string(),
});
export const ListVoiceModelsResponseSchema = z.object({
  models: z.array(VoiceModelSchema),
});
// ============================================================================
// POST /user/voices/clear
// Always returns 200; partial failures land in `errors`.
// ============================================================================

export const ClearVoicesResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  message: z.string().optional(),
  errors: z.array(z.string()).optional(),
});
// ============================================================================
// DELETE /user/voices/:provider/:voiceId
// ============================================================================

export const DeleteVoiceResponseSchema = z.object({
  deleted: z.literal(true),
  provider: AudioProviderIdSchema,
  voiceId: z.string(),
  name: z.string(),
  slug: z.string(),
});
