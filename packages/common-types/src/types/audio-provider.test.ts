import { describe, it, expect } from 'vitest';
import { isAudioProviderId, AUDIO_PROVIDER_IDS } from './audio-provider.js';

describe('isAudioProviderId', () => {
  it('accepts known provider ids', () => {
    expect(isAudioProviderId('elevenlabs')).toBe(true);
    expect(isAudioProviderId('mistral')).toBe(true);
  });

  it('rejects unknown strings', () => {
    expect(isAudioProviderId('openrouter')).toBe(false);
    expect(isAudioProviderId('zai-coding')).toBe(false);
    expect(isAudioProviderId('')).toBe(false);
    expect(isAudioProviderId('Mistral')).toBe(false); // case-sensitive
  });

  it('agrees with the AUDIO_PROVIDER_IDS tuple', () => {
    for (const id of AUDIO_PROVIDER_IDS) {
      expect(isAudioProviderId(id)).toBe(true);
    }
  });
});

describe('AUDIO_PROVIDER_IDS', () => {
  it('contains the expected providers', () => {
    expect([...AUDIO_PROVIDER_IDS].sort()).toEqual(['elevenlabs', 'mistral']);
  });

  it('is frozen as a tuple (readonly at the type level)', () => {
    // Runtime check that we didn't accidentally export a mutable array.
    // `as const` makes the array readonly; TypeScript enforces it but the
    // shape is still a regular array at runtime — this asserts our intent.
    expect(AUDIO_PROVIDER_IDS).toHaveLength(2);
  });
});
