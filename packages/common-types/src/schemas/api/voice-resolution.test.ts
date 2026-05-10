import { describe, it, expect } from 'vitest';
import {
  GetVoiceResolutionResponseSchema,
  GetVoiceResolutionQuerySchema,
  SttResolutionSourceSchema,
  TtsResolutionSourceSchema,
  ClonedVoicesSummarySchema,
  ResolvedSttViewSchema,
  ResolvedTtsViewSchema,
} from './voice-resolution.js';

describe('voice-resolution schemas', () => {
  describe('SttResolutionSourceSchema', () => {
    it('accepts the 5 cascade source values', () => {
      for (const s of [
        'user-personality',
        'user-default',
        'tts-derived',
        'admin-default',
        'hardcoded',
      ]) {
        expect(SttResolutionSourceSchema.parse(s)).toBe(s);
      }
    });

    it('rejects unknown source values', () => {
      expect(() => SttResolutionSourceSchema.parse('personality')).toThrow();
    });
  });

  describe('TtsResolutionSourceSchema', () => {
    it('accepts the 5 TTS cascade source values', () => {
      for (const s of [
        'user-personality',
        'user-default',
        'personality',
        'free-default',
        'hardcoded',
      ]) {
        expect(TtsResolutionSourceSchema.parse(s)).toBe(s);
      }
    });

    it('rejects values not in the TTS cascade (e.g. tts-derived is STT-only)', () => {
      expect(() => TtsResolutionSourceSchema.parse('tts-derived')).toThrow();
      expect(() => TtsResolutionSourceSchema.parse('admin-default')).toThrow();
    });
  });

  describe('ClonedVoicesSummarySchema', () => {
    it('accepts a minimal empty summary', () => {
      expect(
        ClonedVoicesSummarySchema.parse({
          tzurotCount: 0,
          totalVoices: 0,
          previewSlugs: [],
        }).tzurotCount
      ).toBe(0);
    });

    it('rejects negative counts', () => {
      expect(() =>
        ClonedVoicesSummarySchema.parse({
          tzurotCount: -1,
          totalVoices: 0,
          previewSlugs: [],
        })
      ).toThrow();
    });
  });

  describe('ResolvedSttViewSchema', () => {
    it('parses a fully-set STT resolution view', () => {
      const parsed = ResolvedSttViewSchema.parse({
        provider: 'mistral',
        source: 'tts-derived',
      });
      expect(parsed.provider).toBe('mistral');
      expect(parsed.source).toBe('tts-derived');
    });

    it('rejects an unknown provider string', () => {
      expect(() =>
        ResolvedSttViewSchema.parse({ provider: 'whisper', source: 'hardcoded' })
      ).toThrow();
    });

    it('rejects an unknown source value', () => {
      expect(() =>
        ResolvedSttViewSchema.parse({ provider: 'mistral', source: 'free-default' })
      ).toThrow();
    });
  });

  describe('ResolvedTtsViewSchema', () => {
    it('parses a fully-set TTS resolution view', () => {
      const parsed = ResolvedTtsViewSchema.parse({
        configId: '00000000-0000-4000-8000-000000000000',
        configName: 'mistral-default',
        provider: 'mistral',
        source: 'user-default',
      });
      expect(parsed.configName).toBe('mistral-default');
    });

    it('accepts null configId/configName when no row resolved', () => {
      const parsed = ResolvedTtsViewSchema.parse({
        configId: null,
        configName: null,
        provider: 'self-hosted',
        source: 'hardcoded',
      });
      expect(parsed.configId).toBeNull();
    });
  });

  describe('GetVoiceResolutionResponseSchema', () => {
    it('parses a complete dashboard payload', () => {
      const parsed = GetVoiceResolutionResponseSchema.parse({
        tts: {
          configId: '00000000-0000-4000-8000-000000000000',
          configName: 'mistral-default',
          provider: 'mistral',
          source: 'user-default',
        },
        stt: {
          provider: 'mistral',
          source: 'tts-derived',
        },
        voices: {
          tzurotCount: 3,
          totalVoices: 5,
          previewSlugs: ['alice', 'bob', 'carol'],
        },
      });
      expect(parsed.stt.source).toBe('tts-derived');
    });
  });

  describe('GetVoiceResolutionQuerySchema', () => {
    it('requires a uuid personalityId', () => {
      expect(() => GetVoiceResolutionQuerySchema.parse({ personalityId: 'not-a-uuid' })).toThrow();
      expect(
        GetVoiceResolutionQuerySchema.parse({
          personalityId: '00000000-0000-4000-8000-000000000000',
        }).personalityId
      ).toBeTruthy();
    });
  });
});
