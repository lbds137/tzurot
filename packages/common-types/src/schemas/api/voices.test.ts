/**
 * Voices API Contract Tests
 *
 * Validates schemas for /user/voices endpoints.
 */

import { describe, it, expect } from 'vitest';
import {
  ListVoicesResponseSchema,
  ListVoiceModelsResponseSchema,
  ClearVoicesResponseSchema,
  DeleteVoiceResponseSchema,
} from './voices.js';

describe('Voices API Contract Tests', () => {
  describe('ListVoicesResponseSchema', () => {
    it('accepts empty voices list', () => {
      const data = { voices: [], totalVoices: 0, tzurotCount: 0 };
      expect(ListVoicesResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts voices with warnings', () => {
      const data = {
        voices: [{ provider: 'elevenlabs', voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' }],
        totalVoices: 10,
        tzurotCount: 1,
        warnings: [{ provider: 'mistral', message: 'Mistral key invalid' }],
      };
      expect(ListVoicesResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects unknown provider', () => {
      const data = {
        voices: [{ provider: 'openai', voiceId: 'v1', name: 'x', slug: 'x' }],
        totalVoices: 1,
        tzurotCount: 1,
      };
      expect(ListVoicesResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects negative totalVoices', () => {
      const data = { voices: [], totalVoices: -1, tzurotCount: 0 };
      expect(ListVoicesResponseSchema.safeParse(data).success).toBe(false);
    });
  });

  describe('ListVoiceModelsResponseSchema', () => {
    it('accepts list of models', () => {
      const data = {
        models: [{ modelId: 'eleven_v2_5', name: 'Eleven Multilingual v2' }],
      };
      expect(ListVoiceModelsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts empty models list', () => {
      expect(ListVoiceModelsResponseSchema.safeParse({ models: [] }).success).toBe(true);
    });

    it('rejects missing modelId', () => {
      const data = { models: [{ name: 'X' }] };
      expect(ListVoiceModelsResponseSchema.safeParse(data).success).toBe(false);
    });
  });

  describe('ClearVoicesResponseSchema', () => {
    it('accepts no-op clear (no voices to delete)', () => {
      const data = { deleted: 0, total: 0, message: 'No Tzurot voices to clear' };
      expect(ClearVoicesResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts full success without errors field', () => {
      const data = { deleted: 5, total: 5 };
      expect(ClearVoicesResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts partial failure with errors', () => {
      const data = {
        deleted: 3,
        total: 5,
        errors: ['voice1: rate limited', 'voice2: 500'],
      };
      expect(ClearVoicesResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('DeleteVoiceResponseSchema', () => {
    it('accepts valid delete response', () => {
      const data = {
        deleted: true as const,
        provider: 'elevenlabs',
        voiceId: 'v123',
        name: 'tzurot-alice',
        slug: 'alice',
      };
      expect(DeleteVoiceResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects deleted=false (this endpoint only returns true)', () => {
      const data = {
        deleted: false,
        provider: 'elevenlabs',
        voiceId: 'v123',
        name: 'x',
        slug: 'x',
      };
      expect(DeleteVoiceResponseSchema.safeParse(data).success).toBe(false);
    });
  });
});
