/**
 * Tests for Voice Autocomplete Cache
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCachedVoices,
  setCachedVoices,
  invalidateVoiceCache,
  _clearVoiceCacheForTesting,
} from './voiceCache.js';
import type { VoiceEntry } from './types.js';

describe('voiceCache', () => {
  const voices: VoiceEntry[] = [
    { voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
    { voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
  ];

  beforeEach(() => {
    _clearVoiceCacheForTesting();
  });

  it('should return null on cache miss', () => {
    expect(getCachedVoices('user-123')).toBeNull();
  });

  it('should return cached voices after set', () => {
    setCachedVoices('user-123', voices);
    expect(getCachedVoices('user-123')).toEqual(voices);
  });

  it('should invalidate cache for a specific user', () => {
    setCachedVoices('user-123', voices);
    setCachedVoices('user-456', voices);

    invalidateVoiceCache('user-123');

    expect(getCachedVoices('user-123')).toBeNull();
    expect(getCachedVoices('user-456')).toEqual(voices);
  });

  it('should clear all cached entries', () => {
    setCachedVoices('user-123', voices);
    setCachedVoices('user-456', voices);

    _clearVoiceCacheForTesting();

    expect(getCachedVoices('user-123')).toBeNull();
    expect(getCachedVoices('user-456')).toBeNull();
  });
});
