/**
 * Tests for generation schema bounds.
 *
 * Pins the bounded fields on `llmGenerationResultSchema.metadata` so a
 * future PR adjusting the caps gets a failing test instead of a silent
 * semantic shift. Today we cover the pieces that have explicit max() /
 * enum() constraints; if more bounds land, add cases here.
 */

import { describe, it, expect } from 'vitest';
import { TTS_PROVIDER_IDS } from '../../services/tts/TtsProvider.js';
import { CONFIG_SOURCE_IDS, llmGenerationResultSchema } from './generation.js';

const baseValid = {
  requestId: 'req-1',
  success: true,
  content: 'hello world',
};

describe('llmGenerationResultSchema.metadata', () => {
  describe('ttsNotices bounds', () => {
    it('accepts a notice exactly at the 500-char per-element max', () => {
      const longest = 'x'.repeat(500);
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: { ttsNotices: [longest] },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects a notice that exceeds the 500-char per-element max by one', () => {
      const tooLong = 'x'.repeat(501);
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: { ttsNotices: [tooLong] },
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts an array exactly at the 10-element max', () => {
      const ten = Array.from({ length: 10 }, (_, i) => `notice ${i}`);
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: { ttsNotices: ten },
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects an array that exceeds the 10-element max by one', () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `notice ${i}`);
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: { ttsNotices: eleven },
      });
      expect(parsed.success).toBe(false);
    });

    it('accepts an absent ttsNotices field (optional)', () => {
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: {},
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('ttsProviderUsed enum', () => {
    it('accepts each TTS_PROVIDER_IDS value', () => {
      // Iterate the shared constant rather than hardcoding the list, so a
      // future provider added to TTS_PROVIDER_IDS is automatically covered.
      // Hardcoding the literals would let the test name lie if drift occurs.
      for (const provider of TTS_PROVIDER_IDS) {
        const parsed = llmGenerationResultSchema.safeParse({
          ...baseValid,
          metadata: { ttsProviderUsed: provider },
        });
        expect(parsed.success).toBe(true);
      }
    });

    it('rejects an unknown provider id', () => {
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: { ttsProviderUsed: 'azure' },
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('configSource enum', () => {
    it('accepts each CONFIG_SOURCE_IDS value', () => {
      // Iterate the shared constant for the same reason as ttsProviderUsed
      // above — hardcoding would let a new cascade layer slip into the schema
      // without the positive-coverage assertion picking it up.
      for (const source of CONFIG_SOURCE_IDS) {
        const parsed = llmGenerationResultSchema.safeParse({
          ...baseValid,
          metadata: { configSource: source },
        });
        expect(parsed.success).toBe(true);
      }
    });

    it('rejects an undocumented configSource value', () => {
      const parsed = llmGenerationResultSchema.safeParse({
        ...baseValid,
        metadata: { configSource: 'admin' },
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('metadata as a whole', () => {
    it('accepts a payload with no metadata key at all (entire object optional)', () => {
      // metadata itself is .optional() on the schema; pin that explicitly so
      // a future tightening (e.g., switching to .default({})) is surfaced
      // instead of silently breaking callers that omit the key.
      const parsed = llmGenerationResultSchema.safeParse(baseValid);
      expect(parsed.success).toBe(true);
    });
  });
});
