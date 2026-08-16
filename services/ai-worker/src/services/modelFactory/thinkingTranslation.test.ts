/**
 * Tests for the provider-aware thinking-level translation table.
 *
 * These pin the per-provider WIRE shapes. The z.ai arm exists because z.ai
 * silently ignores OpenRouter's `reasoning` object rather than rejecting it,
 * so a wrong shape here is invisible at runtime — the table is the only guard.
 */

import { describe, it, expect } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { THINKING_LEVELS } from '@tzurot/common-types/schemas/llmAdvancedParams';
import { buildThinkingKwargs } from './thinkingTranslation.js';

describe('buildThinkingKwargs', () => {
  describe('absent level', () => {
    it.each([AIProvider.OpenRouter, AIProvider.ZaiCoding])(
      'sends nothing for %s when the level is absent (provider default)',
      provider => {
        expect(buildThinkingKwargs(undefined, provider)).toBeUndefined();
      }
    );
  });

  describe('OpenRouter', () => {
    it.each([
      ['minimal', 'minimal'],
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
      ['max', 'max'],
    ] as const)('translates thinking=%s to reasoning.effort=%s', (thinking, effort) => {
      expect(buildThinkingKwargs(thinking, AIProvider.OpenRouter)).toEqual({
        reasoning: { effort },
      });
    });

    it("translates off to OpenRouter's effort=none", () => {
      expect(buildThinkingKwargs('off', AIProvider.OpenRouter)).toEqual({
        reasoning: { effort: 'none' },
      });
    });

    it('never sends exclude or enabled (the trace is what /inspect reads)', () => {
      const kwargs = buildThinkingKwargs('high', AIProvider.OpenRouter);
      expect(kwargs?.reasoning).not.toHaveProperty('exclude');
      expect(kwargs?.reasoning).not.toHaveProperty('enabled');
    });
  });

  describe('z.ai-direct', () => {
    it('translates off to a disabled thinking object with no effort', () => {
      expect(buildThinkingKwargs('off', AIProvider.ZaiCoding)).toEqual({
        thinking: { type: 'disabled' },
      });
    });

    it.each(['minimal', 'low', 'medium', 'high', 'max'] as const)(
      'translates thinking=%s to enabled + reasoning_effort',
      thinking => {
        expect(buildThinkingKwargs(thinking, AIProvider.ZaiCoding)).toEqual({
          thinking: { type: 'enabled' },
          reasoning_effort: thinking,
        });
      }
    );

    // The regression pin for the false-advertising bug: the z.ai route used to
    // receive OpenRouter's `reasoning` object, which z.ai accepts and ignores,
    // so every z.ai config silently ran at the provider default.
    it.each([...THINKING_LEVELS, undefined])(
      'never emits a reasoning key for z.ai (level=%s)',
      thinking => {
        expect(buildThinkingKwargs(thinking, AIProvider.ZaiCoding) ?? {}).not.toHaveProperty(
          'reasoning'
        );
      }
    );
  });

  describe('non-LLM providers', () => {
    it.each([AIProvider.ElevenLabs, AIProvider.Mistral])(
      'sends nothing for %s (createChatModel throws for it regardless)',
      provider => {
        expect(buildThinkingKwargs('high', provider)).toBeUndefined();
      }
    );
  });

  it('covers every canonical level for both LLM providers', () => {
    // Guards the it.each tables above against a level being added to
    // THINKING_LEVELS without a translation case on either arm.
    for (const level of THINKING_LEVELS) {
      expect(buildThinkingKwargs(level, AIProvider.OpenRouter)).toBeDefined();
      expect(buildThinkingKwargs(level, AIProvider.ZaiCoding)).toBeDefined();
    }
  });
});
