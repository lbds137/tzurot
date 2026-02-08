/**
 * Tests for CacheKeyBuilder
 *
 * Verifies that model cache keys correctly differentiate configs
 * so different reasoning/sampling settings produce different cached instances.
 *
 * Moved from ModelFactory.test.ts to colocate with the extracted module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tzurot/common-types
vi.mock('@tzurot/common-types', () => ({
  getConfig: () => ({
    AI_PROVIDER: 'openrouter',
    DEFAULT_AI_MODEL: 'anthropic/claude-sonnet-4.5',
    OPENROUTER_API_KEY: 'test-openrouter-key',
  }),
}));

import { getModelCacheKey } from './CacheKeyBuilder.js';
import type { ModelConfig } from '../ModelFactory.js';

describe('getModelCacheKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should include all parameters in cache key', () => {
    const config1: ModelConfig = {
      modelName: 'model-1',
      temperature: 0.7,
      topP: 0.9,
    };
    const config2: ModelConfig = {
      modelName: 'model-1',
      temperature: 0.7,
      topP: 0.8,
    };

    const key1 = getModelCacheKey(config1);
    const key2 = getModelCacheKey(config2);

    expect(key1).not.toBe(key2);
  });

  it('should generate same key for same configs', () => {
    const config: ModelConfig = {
      modelName: 'model-1',
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
    };

    const key1 = getModelCacheKey(config);
    const key2 = getModelCacheKey(config);

    expect(key1).toBe(key2);
  });

  it('should differentiate by repetitionPenalty', () => {
    const config1: ModelConfig = {
      modelName: 'model-1',
      repetitionPenalty: 1.0,
    };
    const config2: ModelConfig = {
      modelName: 'model-1',
      repetitionPenalty: 1.1,
    };

    const key1 = getModelCacheKey(config1);
    const key2 = getModelCacheKey(config2);

    expect(key1).not.toBe(key2);
  });

  it('should differentiate by maxTokens', () => {
    const config1: ModelConfig = {
      modelName: 'model-1',
      maxTokens: 2048,
    };
    const config2: ModelConfig = {
      modelName: 'model-1',
      maxTokens: 4096,
    };

    const key1 = getModelCacheKey(config1);
    const key2 = getModelCacheKey(config2);

    expect(key1).not.toBe(key2);
  });

  it('should differentiate by minP', () => {
    const config1: ModelConfig = { modelName: 'model-1', minP: 0.1 };
    const config2: ModelConfig = { modelName: 'model-1', minP: 0.2 };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });

  it('should differentiate by reasoning effort', () => {
    const config1: ModelConfig = { modelName: 'model-1', reasoning: { effort: 'high' } };
    const config2: ModelConfig = { modelName: 'model-1', reasoning: { effort: 'low' } };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });

  it('should differentiate by reasoning maxTokens', () => {
    const config1: ModelConfig = { modelName: 'model-1', reasoning: { maxTokens: 8000 } };
    const config2: ModelConfig = { modelName: 'model-1', reasoning: { maxTokens: 16000 } };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });

  it('should differentiate by stop sequences', () => {
    const config1: ModelConfig = { modelName: 'model-1', stop: ['STOP'] };
    const config2: ModelConfig = { modelName: 'model-1', stop: ['END'] };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });

  it('should differentiate by transforms', () => {
    const config1: ModelConfig = { modelName: 'model-1', transforms: ['middle-out'] };
    const config2: ModelConfig = { modelName: 'model-1', transforms: [] };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });

  it('should differentiate by route', () => {
    const config1: ModelConfig = { modelName: 'model-1', route: 'fallback' };
    const config2: ModelConfig = { modelName: 'model-1' };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });
});
