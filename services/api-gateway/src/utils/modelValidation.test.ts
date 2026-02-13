import { describe, it, expect, vi } from 'vitest';
import { validateModelAndContextWindow, enrichWithModelContext } from './modelValidation.js';
import type { OpenRouterModelCache } from '../services/OpenRouterModelCache.js';
import type { ModelAutocompleteOption } from '@tzurot/common-types';

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
    expect(result.error).toContain('exceeds 50%');
    expect(result.error).toContain('200K');
    expect(result.error).toContain('100K');
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
});

describe('enrichWithModelContext', () => {
  it('should add context fields when model is found', async () => {
    const model = createMockModel({ contextLength: 200000 });
    const cache = createMockModelCache(model);
    const response: Record<string, unknown> = {
      id: 'config-1',
      model: 'anthropic/claude-sonnet-4',
    };

    await enrichWithModelContext(response, 'anthropic/claude-sonnet-4', cache);

    expect(response.modelContextLength).toBe(200000);
    expect(response.contextWindowCap).toBe(100000);
  });

  it('should skip when modelCache is undefined', async () => {
    const response: Record<string, unknown> = { id: 'config-1' };

    await enrichWithModelContext(response, 'anthropic/claude-sonnet-4', undefined);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
  });

  it('should skip when model is undefined', async () => {
    const cache = createMockModelCache(createMockModel());
    const response: Record<string, unknown> = { id: 'config-1' };

    await enrichWithModelContext(response, undefined, cache);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
  });

  it('should skip when model is not found in cache', async () => {
    const cache = createMockModelCache(null);
    const response: Record<string, unknown> = { id: 'config-1' };

    await enrichWithModelContext(response, 'unknown/model', cache);

    expect(response.modelContextLength).toBeUndefined();
    expect(response.contextWindowCap).toBeUndefined();
  });

  it('should floor the context window cap', async () => {
    const model = createMockModel({ contextLength: 131073 });
    const cache = createMockModelCache(model);
    const response: Record<string, unknown> = {};

    await enrichWithModelContext(response, 'test/model', cache);

    expect(response.modelContextLength).toBe(131073);
    expect(response.contextWindowCap).toBe(65536); // Math.floor(131073 / 2)
  });
});
