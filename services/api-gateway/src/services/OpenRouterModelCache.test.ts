/**
 * Tests for OpenRouterModelCache service
 *
 * Tests caching behavior, filtering, and OpenRouter API integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { OpenRouterModelCache } from './OpenRouterModelCache.js';
import type { OpenRouterModel } from '@tzurot/common-types';

// Sample model data for testing
const sampleTextModel: OpenRouterModel = {
  id: 'anthropic/claude-sonnet-4',
  canonical_slug: 'anthropic/claude-sonnet-4-20250514',
  hugging_face_id: null,
  name: 'Anthropic: Claude Sonnet 4',
  created: 1700000000,
  description: 'A powerful text generation model',
  context_length: 200000,
  architecture: {
    modality: 'text->text',
    input_modalities: ['text'],
    output_modalities: ['text'],
    tokenizer: 'claude',
    instruct_type: null,
  },
  pricing: {
    prompt: '0.000003',
    completion: '0.000015',
    request: '0',
    image: '0',
    web_search: '0',
    internal_reasoning: '0',
  },
  top_provider: {
    context_length: 200000,
    max_completion_tokens: 8192,
    is_moderated: false,
  },
  per_request_limits: null,
  supported_parameters: ['temperature', 'max_tokens'],
  default_parameters: {},
};

const sampleVisionModel: OpenRouterModel = {
  id: 'openai/gpt-4o',
  canonical_slug: 'openai/gpt-4o-2024',
  hugging_face_id: null,
  name: 'OpenAI: GPT-4o',
  created: 1700000000,
  description: 'Vision-capable model',
  context_length: 128000,
  architecture: {
    modality: 'text+image->text',
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
    tokenizer: 'gpt',
    instruct_type: null,
  },
  pricing: {
    prompt: '0.000005',
    completion: '0.000015',
    request: '0',
    image: '0.003',
    web_search: '0',
    internal_reasoning: '0',
  },
  top_provider: {
    context_length: 128000,
    max_completion_tokens: 4096,
    is_moderated: false,
  },
  per_request_limits: null,
  supported_parameters: ['temperature', 'max_tokens'],
  default_parameters: {},
};

const sampleImageGenModel: OpenRouterModel = {
  id: 'dall-e/dall-e-3',
  canonical_slug: 'dall-e/dall-e-3',
  hugging_face_id: null,
  name: 'DALL-E 3',
  created: 1700000000,
  description: 'Image generation model',
  context_length: 4096,
  architecture: {
    modality: 'text->image',
    input_modalities: ['text'],
    output_modalities: ['image'],
    tokenizer: 'gpt',
    instruct_type: null,
  },
  pricing: {
    prompt: '0.00004',
    completion: '0',
    request: '0.04',
    image: '0.04',
    web_search: '0',
    internal_reasoning: '0',
  },
  top_provider: {
    context_length: 4096,
    max_completion_tokens: 0,
    is_moderated: false,
  },
  per_request_limits: null,
  supported_parameters: ['size', 'quality'],
  default_parameters: {},
};

const sampleModels = [sampleTextModel, sampleVisionModel, sampleImageGenModel];

// Create mock Redis
function createMockRedis() {
  return {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  } as unknown as Redis;
}

describe('OpenRouterModelCache', () => {
  let mockRedis: Redis;
  let cache: OpenRouterModelCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = createMockRedis();
    cache = new OpenRouterModelCache(mockRedis);

    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getModels', () => {
    it('should return cached models from Redis', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(sampleModels));

      const models = await cache.getModels();

      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4');
      expect(mockRedis.get).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch from OpenRouter when Redis cache is empty', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: sampleModels }),
      });

      const models = await cache.getModels();

      expect(models).toHaveLength(3);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          method: 'GET',
        })
      );
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should cache fetched models in Redis with TTL', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: sampleModels }),
      });

      await cache.getModels();

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'openrouter:models',
        86400, // 24 hours in seconds
        JSON.stringify(sampleModels)
      );
    });

    it('should handle Redis read errors gracefully', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis error'));
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: sampleModels }),
      });

      const models = await cache.getModels();

      // Should fall back to fetching from API
      expect(models).toHaveLength(3);
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle OpenRouter API errors', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(cache.getModels()).rejects.toThrow('OpenRouter API returned 500');
    });

    it('should use memory cache for repeated calls', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(sampleModels));

      // First call
      await cache.getModels();
      // Second call (should use memory cache)
      await cache.getModels();

      // Redis should only be called once
      expect(mockRedis.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFilteredModels', () => {
    beforeEach(() => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(sampleModels));
    });

    it('should filter by output modality', async () => {
      const textModels = await cache.getFilteredModels({ outputModality: 'text' });

      expect(textModels).toHaveLength(2);
      expect(textModels.map(m => m.id)).toContain('anthropic/claude-sonnet-4');
      expect(textModels.map(m => m.id)).toContain('openai/gpt-4o');
      expect(textModels.map(m => m.id)).not.toContain('dall-e/dall-e-3');
    });

    it('should filter by input modality', async () => {
      const visionModels = await cache.getFilteredModels({ inputModality: 'image' });

      expect(visionModels).toHaveLength(1);
      expect(visionModels[0].id).toBe('openai/gpt-4o');
    });

    it('should filter by both input and output modality', async () => {
      const visionTextModels = await cache.getFilteredModels({
        inputModality: 'image',
        outputModality: 'text',
      });

      expect(visionTextModels).toHaveLength(1);
      expect(visionTextModels[0].id).toBe('openai/gpt-4o');
    });

    it('should filter by search query (model ID)', async () => {
      const results = await cache.getFilteredModels({ search: 'anthropic' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('anthropic/claude-sonnet-4');
    });

    it('should filter by search query (model name)', async () => {
      const results = await cache.getFilteredModels({ search: 'GPT' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('openai/gpt-4o');
    });

    it('should be case-insensitive for search', async () => {
      const results = await cache.getFilteredModels({ search: 'CLAUDE' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('anthropic/claude-sonnet-4');
    });

    it('should apply limit', async () => {
      const results = await cache.getFilteredModels({ limit: 2 });

      expect(results).toHaveLength(2);
    });

    it('should transform to autocomplete format', async () => {
      const results = await cache.getFilteredModels({ search: 'claude' });

      expect(results[0]).toEqual({
        id: 'anthropic/claude-sonnet-4',
        name: 'Anthropic: Claude Sonnet 4',
        contextLength: 200000,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        promptPricePerMillion: 3,
        completionPricePerMillion: 15,
      });
    });

    it('should correctly identify vision support', async () => {
      const results = await cache.getFilteredModels({ search: 'gpt-4o' });

      expect(results[0].supportsVision).toBe(true);
    });

    it('should correctly identify image generation support', async () => {
      const results = await cache.getFilteredModels({ search: 'dall-e' });

      expect(results[0].supportsImageGeneration).toBe(true);
    });
  });

  describe('convenience methods', () => {
    beforeEach(() => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(sampleModels));
    });

    it('getTextModels should return text generation models', async () => {
      const models = await cache.getTextModels();

      expect(models).toHaveLength(2);
      expect(models.every(m => !m.supportsImageGeneration || m.id === 'openai/gpt-4o')).toBe(true);
    });

    it('getVisionModels should return vision-capable models', async () => {
      const models = await cache.getVisionModels();

      expect(models).toHaveLength(1);
      expect(models[0].supportsVision).toBe(true);
    });

    it('getImageGenerationModels should return image generation models', async () => {
      const models = await cache.getImageGenerationModels();

      expect(models).toHaveLength(1);
      expect(models[0].supportsImageGeneration).toBe(true);
    });

    it('convenience methods should support search', async () => {
      const models = await cache.getTextModels('claude');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('anthropic/claude-sonnet-4');
    });

    it('convenience methods should support limit', async () => {
      const models = await cache.getTextModels(undefined, 1);

      expect(models).toHaveLength(1);
    });
  });

  describe('getModelById', () => {
    beforeEach(() => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(sampleModels));
    });

    it('should return autocomplete option for existing model', async () => {
      const result = await cache.getModelById('anthropic/claude-sonnet-4');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('anthropic/claude-sonnet-4');
      expect(result?.contextLength).toBe(200000);
      expect(result?.name).toBe('Anthropic: Claude Sonnet 4');
    });

    it('should return null for non-existent model', async () => {
      const result = await cache.getModelById('nonexistent/model');

      expect(result).toBeNull();
    });

    it('should return null when cache is unavailable', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));
      // Also need fetch to fail since getModels falls through to API
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      const result = await cache.getModelById('anthropic/claude-sonnet-4');

      expect(result).toBeNull();
    });

    it('should return vision model data with correct flags', async () => {
      const result = await cache.getModelById('openai/gpt-4o');

      expect(result).not.toBeNull();
      expect(result?.supportsVision).toBe(true);
      expect(result?.contextLength).toBe(128000);
    });
  });

  describe('refreshCache', () => {
    it('should clear Redis cache and refetch', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(JSON.stringify(sampleModels)) // First call (may be from memory cache clear)
        .mockResolvedValueOnce(null); // After delete
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: sampleModels }),
      });

      const count = await cache.refreshCache();

      expect(mockRedis.del).toHaveBeenCalledWith('openrouter:models');
      expect(count).toBe(3);
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON in Redis cache', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue('invalid json');
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: sampleModels }),
      });

      // Should fall back to API fetch
      const models = await cache.getModels();

      expect(models).toHaveLength(3);
    });

    it('should handle invalid API response format', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalid: 'response' }),
      });

      await expect(cache.getModels()).rejects.toThrow('Invalid response format');
    });

    it('should handle Redis write errors gracefully', async () => {
      (mockRedis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockRedis.setex as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis write error')
      );
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: sampleModels }),
      });

      // Should still return models even if cache write fails
      const models = await cache.getModels();

      expect(models).toHaveLength(3);
    });
  });
});
