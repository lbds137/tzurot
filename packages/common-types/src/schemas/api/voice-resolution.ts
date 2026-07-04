/**
 * Zod schemas for /user/voice-resolution API endpoint
 *
 * Aggregate read endpoint backing the /voice view dashboard. One round-trip
 * returns the resolved TTS provider, resolved STT provider, AND a
 * cloned-voice summary — saving the dashboard from making three separate
 * gateway calls.
 *
 * Resolution data includes the `source` layer (e.g., 'user-personality',
 * 'tts-derived', 'admin-default') so the dashboard can display "Mistral
 * (derived from your TTS)" rather than just "Mistral".
 */

import { z } from 'zod';
import { STT_PROVIDERS, STT_RESOLUTION_SOURCES } from '../../types/sttProvider.js';

// Re-export the canonical type so existing import sites
// (`@tzurot/common-types` namespace) keep working without churn.
export type { SttResolutionSource } from '../../types/sttProvider.js';

const SttProviderSchema = z.enum(STT_PROVIDERS);

/** Zod runtime schema mirroring the SttResolutionSource type tuple. */
export const SttResolutionSourceSchema = z.enum(STT_RESOLUTION_SOURCES);

/** Source layer for TTS resolution. Mirrors `ConfigResolutionSource` in
 *  BaseConfigResolver, but listed inline for the dashboard's consumption. */
export const TtsResolutionSourceSchema = z.enum([
  'user-personality',
  'user-default',
  'personality',
  'free-default',
  'hardcoded',
]);

export type TtsResolutionSource = z.infer<typeof TtsResolutionSourceSchema>;

/** Resolved TTS view for one personality. */
export const ResolvedTtsViewSchema = z.object({
  configId: z.string().nullable(),
  configName: z.string().nullable(),
  provider: z.string(), // not narrowed to SttProvider — TTS may report 'self-hosted' etc.
  source: TtsResolutionSourceSchema,
});

export type ResolvedTtsView = z.infer<typeof ResolvedTtsViewSchema>;

/** Resolved STT view for one personality. */
export const ResolvedSttViewSchema = z.object({
  provider: SttProviderSchema,
  source: SttResolutionSourceSchema,
});

export type ResolvedSttView = z.infer<typeof ResolvedSttViewSchema>;

/** Cloned-voice summary (truncated preview, not full list). */
export const ClonedVoicesSummarySchema = z.object({
  /** Tzurot-prefixed voices count (matches the /user/voices `tzurotCount` field). */
  tzurotCount: z.number().int().min(0),
  /** Total voices across all providers. */
  totalVoices: z.number().int().min(0),
  /** First few voice slugs for inline display. Capped at ~5 by the route. */
  previewSlugs: z.array(z.string()),
});

export type ClonedVoicesSummary = z.infer<typeof ClonedVoicesSummarySchema>;

// ============================================================================
// GET /user/voice-resolution?personalityId=X
// ============================================================================

export const GetVoiceResolutionResponseSchema = z.object({
  /** Display name of the resolved character. Surfaces in the dashboard
   *  title so the view reads as character-scoped instead of looking like
   *  global settings. */
  personalityName: z.string(),
  tts: ResolvedTtsViewSchema,
  stt: ResolvedSttViewSchema,
  voices: ClonedVoicesSummarySchema,
});

export type GetVoiceResolutionResponse = z.infer<typeof GetVoiceResolutionResponseSchema>;

// ============================================================================
// Query input
// ============================================================================

export const GetVoiceResolutionQuerySchema = z.object({
  personalityId: z.string().uuid('Invalid personalityId format'),
});
