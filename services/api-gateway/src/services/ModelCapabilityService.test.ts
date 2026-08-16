/**
 * Tests for ModelCapabilityService
 *
 * Verifies the OpenRouter-authoritative → z.ai-catalog → null resolution
 * priority, including the load-bearing cases: OpenRouter wins over the z.ai
 * catalog for models on both, z.ai-only models resolve text-only, unknown
 * models fail closed (null), and a missing cache still resolves z.ai models.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ModelAutocompleteOption } from '@tzurot/common-types/types/ai';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';
import { ModelCapabilityService } from './ModelCapabilityService.js';

/** Build a ModelAutocompleteOption with sensible text-only defaults. */
function modelOption(overrides: Partial<ModelAutocompleteOption> = {}): ModelAutocompleteOption {
  return {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    contextLength: 200_000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    ...overrides,
  };
}

/** A cache stub whose getModelById returns whatever the map holds (null otherwise). */
function cacheReturning(byId: Record<string, ModelAutocompleteOption>): OpenRouterModelCache {
  return {
    // Reasoning support is unknown to these stubs — the three-state contract
    // means undefined, so no thinking warning is derived from them.
    supportsReasoning: vi.fn().mockResolvedValue(undefined),
    getModelById: vi.fn(async (id: string) => byId[id] ?? null),
  } as unknown as OpenRouterModelCache;
}

describe('ModelCapabilityService', () => {
  it('uses OpenRouter capability tags when the model is on OpenRouter (vision-capable)', async () => {
    const cache = cacheReturning({
      'anthropic/claude-3.5-sonnet': modelOption({
        id: 'anthropic/claude-3.5-sonnet',
        supportsVision: true,
        contextLength: 200_000,
      }),
    });
    const caps = await new ModelCapabilityService(cache).resolve('anthropic/claude-3.5-sonnet');
    expect(caps).toEqual({
      supportsVision: true,
      supportsImageGeneration: false,
      supportsAudioInput: false,
      supportsAudioOutput: false,
      contextLength: 200_000,
      source: 'openrouter',
    });
  });

  it('reports a text-only OpenRouter model as non-vision', async () => {
    const cache = cacheReturning({
      'anthropic/claude-text': modelOption({ id: 'anthropic/claude-text', supportsVision: false }),
    });
    const caps = await new ModelCapabilityService(cache).resolve('anthropic/claude-text');
    expect(caps?.supportsVision).toBe(false);
    expect(caps?.source).toBe('openrouter');
  });

  it('OpenRouter is authoritative for z.ai models that ALSO live on OpenRouter', async () => {
    // glm-5.1 is on OpenRouter. Even though it's z.ai-namespaced, the OpenRouter
    // tags win — here OpenRouter (hypothetically) reports vision support, and the
    // z.ai catalog (text-only) must NOT override it.
    const cache = cacheReturning({
      'z-ai/glm-5.1': modelOption({ id: 'z-ai/glm-5.1', supportsVision: true }),
    });
    const caps = await new ModelCapabilityService(cache).resolve('z-ai/glm-5.1');
    expect(caps?.source).toBe('openrouter');
    expect(caps?.supportsVision).toBe(true);
  });

  it('falls back to the z.ai catalog (text-only) for z.ai-only models absent from OpenRouter', async () => {
    // glm-5.2 is z.ai's flagship and is NOT on OpenRouter — only the z.ai catalog
    // resolves it, and z.ai coding-plan models are text-only.
    const cache = cacheReturning({}); // getModelById → null for everything
    const caps = await new ModelCapabilityService(cache).resolve('z-ai/glm-5.2');
    expect(caps).toEqual({
      supportsVision: false,
      supportsImageGeneration: false,
      supportsAudioInput: false,
      supportsAudioOutput: false,
      contextLength: 1_000_000,
      // Text-only, but still a reasoning model — the catalog's whole lineup is.
      supportsReasoning: true,
      thinkingOff: 'best-effort',
      source: 'zai',
    });
  });

  it('returns null for a model unknown to both sources (fail closed)', async () => {
    const cache = cacheReturning({});
    const caps = await new ModelCapabilityService(cache).resolve('made-up/model-x');
    expect(caps).toBeNull();
  });

  it('resolves z.ai catalog models even when the cache is unavailable', async () => {
    const caps = await new ModelCapabilityService(undefined).resolve('z-ai/glm-5.2');
    expect(caps?.source).toBe('zai');
    expect(caps?.supportsVision).toBe(false);
  });

  it('returns null for an OpenRouter-only model when the cache is unavailable', async () => {
    const caps = await new ModelCapabilityService(undefined).resolve('anthropic/claude-sonnet-4');
    expect(caps).toBeNull();
  });

  describe('supportsVision', () => {
    it('returns true when resolve reports vision support', async () => {
      const cache = cacheReturning({
        'anthropic/claude-3.5-sonnet': modelOption({
          id: 'anthropic/claude-3.5-sonnet',
          supportsVision: true,
        }),
      });
      expect(
        await new ModelCapabilityService(cache).supportsVision('anthropic/claude-3.5-sonnet')
      ).toBe(true);
    });

    it('returns false for a text-only model', async () => {
      const cache = cacheReturning({
        'anthropic/claude-text': modelOption({
          id: 'anthropic/claude-text',
          supportsVision: false,
        }),
      });
      expect(await new ModelCapabilityService(cache).supportsVision('anthropic/claude-text')).toBe(
        false
      );
    });

    it('fails closed (false) for a model unknown to both sources', async () => {
      expect(await new ModelCapabilityService(undefined).supportsVision('made-up/model-x')).toBe(
        false
      );
    });
  });

  describe('reasoning support', () => {
    /** A stub carrying BOTH lookups, so the two can disagree the way real data can. */
    function cacheWithReasoning(
      byId: Record<string, ModelAutocompleteOption>,
      reasoning: boolean | undefined
    ): OpenRouterModelCache {
      return {
        getModelById: vi.fn(async (id: string) => byId[id] ?? null),
        supportsReasoning: vi.fn().mockResolvedValue(reasoning),
      } as unknown as OpenRouterModelCache;
    }

    it('carries the cache answer through, keyed on the requested model', async () => {
      // Asserting across the mocked seam: the id must reach the accessor, and
      // its answer must reach the resolved record. A mocked collaborator
      // returns the same thing whether or not the caller forwarded correctly,
      // so the argument assertion is the half that catches a wiring bug.
      const cache = cacheWithReasoning(
        { 'some/reasoner': modelOption({ id: 'some/reasoner' }) },
        true
      );

      const caps = await new ModelCapabilityService(cache).resolve('some/reasoner');

      expect(caps?.supportsReasoning).toBe(true);
      expect(cache.supportsReasoning).toHaveBeenCalledWith('some/reasoner');
    });

    it('carries an authoritative negative through as false', async () => {
      const cache = cacheWithReasoning(
        { 'some/text-only': modelOption({ id: 'some/text-only' }) },
        false
      );

      expect(
        (await new ModelCapabilityService(cache).resolve('some/text-only'))?.supportsReasoning
      ).toBe(false);
    });

    it('leaves reasoning support undefined when the cache cannot answer', async () => {
      const cache = cacheWithReasoning(
        { 'some/mystery': modelOption({ id: 'some/mystery' }) },
        undefined
      );

      expect(
        (await new ModelCapabilityService(cache).resolve('some/mystery'))?.supportsReasoning
      ).toBeUndefined();
    });

    it('reports z.ai-catalog models as reasoning-capable with their thinkingOff level', async () => {
      // glm-5.2 is z.ai-only, so it falls through to the static catalog.
      const caps = await new ModelCapabilityService(undefined).resolve('z-ai/glm-5.2');

      expect(caps?.source).toBe('zai');
      expect(caps?.supportsReasoning).toBe(true);
      expect(caps?.thinkingOff).toBe('best-effort');
    });
  });
});
