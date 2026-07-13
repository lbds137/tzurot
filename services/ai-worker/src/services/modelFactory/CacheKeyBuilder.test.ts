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
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'test-openrouter-key',
    }),
  };
});

vi.mock('@tzurot/common-types/constants/ai', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/ai')>(
    '@tzurot/common-types/constants/ai'
  );
  return {
    ...actual,
    AIProvider: {
      OpenRouter: 'openrouter',
      ElevenLabs: 'elevenlabs',
      ZaiCoding: 'zai-coding',
    },
  };
});

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { getModelCacheKey } from './CacheKeyBuilder.js';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import type { ModelConfig } from '../ModelFactory.js';

describe('getModelCacheKey', () => {
  it('an absent modelName keys on the LIVE fallbackTextModel setting (divergent-from-fallback value)', () => {
    registerSystemSettings({
      get: (key: string) => (key === 'fallbackTextModel' ? 'divergent/text-model' : undefined),
    } as unknown as SystemSettingsService);
    try {
      const key = getModelCacheKey({ apiKey: 'k' } as never);
      expect(key).toContain('divergent/text-model');
    } finally {
      resetSystemSettingsRegistration();
    }
  });

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

  it('should differentiate by per-request provider override', () => {
    // Same model name, different provider override — must NOT share a cached
    // ChatOpenAI instance because the configured baseURL differs (OpenRouter
    // vs z.ai-coding endpoints). Without provider in the cache key, the second
    // request would silently reuse the first's wrong-baseURL client.
    const config1: ModelConfig = { modelName: 'glm-4.7' };
    const config2: ModelConfig = { modelName: 'glm-4.7', provider: AIProvider.ZaiCoding };

    expect(getModelCacheKey(config1)).not.toBe(getModelCacheKey(config2));
  });

  it('should fall back to env-level AI_PROVIDER when no override is set', () => {
    // When modelConfig.provider is undefined, env-level config.AI_PROVIDER
    // (mocked as 'openrouter') is used. Two configs that both omit provider
    // produce the same cache key.
    const config1: ModelConfig = { modelName: 'glm-4.7' };
    const config2: ModelConfig = { modelName: 'glm-4.7' };

    expect(getModelCacheKey(config1)).toBe(getModelCacheKey(config2));
  });
});
