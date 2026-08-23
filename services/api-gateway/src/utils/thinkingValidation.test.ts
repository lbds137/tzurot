/**
 * Tests for collectThinkingWarnings.
 *
 * The load-bearing property is asymmetry: the function must warn on an
 * authoritative mismatch and stay SILENT on every kind of missing data. A
 * warning invented from a cache miss would send users chasing a problem their
 * config doesn't have.
 */

import { describe, it, expect } from 'vitest';
import type { ModelCapabilities } from '@tzurot/common-types/types/ai';
import { collectThinkingWarnings } from './thinkingValidation.js';

/** A resolved-from-OpenRouter capability record, reasoning-capable by default. */
function openRouterCaps(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    contextLength: 128_000,
    supportsReasoning: true,
    source: 'openrouter',
    ...overrides,
  } satisfies ModelCapabilities;
}

/** A resolved-from-z.ai-catalog record; every catalog GLM reasons. */
function zaiCaps(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    contextLength: 200_000,
    supportsReasoning: true,
    source: 'zai',
    ...overrides,
  } satisfies ModelCapabilities;
}

describe('collectThinkingWarnings', () => {
  describe('W1 — the model cannot disable thinking at all', () => {
    it('warns when an unsupported-off model is asked to turn thinking off', () => {
      const warnings = collectThinkingWarnings({
        thinking: 'off',
        model: 'z-ai/glm-4.7',
        capabilities: zaiCaps({ thinkingOff: 'unsupported' }),
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('cannot disable extended thinking');
      expect(warnings[0]).toContain('z-ai/glm-4.7');
    });

    it('stays silent when that same model asks for a non-off level', () => {
      expect(
        collectThinkingWarnings({
          thinking: 'high',
          model: 'z-ai/glm-4.7',
          capabilities: zaiCaps({ thinkingOff: 'unsupported' }),
        })
      ).toEqual([]);
    });
  });

  describe('W2 — disabling is best-effort', () => {
    it('warns that the model may still reason despite the off level', () => {
      const warnings = collectThinkingWarnings({
        thinking: 'off',
        model: 'z-ai/glm-5.2',
        capabilities: zaiCaps({ thinkingOff: 'best-effort' }),
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('best-effort on GLM-5.x');
    });

    it('falls back to the static catalog when the resolved source carries no thinking data', () => {
      // A GLM that OpenRouter also lists resolves as `source: 'openrouter'`,
      // which knows nothing about z.ai's thinking semantics — yet the same model
      // routes z.ai-direct for any user holding a z.ai coding key, so the
      // warning must survive the resolution source.
      const warnings = collectThinkingWarnings({
        thinking: 'off',
        model: 'z-ai/glm-5.1',
        capabilities: openRouterCaps({ thinkingOff: undefined }),
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('best-effort on GLM-5.x');
    });
  });

  describe('W4 — the model does not support reasoning', () => {
    it('warns when a non-off level is set on a reasoning-incapable model', () => {
      const warnings = collectThinkingWarnings({
        thinking: 'medium',
        model: 'some/text-only',
        capabilities: openRouterCaps({ supportsReasoning: false }),
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('does not list reasoning support');
      expect(warnings[0]).toContain("'medium'");
    });

    it('stays silent for `off` on a reasoning-incapable model', () => {
      // Asking a non-reasoning model not to reason is already what happens.
      expect(
        collectThinkingWarnings({
          thinking: 'off',
          model: 'some/text-only',
          capabilities: openRouterCaps({ supportsReasoning: false }),
        })
      ).toEqual([]);
    });

    it('never fires for a model the z.ai catalog knows is a reasoning model', () => {
      // Belt-and-braces for dual-listed GLMs: even if OpenRouter's entry were
      // to drop `reasoning` from supported_parameters, the z.ai catalog is the
      // authority that these models reason — a foreign source's negative must
      // not produce a false "no reasoning support" warning.
      expect(
        collectThinkingWarnings({
          thinking: 'high',
          model: 'z-ai/glm-4.7',
          capabilities: openRouterCaps({ supportsReasoning: false }),
        })
      ).toEqual([]);
    });

    it('stays silent when reasoning support is unknown rather than absent', () => {
      // `undefined` means the catalog could not answer. Treating that as a
      // negative would warn on every model during a catalog outage.
      expect(
        collectThinkingWarnings({
          thinking: 'high',
          model: 'some/unknown',
          capabilities: openRouterCaps({ supportsReasoning: undefined }),
        })
      ).toEqual([]);
    });
  });

  describe('silence cases', () => {
    it('returns nothing when the config carries no thinking level', () => {
      // Absent is distinct from `off`: it takes the provider default, so there
      // is no user request to contradict.
      expect(
        collectThinkingWarnings({
          thinking: undefined,
          model: 'z-ai/glm-4.7',
          capabilities: zaiCaps({ thinkingOff: 'unsupported' }),
        })
      ).toEqual([]);
    });

    it('returns nothing when the model is unresolvable', () => {
      expect(
        collectThinkingWarnings({
          thinking: 'off',
          model: 'some/never-heard-of-it',
          capabilities: null,
        })
      ).toEqual([]);
    });

    it('returns nothing when there is no model at all', () => {
      expect(
        collectThinkingWarnings({ thinking: 'off', model: undefined, capabilities: null })
      ).toEqual([]);
    });

    it('returns nothing for `off` on a model that honors it', () => {
      expect(
        collectThinkingWarnings({
          thinking: 'off',
          model: 'z-ai/glm-4.5-air',
          capabilities: zaiCaps({ thinkingOff: 'honored' }),
        })
      ).toEqual([]);
    });

    it('returns nothing for any level on a reasoning-capable model', () => {
      for (const thinking of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
        expect(
          collectThinkingWarnings({
            thinking,
            model: 'anthropic/claude-sonnet-4',
            capabilities: openRouterCaps({ supportsReasoning: true }),
          })
        ).toEqual([]);
      }
    });
  });

  it('emits gateway-tone prose with no emojis', () => {
    // Per the layered error-message convention, the gateway states the finding
    // plainly and bot-client is the layer that decorates it.
    const warnings = collectThinkingWarnings({
      thinking: 'off',
      model: 'z-ai/glm-4.7',
      capabilities: zaiCaps({ thinkingOff: 'unsupported' }),
    });

    expect(warnings[0]).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
