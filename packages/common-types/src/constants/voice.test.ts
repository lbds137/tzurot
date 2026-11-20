import { describe, it, expect } from 'vitest';
import { VOICE_RESPONSE_MODES } from './voice.js';

describe('VOICE_RESPONSE_MODES', () => {
  it('carries exactly the three modes in /voice replies choice order', () => {
    expect([...VOICE_RESPONSE_MODES]).toEqual(['always', 'voice-only', 'never']);
  });
});
