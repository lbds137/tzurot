import { describe, it, expect } from 'vitest';
import {
  GetVoiceResolutionResponseSchema,
  SttResolutionSourceSchema,
  TtsResolutionSourceSchema,
  ClonedVoicesSummarySchema,
  ResolvedSttViewSchema,
  ResolvedTtsViewSchema,
  VoiceResponseModeViewSchema,
} from './voice-resolution.js';

describe('voice-resolution schemas', () => {
  describe('SttResolutionSourceSchema', () => {
    it('accepts the 3 cascade source values', () => {
      for (const s of ['user-default', 'tts-derived', 'hardcoded']) {
        expect(SttResolutionSourceSchema.parse(s)).toBe(s);
      }
    });

    it('rejects unknown source values', () => {
      expect(() => SttResolutionSourceSchema.parse('personality')).toThrow();
      // Per-personality + admin-default layers were removed when STT collapsed
      // to a speaker-bound cascade; their string values are no longer valid.
      expect(() => SttResolutionSourceSchema.parse('user-personality')).toThrow();
      expect(() => SttResolutionSourceSchema.parse('admin-default')).toThrow();
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
        personalityName: 'Test Character',
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
        voiceEnabled: false,
        voiceResponseMode: {
          value: 'always',
          source: 'hardcoded',
        },
      });
      expect(parsed.stt.source).toBe('tts-derived');
      expect(parsed.voiceEnabled).toBe(false);
      expect(parsed.voiceResponseMode).toEqual({ value: 'always', source: 'hardcoded' });
    });

    it('rejects a payload missing voiceEnabled or voiceResponseMode', () => {
      const base = {
        personalityName: 'Test Character',
        tts: {
          configId: null,
          configName: null,
          provider: 'self-hosted',
          source: 'hardcoded',
        },
        stt: { provider: 'voice-engine', source: 'hardcoded' },
        voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
      };
      expect(() => GetVoiceResolutionResponseSchema.parse(base)).toThrow();
      expect(() =>
        GetVoiceResolutionResponseSchema.parse({ ...base, voiceEnabled: true })
      ).toThrow();
    });

    it('rejects an unknown voiceResponseMode source tier', () => {
      expect(() =>
        GetVoiceResolutionResponseSchema.parse({
          personalityName: 'Test Character',
          voiceEnabled: true,
          voiceResponseMode: { value: 'always', source: 'tts-derived' },
          tts: {
            configId: null,
            configName: null,
            provider: 'self-hosted',
            source: 'hardcoded',
          },
          stt: { provider: 'voice-engine', source: 'hardcoded' },
          voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
        })
      ).toThrow();
    });

    it('rejects an unknown voiceResponseMode value', () => {
      expect(() =>
        GetVoiceResolutionResponseSchema.parse({
          personalityName: 'Test Character',
          voiceEnabled: true,
          voiceResponseMode: { value: 'sometimes', source: 'hardcoded' },
          tts: {
            configId: null,
            configName: null,
            provider: 'self-hosted',
            source: 'hardcoded',
          },
          stt: { provider: 'voice-engine', source: 'hardcoded' },
          voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
        })
      ).toThrow();
    });
  });
});

describe('VoiceResponseModeViewSchema', () => {
  it('accepts a value with its cascade source', () => {
    const view = { value: 'voice-only', source: 'user-personality' };
    expect(VoiceResponseModeViewSchema.parse(view)).toEqual(view);
  });

  it.each(['always', 'voice-only', 'never'])('accepts mode %s', value => {
    expect(VoiceResponseModeViewSchema.safeParse({ value, source: 'hardcoded' }).success).toBe(
      true
    );
  });

  it('rejects an unknown mode', () => {
    expect(
      VoiceResponseModeViewSchema.safeParse({ value: 'sometimes', source: 'hardcoded' }).success
    ).toBe(false);
  });

  it('rejects an unknown source', () => {
    expect(
      VoiceResponseModeViewSchema.safeParse({ value: 'always', source: 'tts-derived' }).success
    ).toBe(false);
  });

  it('rejects a missing source', () => {
    expect(VoiceResponseModeViewSchema.safeParse({ value: 'always' }).success).toBe(false);
  });
});
