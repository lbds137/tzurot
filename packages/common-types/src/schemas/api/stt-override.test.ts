import { describe, it, expect } from 'vitest';
import {
  SetSttOverrideSchema,
  SetSttDefaultProviderSchema,
  SttOverrideSummarySchema,
  ListSttOverridesResponseSchema,
  SetSttOverrideResponseSchema,
  SetSttDefaultProviderResponseSchema,
  DeleteSttOverrideResponseSchema,
  ClearSttDefaultProviderResponseSchema,
  UserDefaultSttProviderSchema,
} from './stt-override.js';

describe('stt-override schemas', () => {
  describe('SetSttOverrideSchema', () => {
    const validUuid = '00000000-0000-4000-8000-000000000000';

    it('accepts a valid (uuid, mistral) pair', () => {
      const parsed = SetSttOverrideSchema.parse({
        personalityId: validUuid,
        providerId: 'mistral',
      });
      expect(parsed.providerId).toBe('mistral');
    });

    it('accepts each canonical provider string', () => {
      for (const provider of ['mistral', 'elevenlabs', 'voice-engine']) {
        const parsed = SetSttOverrideSchema.parse({
          personalityId: validUuid,
          providerId: provider,
        });
        expect(parsed.providerId).toBe(provider);
      }
    });

    it('rejects unknown provider strings', () => {
      expect(() =>
        SetSttOverrideSchema.parse({ personalityId: validUuid, providerId: 'whisper' })
      ).toThrow();
    });

    it('rejects non-uuid personalityId', () => {
      expect(() =>
        SetSttOverrideSchema.parse({ personalityId: 'not-a-uuid', providerId: 'mistral' })
      ).toThrow();
    });
  });

  describe('SetSttDefaultProviderSchema', () => {
    it('accepts each canonical provider', () => {
      for (const provider of ['mistral', 'elevenlabs', 'voice-engine']) {
        expect(SetSttDefaultProviderSchema.parse({ providerId: provider }).providerId).toBe(
          provider
        );
      }
    });

    it('rejects unknown providers', () => {
      expect(() => SetSttDefaultProviderSchema.parse({ providerId: 'unknown' })).toThrow();
    });
  });

  describe('SttOverrideSummarySchema', () => {
    it('allows null providerId for symmetry with the DB column', () => {
      const parsed = SttOverrideSummarySchema.parse({
        personalityId: 'any-id',
        personalityName: 'Test',
        providerId: null,
      });
      expect(parsed.providerId).toBeNull();
    });
  });

  describe('ListSttOverridesResponseSchema', () => {
    it('accepts an empty array', () => {
      expect(ListSttOverridesResponseSchema.parse({ overrides: [] }).overrides).toEqual([]);
    });

    it('accepts a populated list', () => {
      const parsed = ListSttOverridesResponseSchema.parse({
        overrides: [
          { personalityId: 'p-1', personalityName: 'Alice', providerId: 'mistral' },
          { personalityId: 'p-2', personalityName: 'Bob', providerId: null },
        ],
      });
      expect(parsed.overrides).toHaveLength(2);
    });
  });

  describe('SetSttOverrideResponseSchema', () => {
    it('wraps an SttOverrideSummary under { override: ... }', () => {
      const parsed = SetSttOverrideResponseSchema.parse({
        override: { personalityId: 'p-1', personalityName: 'Alice', providerId: 'mistral' },
      });
      expect(parsed.override.providerId).toBe('mistral');
    });
  });

  describe('SetSttDefaultProviderResponseSchema', () => {
    it('wraps a default-provider summary under { default: ... }', () => {
      const parsed = SetSttDefaultProviderResponseSchema.parse({
        default: { providerId: 'voice-engine' },
      });
      expect(parsed.default.providerId).toBe('voice-engine');
    });
  });

  describe('DeleteSttOverrideResponseSchema', () => {
    it('accepts the canonical delete response', () => {
      expect(DeleteSttOverrideResponseSchema.parse({ deleted: true, wasSet: true }).deleted).toBe(
        true
      );
    });

    it('accepts wasSet omitted (idempotent no-op)', () => {
      expect(DeleteSttOverrideResponseSchema.parse({ deleted: true }).deleted).toBe(true);
    });
  });

  describe('ClearSttDefaultProviderResponseSchema', () => {
    it('accepts the canonical clear response', () => {
      expect(
        ClearSttDefaultProviderResponseSchema.parse({ deleted: true, wasSet: false }).wasSet
      ).toBe(false);
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
});
