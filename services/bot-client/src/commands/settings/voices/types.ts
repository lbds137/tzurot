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

import type { AudioProviderId } from '@tzurot/common-types';

export interface VoiceEntry {
  provider: AudioProviderId;
  voiceId: string;
  name: string;
  slug: string;
}

export interface VoicesListResponse {
  voices: VoiceEntry[];
  totalVoices: number;
  tzurotCount: number;
}
