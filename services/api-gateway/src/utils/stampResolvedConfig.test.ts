import { describe, it, expect, vi } from 'vitest';
import { stampResolvedConfig } from './stampResolvedConfig.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { LlmConfigResolver, VisionConfigResolver } from '@tzurot/config-resolver';

// stampResolvedConfig only reads id/model/visionModel and spreads the rest, so a minimal
// cast is a faithful stand-in for a full LoadedPersonality here.
const basePersonality = {
  id: 'p-1',
  model: 'seed-model',
  // visionModel intentionally unset — an undefined seed vision model.
} as unknown as LoadedPersonality;

const llmResolver = (
  model: string,
  source: string,
  extraConfig: Record<string, unknown> = {}
): LlmConfigResolver =>
  ({
    resolveConfig: vi.fn().mockResolvedValue({ config: { model, ...extraConfig }, source }),
  }) as unknown as LlmConfigResolver;

const visionResolver = (
  model: string,
  source: string,
  fallbacks: { global?: string; free?: string } = {}
): VisionConfigResolver =>
  ({
    resolveConfig: vi.fn().mockResolvedValue({ config: { model }, source }),
    getGlobalDefaultConfig: vi
      .fn()
      .mockResolvedValue(
        fallbacks.global !== undefined ? { model: fallbacks.global, source: 'personality' } : null
      ),
    getFreeDefaultVisionConfig: vi
      .fn()
      .mockResolvedValue(
        fallbacks.free !== undefined ? { model: fallbacks.free, source: 'personality' } : null
      ),
  }) as unknown as VisionConfigResolver;

describe('stampResolvedConfig', () => {
  describe('text axis', () => {
    it('stamps the model + configSource from a user-override tier', async () => {
      const { personality, configSource } = await stampResolvedConfig(
        basePersonality,
        'user-1',
        'req-1',
        llmResolver('resolved-model', 'user-default')
      );
      expect(personality.model).toBe('resolved-model');
      expect(configSource).toBe('user-default');
    });

    it('stamps the FULL merged config, not just the model (regression: preset params ignored)', async () => {
      // The observed prod bug: a user-default preset with ctx=500K/minP=0.01 ran
      // against the seed's 100K budget with minP dropped, because only `model`
      // crossed the stamp. Every LLM_CONFIG_OVERRIDE_KEYS field must cross.
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'user-1',
        'req-1',
        llmResolver('resolved-model', 'user-default', {
          contextWindowTokens: 500000,
          minP: 0.01,
          temperature: 0.8,
          reasoning: { enabled: true, effort: 'medium' },
        })
      );
      expect(personality.contextWindowTokens).toBe(500000);
      expect(personality.minP).toBe(0.01);
      expect(personality.temperature).toBe(0.8);
      expect(personality.reasoning).toEqual({ enabled: true, effort: 'medium' });
    });

    it('leaves seed fields untouched when the resolved config omits them (undefined)', async () => {
      const seeded = {
        ...basePersonality,
        contextWindowTokens: 131072,
        temperature: 0.7,
      } as unknown as LoadedPersonality;
      const { personality } = await stampResolvedConfig(
        seeded,
        'user-1',
        'req-1',
        // merged config carries only a model + one field — the rest stay seed
        llmResolver('resolved-model', 'user-default', { minP: 0.05 })
      );
      expect(personality.model).toBe('resolved-model');
      expect(personality.minP).toBe(0.05);
      expect(personality.contextWindowTokens).toBe(131072);
      expect(personality.temperature).toBe(0.7);
    });

    it('does not stamp provider (ProviderRouter promotes by model prefix)', async () => {
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'user-1',
        'req-1',
        llmResolver('z-ai/glm-5.2', 'user-default', { provider: 'openrouter' })
      );
      expect((personality as { provider?: string }).provider).toBeUndefined();
    });

    it('leaves the seed model unchanged when the source is personality (already the seed)', async () => {
      const { personality, configSource } = await stampResolvedConfig(
        basePersonality,
        'user-1',
        'req-1',
        llmResolver('ignored', 'personality')
      );
      expect(personality.model).toBe('seed-model');
      expect(configSource).toBe('personality');
    });

    it('fails open to the seed model on a resolver throw', async () => {
      const resolver = {
        resolveConfig: vi.fn().mockRejectedValue(new Error('db down')),
      } as unknown as LlmConfigResolver;
      const { personality } = await stampResolvedConfig(basePersonality, 'u', 'r', resolver);
      expect(personality.model).toBe('seed-model');
    });
  });

  describe('vision axis', () => {
    it('stamps the vision model + deduped fallback chain (global → free)', async () => {
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'u',
        'r',
        undefined,
        visionResolver('primary-vision', 'personality', { global: 'g-default', free: 'f-default' })
      );
      expect(personality.visionModel).toBe('primary-vision');
      expect(personality.visionFallbackModels).toEqual(['g-default', 'f-default']);
    });

    it('dedupes the fallback chain when global and free resolve to the same model', async () => {
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'u',
        'r',
        undefined,
        visionResolver('primary', 'personality', { global: 'same', free: 'same' })
      );
      expect(personality.visionFallbackModels).toEqual(['same']);
    });

    it('omits the fallback chain when no DB vision defaults are set', async () => {
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'u',
        'r',
        undefined,
        visionResolver('primary', 'personality')
      );
      expect(personality.visionFallbackModels).toBeUndefined();
    });

    it('does NOT stamp the hardcoded vision fallback (bootstrap window)', async () => {
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'u',
        'r',
        undefined,
        visionResolver('qwen/hardcoded-fallback', 'hardcoded')
      );
      expect(personality.visionModel).toBeUndefined();
    });

    it('fails open on a vision-resolver throw (seed vision left unstamped)', async () => {
      const resolver = {
        resolveConfig: vi.fn().mockRejectedValue(new Error('db down')),
        getGlobalDefaultConfig: vi.fn().mockResolvedValue(null),
        getFreeDefaultVisionConfig: vi.fn().mockResolvedValue(null),
      } as unknown as VisionConfigResolver;
      const { personality } = await stampResolvedConfig(
        basePersonality,
        'u',
        'r',
        undefined,
        resolver
      );
      expect(personality.visionModel).toBeUndefined();
      expect(personality.visionFallbackModels).toBeUndefined();
    });
  });
});
