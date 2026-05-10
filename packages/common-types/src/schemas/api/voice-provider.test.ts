import { describe, it, expect } from 'vitest';
import {
  SetVoiceProviderSchema,
  GetVoiceProviderResponseSchema,
  ClearVoiceProviderResponseSchema,
  SetVoiceProviderResponseSchema,
} from './voice-provider.js';

describe('voice-provider schemas', () => {
  describe('SetVoiceProviderSchema', () => {
    it('accepts each canonical provider', () => {
      for (const provider of ['mistral', 'elevenlabs', 'voice-engine']) {
        expect(SetVoiceProviderSchema.parse({ providerId: provider }).providerId).toBe(provider);
      }
    });

    it('rejects unknown providers', () => {
      expect(() => SetVoiceProviderSchema.parse({ providerId: 'whisper' })).toThrow();
    });

    it('rejects null (use DELETE endpoint to clear, not PUT null)', () => {
      expect(() => SetVoiceProviderSchema.parse({ providerId: null })).toThrow();
    });
  });

  describe('GetVoiceProviderResponseSchema', () => {
    it('accepts null providerId for the unset case', () => {
      expect(GetVoiceProviderResponseSchema.parse({ providerId: null }).providerId).toBeNull();
    });

    it('accepts a set provider', () => {
      expect(GetVoiceProviderResponseSchema.parse({ providerId: 'mistral' }).providerId).toBe(
        'mistral'
      );
    });
  });

  describe('SetVoiceProviderResponseSchema', () => {
    it('echoes back the set provider id', () => {
      expect(SetVoiceProviderResponseSchema.parse({ providerId: 'mistral' }).providerId).toBe(
        'mistral'
      );
    });

    it('rejects unknown provider strings', () => {
      expect(() => SetVoiceProviderResponseSchema.parse({ providerId: 'whisper' })).toThrow();
    });
  });

  describe('ClearVoiceProviderResponseSchema', () => {
    it('accepts the canonical clear response', () => {
      expect(ClearVoiceProviderResponseSchema.parse({ deleted: true, wasSet: true })).toEqual({
        deleted: true,
        wasSet: true,
      });
    });

    it('accepts wasSet omitted', () => {
      expect(ClearVoiceProviderResponseSchema.parse({ deleted: true }).deleted).toBe(true);
    });
  });
});
