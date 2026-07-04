/**
 * Shared types for voice management commands.
 * Matches the response shape from GET /user/voices gateway route.
 *
 * Each voice is tagged with the audio provider it lives in (elevenlabs or
 * mistral). Bot-client commands that act on a single voice (delete) encode
 * `${provider}:${voiceId}` as the autocomplete value so the gateway knows
 * which provider's API to talk to.
 *
 * Provider type re-uses `AudioProviderId` from common-types (single source
 * of truth) — adding a new audio provider in common-types automatically
 * surfaces compile errors at every consumer site here, instead of drifting
 * silently against a local literal-union duplicate.
 */

import type { AudioProviderId } from '@tzurot/common-types/types/audio-provider';

export interface VoiceEntry {
  provider: AudioProviderId;
  voiceId: string;
  name: string;
  slug: string;
}

/**
 * Per-provider warning surfaced when one provider's fetch failed but the
 * request as a whole succeeded. Absent (`undefined`) when all providers
 * loaded cleanly. Bot-client renders these inline above the voice list.
 */
export interface VoiceWarning {
  provider: AudioProviderId;
  message: string;
}

export interface VoicesListResponse {
  voices: VoiceEntry[];
  totalVoices: number;
  tzurotCount: number;
  warnings?: VoiceWarning[];
}
