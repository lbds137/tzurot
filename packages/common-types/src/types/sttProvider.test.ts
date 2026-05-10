import { describe, it, expect } from 'vitest';
import {
  isSttProvider,
  isByokAudioProvider,
  sttProviderDisplayName,
  sttProviderInfoUrl,
  STT_PROVIDERS,
  type SttProvider,
} from './sttProvider.js';

describe('SttProvider helpers', () => {
  describe('isSttProvider', () => {
    it('returns true for the three canonical providers', () => {
      expect(isSttProvider('mistral')).toBe(true);
      expect(isSttProvider('elevenlabs')).toBe(true);
      expect(isSttProvider('voice-engine')).toBe(true);
    });

    it('returns false for unknown provider strings', () => {
      expect(isSttProvider('whisper')).toBe(false);
      expect(isSttProvider('openai')).toBe(false);
      expect(isSttProvider('')).toBe(false);
      expect(isSttProvider('Mistral')).toBe(false); // case-sensitive
    });

    it('narrows the type at the boundary', () => {
      const raw: string = 'mistral';
      if (isSttProvider(raw)) {
        const provider: SttProvider = raw;
        expect(provider).toBe('mistral');
      }
    });
  });

  describe('STT_PROVIDERS', () => {
    it('contains all three canonical values', () => {
      expect([...STT_PROVIDERS].sort()).toEqual(['elevenlabs', 'mistral', 'voice-engine']);
    });
  });

  describe('isByokAudioProvider', () => {
    it('returns true for mistral and elevenlabs (one BYOK key serves both audio directions)', () => {
      expect(isByokAudioProvider('mistral')).toBe(true);
      expect(isByokAudioProvider('elevenlabs')).toBe(true);
    });

    it('returns false for voice-engine (self-hosted, no key)', () => {
      expect(isByokAudioProvider('voice-engine')).toBe(false);
    });

    it('returns false for non-audio TTS providers (e.g., self-hosted Pocket TTS)', () => {
      expect(isByokAudioProvider('self-hosted')).toBe(false);
      expect(isByokAudioProvider('whisper')).toBe(false);
    });
  });

  describe('sttProviderDisplayName', () => {
    it('returns user-readable names for each provider', () => {
      expect(sttProviderDisplayName('mistral')).toBe('Mistral');
      expect(sttProviderDisplayName('elevenlabs')).toBe('ElevenLabs');
      expect(sttProviderDisplayName('voice-engine')).toContain('Self-hosted');
    });
  });

  describe('sttProviderInfoUrl', () => {
    it('returns the canonical model-card URL for each provider', () => {
      // Pin the exact URLs so a typo in the metadata table fails here, not in
      // a downstream rendering test where the failure mode is harder to trace.
      expect(sttProviderInfoUrl('mistral')).toBe('https://mistral.ai/news/voxtral');
      expect(sttProviderInfoUrl('elevenlabs')).toBe('https://elevenlabs.io/speech-to-text');
      expect(sttProviderInfoUrl('voice-engine')).toBe(
        'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2'
      );
    });
  });
});
