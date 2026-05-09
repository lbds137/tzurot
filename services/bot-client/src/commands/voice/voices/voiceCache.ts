/**
 * Voice Autocomplete Cache
 *
 * Shared TTLCache for voice autocomplete data. Both delete.ts (primary consumer)
 * and clear.ts (invalidation after bulk delete) use this module, avoiding
 * sibling coupling between the two command handlers.
 */

import { TTLCache } from '@tzurot/common-types';
import type { VoiceEntry } from './types.js';

/** Cache voice lists per user to avoid hitting ElevenLabs API on every autocomplete keystroke */
const voiceCache = new TTLCache<VoiceEntry[]>({ ttl: 30_000, maxSize: 100 });

/** Get cached voice list for a user. Returns null on cache miss. */
export function getCachedVoices(userId: string): VoiceEntry[] | null {
  return voiceCache.get(userId);
}

/** Cache a voice list for a user. */
export function setCachedVoices(userId: string, voices: VoiceEntry[]): void {
  voiceCache.set(userId, voices);
}

/** Invalidate a user's cached voice list (e.g., after delete or bulk clear). */
export function invalidateVoiceCache(userId: string): void {
  voiceCache.delete(userId);
}

/**
 * Clear the entire voice autocomplete cache.
 * @internal For testing only
 */
export function _clearVoiceCacheForTesting(): void {
  voiceCache.clear();
}
