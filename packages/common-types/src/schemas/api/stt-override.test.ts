import { describe, it, expect } from 'vitest';
import {
  SetSttDefaultProviderSchema,
  UserDefaultSttProviderSchema,
  SetSttDefaultProviderResponseSchema,
  ClearSttDefaultProviderResponseSchema,
} from './stt-override.js';

describe('stt-override schemas', () => {
  describe('SetSttDefaultProviderSchema', () => {
    it('accepts each canonical provider', () => {
      for (const provider of ['mistral', 'elevenlabs', 'voice-engine']) {
        expect(SetSttDefaultProviderSchema.parse({ providerId: provider }).providerId).toBe(
          provider
        );
      }
    });

    it('rejects unknown providers', () => {
      expect(() => SetSttDefaultProviderSchema.parse({ providerId: 'whisper' })).toThrow();
    });

    it('rejects null (use DELETE endpoint to clear, not PUT null)', () => {
      expect(() => SetSttDefaultProviderSchema.parse({ providerId: null })).toThrow();
    });
  });

  describe('UserDefaultSttProviderSchema', () => {
    it('accepts a set provider', () => {
      expect(UserDefaultSttProviderSchema.parse({ providerId: 'mistral' }).providerId).toBe(
        'mistral'
      );
    });

    it('accepts null providerId for the unset case', () => {
      expect(UserDefaultSttProviderSchema.parse({ providerId: null }).providerId).toBeNull();
    });
  });

  describe('SetSttDefaultProviderResponseSchema', () => {
    it('wraps the default provider summary under { default: ... }', () => {
      const parsed = SetSttDefaultProviderResponseSchema.parse({
        default: { providerId: 'voice-engine' },
      });
      expect(parsed.default.providerId).toBe('voice-engine');
    });
  });

  describe('ClearSttDefaultProviderResponseSchema', () => {
    it('accepts the canonical clear response', () => {
      expect(
        ClearSttDefaultProviderResponseSchema.parse({ deleted: true, wasSet: false }).wasSet
      ).toBe(false);
    });

    it('accepts wasSet omitted (idempotent no-op)', () => {
      expect(ClearSttDefaultProviderResponseSchema.parse({ deleted: true }).deleted).toBe(true);
    });
  });
});
