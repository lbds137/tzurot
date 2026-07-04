import { describe, it, expect, vi } from 'vitest';
import {
  validateModelAndContextWindow,
  enrichWithModelContext,
  computeRequiresZaiKey,
} from './modelValidation.js';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';
import type { ModelAutocompleteOption } from '@tzurot/common-types/types/ai';

function createMockModelCache(
  getModelByIdResult: ModelAutocompleteOption | null = null
): OpenRouterModelCache {
  return {
    getModelById: vi.fn().mockResolvedValue(getModelByIdResult),
  } as unknown as OpenRouterModelCache;
}

function createMockModel(
  overrides: Partial<ModelAutocompleteOption> = {}
): ModelAutocompleteOption {
  return {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    contextLength: 200000,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    ...overrides,
  };
}

describe('validateModelAndContextWindow', () => {
  it('should skip validation when modelCache is undefined', async () => {
    const result = await validateModelAndContextWindow(undefined, 'any-model', 999999);
    expect(result.error).toBeUndefined();
  });

  it('should skip validation when modelId is undefined', async () => {
    const cache = createMockModelCache();
    const result = await validateModelAndContextWindow(cache, undefined, 999999);
    expect(result.error).toBeUndefined();
  });

  it('should reject unknown model IDs', async () => {
    const cache = createMockModelCache(null);
    const result = await validateModelAndContextWindow(cache, 'nonexistent/model', undefined);
    expect(result.error).toContain("Model 'nonexistent/model' not found");
    expect(result.error).toContain('autocomplete');
  });

  it('should accept valid model IDs', async () => {
    const model = createMockModel({ contextLength: 200000 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(
      cache,
      'anthropic/claude-sonnet-4',
      undefined
    );
    expect(result.error).toBeUndefined();
    expect(result.contextWindowCap).toBe(100000);
  });

  it('should accept contextWindowTokens within 50% cap', async () => {
    const model = createMockModel({ contextLength: 200000 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'anthropic/claude-sonnet-4', 100000);
    expect(result.error).toBeUndefined();
    expect(result.contextWindowCap).toBe(100000);
  });

  it('should reject contextWindowTokens exceeding 50% cap', async () => {
    const model = createMockModel({ contextLength: 200000 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'anthropic/claude-sonnet-4', 150000);
    expect(result.error).toContain("exceeds the safe limit for 'anthropic/claude-sonnet-4'");
    expect(result.error).toContain('200K');
    expect(result.error).toContain('100K');
    expect(result.error).toContain('Reduce the Context Window value');
    expect(result.contextWindowCap).toBe(100000);
  });

  it('should handle odd context lengths (floor division)', async () => {
    const model = createMockModel({ contextLength: 131073 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/model', 65536);
    expect(result.error).toBeUndefined();
    expect(result.contextWindowCap).toBe(65536); // Math.floor(131073 / 2)
  });

  it('should accept contextWindowTokens exactly at the 50% cap', async () => {
    const model = createMockModel({ contextLength: 100000 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/model', 50000);
    expect(result.error).toBeUndefined();
  });

  it('should return cap even when contextWindowTokens is not provided', async () => {
    const model = createMockModel({ contextLength: 128000 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/model', undefined);
    expect(result.error).toBeUndefined();
    expect(result.contextWindowCap).toBe(64000);
  });

  it('should cap small models (<=65536 tokens) at 75% of context length', async () => {
    const model = createMockModel({ contextLength: 32768 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/small-model', 24576);
    expect(result.error).toBeUndefined();
    expect(result.contextWindowCap).toBe(24576);
  });

  it('should reject contextWindowTokens at the full context length for small models', async () => {
    // The prod-incident shape: configuring a 32k model at its full 32768
    // leaves no room for output or tokenizer mismatch and must be rejected.
    const model = createMockModel({ contextLength: 32768 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/small-model', 32768);
    expect(result.error).toContain("exceeds the safe limit for 'test/small-model'");
    expect(result.error).toContain('Reduce the Context Window value');
    expect(result.contextWindowCap).toBe(24576);
  });

  it('should apply the 75% cap at exactly the 65536 boundary', async () => {
    const model = createMockModel({ contextLength: 65536 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/boundary', undefined);
    expect(result.contextWindowCap).toBe(49152); // 65536 * 0.75
  });

  it('should halve context at 65537 (just above threshold)', async () => {
    const model = createMockModel({ contextLength: 65537 });
    const cache = createMockModelCache(model);
    const result = await validateModelAndContextWindow(cache, 'test/boundary', undefined);
    expect(result.contextWindowCap).toBe(32768); // Math.floor(65537 / 2)
  });

  describe('z.ai coding-plan path (hasZaiCodingKey)', () => {
    it('should validate z.ai-only models against the catalog without touching OpenRouter', async () => {
      // glm-5.2 is NOT on OpenRouter — the cache returns null for it. With a
      // z.ai key, validation must succeed from the catalog (1M context) and
      // never consult the cache.
      const cache = createMockModelCache(null);
      const result = await validateModelAndContextWindow(cache, 'z-ai/glm-5.2', undefined, true);
      expect(result.error).toBeUndefined();
      expect(result.contextWindowCap).toBe(500_000); // 50% of 1M
      expect(cache.getModelById).not.toHaveBeenCalled();
    });

    it('should cap (not skip) z.ai-accepted models — reject an oversized contextWindowTokens', async () => {
      // Proves the z.ai path enforces the cap rather than waving the model
      // through: 600k > the 500k cap on glm-5.2's 1M context.
      const cache = createMockModelCache(null);
      const result = await validateModelAndContextWindow(cache, 'z-ai/glm-5.2', 600_000, true);
      expect(result.error).toContain("exceeds the safe limit for 'z-ai/glm-5.2'");
      expect(result.error).toContain('1000K');
      expect(result.error).toContain('500K');
      expect(result.contextWindowCap).toBe(500_000);
    });

    it('should accept a within-cap contextWindowTokens for a z.ai model', async () => {
      const cache = createMockModelCache(null);
      const result = await validateModelAndContextWindow(cache, 'z-ai/glm-5', 100_000, true);
      expect(result.error).toBeUndefined();
      expect(result.contextWindowCap).toBe(100_000); // 50% of 200k
    });

    it('should return the z.ai-key-required message for a z.ai-only model with no key', async () => {
      // Without a key, a z.ai-only model is NOT promoted at runtime, so it falls
      // through to OpenRouter — where glm-5.2 is absent. Rather than the generic
      // "not found" (which implies a bad model id), surface the real constraint:
      // this model needs a z.ai-coding key. Still consults the cache first so an
      // OpenRouter-available z.ai model isn't pre-empted.
      const cache = createMockModelCache(null);
      const result = await validateModelAndContextWindow(cache, 'z-ai/glm-5.2', undefined, false);
      expect(result.error).toContain("Model 'z-ai/glm-5.2' is served by the z.ai Coding Plan");
      expect(result.error).toContain('/settings apikey set');
      expect(result.error).not.toContain('not found');
      expect(cache.getModelById).toHaveBeenCalledWith('z-ai/glm-5.2');
    });

    it('should NOT falsely reject an OpenRouter-available z.ai model with no key', async () => {
      // Regression guard for the subtlety: glm-5.1 (unlike glm-5.2) IS on
      // OpenRouter, so a no-key user saving it runs on OpenRouter at runtime and
      // the config is valid. The z.ai-key-required message must only replace the
      // generic not-found message, never pre-empt the cache lookup — so a cache
      // hit validates normally.
      const cache = createMockModelCache(
        createMockModel({ id: 'z-ai/glm-5.1', contextLength: 202752 })
      );
      const result = await validateModelAndContextWindow(cache, 'z-ai/glm-5.1', undefined, false);
      expect(result.error).toBeUndefined();
      expect(result.contextWindowCap).toBe(101376); // Math.floor(202752 / 2)
      expect(cache.getModelById).toHaveBeenCalledWith('z-ai/glm-5.1');
    });

    it('should keep the generic not-found message for a genuinely unknown z-ai model', async () => {
      // A `z-ai/`-prefixed id that isn't in the catalog is just an unknown model;
      // the z.ai-key hint would be wrong, so it keeps the generic message.
      const cache = createMockModelCache(null);
      const result = await validateModelAndContextWindow(
        cache,
        'z-ai/glm-nonexistent',
        undefined,
        false
      );
      expect(result.error).toContain("Model 'z-ai/glm-nonexistent' not found");
      expect(result.error).not.toContain('z.ai Coding Plan');
    });

    it('should NOT take the z.ai path for a bare (unprefixed) catalog name', async () => {
      // Regression guard: getZaiCodingPlanContextLength('glm-5') returns 200k
      // (it accepts bare names for the runtime resolver), but ProviderRouter
      // only promotes z-ai/-prefixed models. A saved bare `glm-5` must validate
      // against OpenRouter — where it's absent → rejected — not short-circuit on
      // the catalog and save a config runtime can't honor.
      const cache = createMockModelCache(null);
      const result = await validateModelAndContextWindow(cache, 'glm-5', undefined, true);
      expect(result.error).toContain("Model 'glm-5' not found");
      expect(cache.getModelById).toHaveBeenCalledWith('glm-5');
    });

    it('should fall through to OpenRouter for non-catalog models even with a key', async () => {
      // hasZaiCodingKey:true must not short-circuit a non-z.ai model — it isn't
      // in the catalog, so the OpenRouter path still owns it.
      const model = createMockModel({ contextLength: 200000 });
      const cache = createMockModelCache(model);
      const result = await validateModelAndContextWindow(
        cache,
        'anthropic/claude-sonnet-4',
        undefined,
        true
      );
      expect(result.error).toBeUndefined();
      expect(result.contextWindowCap).toBe(100000);
      expect(cache.getModelById).toHaveBeenCalledWith('anthropic/claude-sonnet-4');
    });
  });
});

describe('computeRequiresZaiKey', () => {
  it('should badge a z.ai-only model (not on OpenRouter) for a keyless viewer', async () => {
    // glm-5.2 is absent from OpenRouter → cache miss → a keyless viewer can't run
    // it (OpenRouter fallthrough would 404), so the badge fires.
    const cache = createMockModelCache(null);
    expect(await computeRequiresZaiKey('z-ai/glm-5.2', false, cache)).toBe(true);
    expect(cache.getModelById).toHaveBeenCalledWith('z-ai/glm-5.2');
  });

  it('should NOT badge a z.ai model that IS on OpenRouter for a keyless viewer', async () => {
    // glm-5.1 is on OpenRouter, so a keyless viewer runs it there — preset works,
    // no badge. This is the false-positive guard.
    const cache = createMockModelCache(createMockModel({ id: 'z-ai/glm-5.1' }));
    expect(await computeRequiresZaiKey('z-ai/glm-5.1', false, cache)).toBe(false);
  });

  it('should NOT badge when the viewer has a z.ai-coding key', async () => {
    const cache = createMockModelCache(null);
    expect(await computeRequiresZaiKey('z-ai/glm-5.2', true, cache)).toBe(false);
    // Short-circuits on the key before any cache lookup.
    expect(cache.getModelById).not.toHaveBeenCalled();
  });

  it('should NOT badge a non-z.ai model', async () => {
    const cache = createMockModelCache(null);
    expect(await computeRequiresZaiKey('anthropic/claude-sonnet-4', false, cache)).toBe(false);
  });

  it('should NOT badge a bare (unprefixed) catalog name', async () => {
    // Mirrors the validation/runtime prefix gate: bare glm-5.2 wouldn't promote
    // even with a key, so the z.ai-key hint would be wrong.
    const cache = createMockModelCache(null);
    expect(await computeRequiresZaiKey('glm-5.2', false, cache)).toBe(false);
  });

  it('should NOT badge a prefixed non-catalog model', async () => {
    const cache = createMockModelCache(null);
    expect(await computeRequiresZaiKey('z-ai/glm-nonexistent', false, cache)).toBe(false);
    // Short-circuits on the catalog-membership check, before the cache lookup.
    expect(cache.getModelById).not.toHaveBeenCalled();
  });

  it('should NOT badge when the cache is unavailable (cannot confirm absence)', async () => {
    expect(await computeRequiresZaiKey('z-ai/glm-5.2', false, undefined)).toBe(false);
  });

  it('should NOT badge when model is undefined', async () => {
    const cache = createMockModelCache(null);
    expect(await computeRequiresZaiKey(undefined, false, cache)).toBe(false);
  });
});

describe('enrichWithModelContext', () => {
  it('should add context fields when model is found', async () => {
    const model = createMockModel({ contextLength: 200000 });
    const cache = createMockModelCache(model);
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'anthropic/claude-sonnet-4', cache);

    expect(response.modelContextLength).toBe(200000);
    expect(response.contextWindowCap).toBe(100000);
  });

  it('should skip when modelCache is undefined', async () => {
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'anthropic/claude-sonnet-4', undefined);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
  });

  it('should skip when model is undefined', async () => {
    const cache = createMockModelCache(createMockModel());
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, undefined, cache);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
  });

  it('should skip when model is not found in cache', async () => {
    const cache = createMockModelCache(null);
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'unknown/model', cache);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
  });

  it('should floor the context window cap', async () => {
    const model = createMockModel({ contextLength: 131073 });
    const cache = createMockModelCache(model);
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'test/model', cache);

    expect(response.modelContextLength).toBe(131073);
    expect(response.contextWindowCap).toBe(65536); // Math.floor(131073 / 2)
  });

  it('should apply the 75% cap for small models', async () => {
    const model = createMockModel({ contextLength: 32768 });
    const cache = createMockModelCache(model);
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'test/small-model', cache);

    expect(response.modelContextLength).toBe(32768);
    expect(response.contextWindowCap).toBe(24576); // 32768 * 0.75
  });

  it('should enrich z.ai-only models from the catalog without the cache', async () => {
    // glm-5.2 is absent from OpenRouter; the dashboard cap must still resolve
    // from the catalog (and not consult the cache).
    const cache = createMockModelCache(null);
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'z-ai/glm-5.2', cache);

    expect(response.modelContextLength).toBe(1_000_000);
    expect(response.contextWindowCap).toBe(500_000);
    expect(cache.getModelById).not.toHaveBeenCalled();
  });

  it('should enrich z.ai models even when the cache is undefined', async () => {
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'z-ai/glm-5', undefined);

    expect(response.modelContextLength).toBe(200_000);
    expect(response.contextWindowCap).toBe(100_000);
  });

  it('should NOT enrich a bare (unprefixed) catalog name from the z.ai catalog', async () => {
    // Mirrors the validation prefix gate: bare `glm-5` runs on OpenRouter at
    // runtime, so its cap must come from the cache (here a miss → no fields).
    const cache = createMockModelCache(null);
    const response: { modelContextLength?: number; contextWindowCap?: number } = {};

    await enrichWithModelContext(response, 'glm-5', cache);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
    expect(cache.getModelById).toHaveBeenCalledWith('glm-5');
  });
});
