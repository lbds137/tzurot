import { describe, it, expect } from 'vitest';

import {
  transcribeResponseSchema,
  healthResponseSchema,
  voicesResponseSchema,
} from './voiceEngineSchemas.js';

describe('voiceEngineSchemas', () => {
  describe('transcribeResponseSchema', () => {
    it('accepts the { text } shape', () => {
      expect(transcribeResponseSchema.parse({ text: 'hello' })).toEqual({ text: 'hello' });
    });

    it('rejects a renamed/missing text field — the dangerous silent drift', () => {
      expect(() => transcribeResponseSchema.parse({ transcription: 'hello' })).toThrow();
    });

    it('ignores a backward-compatible added field (non-strict — additions must not break the client)', () => {
      expect(transcribeResponseSchema.parse({ text: 'hello', confidence: 0.9 })).toEqual({
        text: 'hello',
      });
    });
  });

  describe('healthResponseSchema', () => {
    it('accepts the full health shape', () => {
      const h = { status: 'ok', asr_loaded: true, tts_loaded: false, voices_loaded: 2 };
      expect(healthResponseSchema.parse(h)).toEqual(h);
    });

    it('rejects a non-boolean asr_loaded (type drift)', () => {
      expect(() =>
        healthResponseSchema.parse({
          status: 'ok',
          asr_loaded: 'yes',
          tts_loaded: true,
          voices_loaded: 0,
        })
      ).toThrow();
    });
  });

  describe('voicesResponseSchema', () => {
    it('accepts a populated voices list with the { id, type } item shape', () => {
      const v = { voices: [{ id: 'alba', type: 'cached' }] };
      expect(voicesResponseSchema.parse(v)).toEqual(v);
    });

    it('accepts an empty voices list', () => {
      expect(voicesResponseSchema.parse({ voices: [] })).toEqual({ voices: [] });
    });

    it('rejects a voice item missing its id', () => {
      expect(() => voicesResponseSchema.parse({ voices: [{ type: 'cached' }] })).toThrow();
    });
  });
});
