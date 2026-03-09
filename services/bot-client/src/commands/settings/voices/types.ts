/**
 * Shared types for voice management commands.
 * Matches the response shape from GET /user/voices gateway route.
 */

export interface VoiceEntry {
  voiceId: string;
  name: string;
  slug: string;
}

export interface VoicesListResponse {
  voices: VoiceEntry[];
  totalSlots: number;
  tzurotCount: number;
}
