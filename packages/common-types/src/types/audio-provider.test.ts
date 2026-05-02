import { describe, it, expect } from 'vitest';
import { isAudioProviderId } from './audio-provider.js';

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
});
