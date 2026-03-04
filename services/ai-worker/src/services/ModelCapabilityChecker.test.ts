/**
 * ModelCapabilityChecker Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES, type OpenRouterModel } from '@tzurot/common-types';
import {
  modelSupportsVision,
  modelSupportsReasoning,
  clearCapabilityCache,
} from './ModelCapabilityChecker.js';

// Mock Redis client
const mockRedis = {
  get: vi.fn(),
} as unknown as Redis;

// Sample OpenRouter model data
const createMockModel = (
  id: string,
  inputModalities: string[],
  supportedParams: string[] = []
): OpenRouterModel =>
  ({
    id,
    canonical_slug: id,
    hugging_face_id: null,
    name: id,
    created: Date.now(),
    description: 'Test model',
    context_length: 4096,
    architecture: {
      modality: inputModalities.includes('image') ? 'text+image->text' : 'text->text',
      input_modalities: inputModalities,
      output_modalities: ['text'],
      tokenizer: 'default',
      instruct_type: null,
    },
    pricing: {
      prompt: '0',
      completion: '0',
      request: '0',
      image: '0',
      web_search: '0',
      internal_reasoning: '0',
    },
    top_provider: {
      context_length: 4096,
      max_completion_tokens: 4096,
      is_moderated: false,
    },
    per_request_limits: null,
    supported_parameters: supportedParams,
    default_parameters: {},
  }) as OpenRouterModel;

describe('ModelCapabilityChecker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCapabilityCache();
  });

  afterEach(() => {
    clearCapabilityCache();
  });

  describe('modelSupportsVision', () => {
    describe('with Redis cache available', () => {
      it('should return true for models with image input modality', async () => {
        const models = [
          createMockModel('google/gemma-3-27b-it', ['text', 'image']),
          createMockModel('openai/gpt-4o', ['text', 'image']),
        ];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        const result = await modelSupportsVision('google/gemma-3-27b-it', mockRedis);

        expect(result).toBe(true);
        expect(mockRedis.get).toHaveBeenCalledWith(REDIS_KEY_PREFIXES.OPENROUTER_MODELS);
      });

      it('should return false for models without image input modality', async () => {
        const models = [
          createMockModel('openai/gpt-3.5-turbo', ['text']),
          createMockModel('anthropic/claude-2', ['text']),
        ];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        const result = await modelSupportsVision('openai/gpt-3.5-turbo', mockRedis);

        expect(result).toBe(false);
      });

      it('should strip :free suffix when looking up models', async () => {
        const models = [createMockModel('google/gemma-3-27b-it', ['text', 'image'])];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        const result = await modelSupportsVision('google/gemma-3-27b-it:free', mockRedis);

        expect(result).toBe(true);
      });

      it('should match models stored with :free suffix in Redis', async () => {
        // OpenRouter may store free models WITH the :free suffix
        const models = [createMockModel('google/gemma-3-27b-it:free', ['text', 'image'])];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        // Should match when querying with suffix (exact match)
        expect(await modelSupportsVision('google/gemma-3-27b-it:free', mockRedis)).toBe(true);

        // Clear cache to test the normalized query path
        clearCapabilityCache();
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        // Should also match when querying without suffix
        // (the find() checks both normalizedId and original modelId)
        expect(await modelSupportsVision('google/gemma-3-27b-it', mockRedis)).toBe(true);
      });

      it('should cache results in memory', async () => {
        const models = [createMockModel('openai/gpt-4o', ['text', 'image'])];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        // First call - should hit Redis
        await modelSupportsVision('openai/gpt-4o', mockRedis);
        expect(mockRedis.get).toHaveBeenCalledTimes(1);

        // Second call - should use memory cache
        await modelSupportsVision('openai/gpt-4o', mockRedis);
        expect(mockRedis.get).toHaveBeenCalledTimes(1); // Still 1, not 2
      });
    });

    describe('with Redis cache unavailable', () => {
      it('should fall back to pattern matching when Redis returns null', async () => {
        vi.mocked(mockRedis.get).mockResolvedValue(null);

        // Gemma 3 should match pattern
        const result = await modelSupportsVision('google/gemma-3-27b-it:free', mockRedis);
        expect(result).toBe(true);
      });

      it('should fall back to pattern matching when Redis throws', async () => {
        vi.mocked(mockRedis.get).mockRejectedValue(new Error('Connection error'));

        // Claude 3 should match pattern
        const result = await modelSupportsVision('anthropic/claude-3-opus', mockRedis);
        expect(result).toBe(true);
      });

      it('should fall back to pattern matching when model not in cache', async () => {
        const models = [createMockModel('some-other-model', ['text'])];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        // GPT-4o should match pattern even if not in cache
        const result = await modelSupportsVision('openai/gpt-4o', mockRedis);
        expect(result).toBe(true);
      });
    });

    describe('pattern matching fallback', () => {
      beforeEach(() => {
        // Make Redis return empty to force pattern matching
        vi.mocked(mockRedis.get).mockResolvedValue(null);
      });

      it('should detect GPT-4 vision models', async () => {
        expect(await modelSupportsVision('openai/gpt-4-vision', mockRedis)).toBe(true);
        expect(await modelSupportsVision('openai/gpt-4o', mockRedis)).toBe(true);
        expect(await modelSupportsVision('openai/gpt-4-turbo', mockRedis)).toBe(true);
      });

      it('should detect Claude 3/4 models', async () => {
        expect(await modelSupportsVision('anthropic/claude-3-opus', mockRedis)).toBe(true);
        expect(await modelSupportsVision('anthropic/claude-3-sonnet', mockRedis)).toBe(true);
        expect(await modelSupportsVision('anthropic/claude-4-opus', mockRedis)).toBe(true);
      });

      it('should detect Gemini models', async () => {
        expect(await modelSupportsVision('google/gemini-1.5-pro', mockRedis)).toBe(true);
        expect(await modelSupportsVision('google/gemini-2.0-flash', mockRedis)).toBe(true);
        expect(await modelSupportsVision('google/gemini-2-flash-lite', mockRedis)).toBe(true);
      });

      it('should detect Gemma 3 models', async () => {
        expect(await modelSupportsVision('google/gemma-3-27b-it', mockRedis)).toBe(true);
        expect(await modelSupportsVision('google/gemma-3-27b-it:free', mockRedis)).toBe(true);
        expect(await modelSupportsVision('gemma3-12b', mockRedis)).toBe(true);
      });

      it('should detect Qwen VL models', async () => {
        expect(await modelSupportsVision('qwen/qwen-vl-plus', mockRedis)).toBe(true);
        expect(await modelSupportsVision('qwen/qwen2-vl-72b', mockRedis)).toBe(true);
      });

      it('should detect Qwen 3.5 and Qwen 3 VL models (multimodal)', async () => {
        expect(await modelSupportsVision('qwen/qwen3.5-397b-a17b', mockRedis)).toBe(true);
        expect(await modelSupportsVision('qwen/qwen3-vl-235b-a22b-instruct', mockRedis)).toBe(true);
        expect(await modelSupportsVision('qwen/qwen3-vl-8b-instruct', mockRedis)).toBe(true);
      });

      it('should detect Pixtral (Mistral vision) models', async () => {
        expect(await modelSupportsVision('mistralai/pixtral-large-2411', mockRedis)).toBe(true);
        expect(await modelSupportsVision('mistralai/pixtral-12b', mockRedis)).toBe(true);
      });

      it('should detect InternVL models', async () => {
        expect(await modelSupportsVision('openaccess-ai-collective/internvl2-26b', mockRedis)).toBe(
          true
        );
      });

      it('should NOT detect non-vision models', async () => {
        expect(await modelSupportsVision('openai/gpt-3.5-turbo', mockRedis)).toBe(false);
        expect(await modelSupportsVision('google/gemma-2-27b', mockRedis)).toBe(false);
        expect(await modelSupportsVision('meta-llama/llama-3-70b', mockRedis)).toBe(false);
        expect(await modelSupportsVision('qwen/qwen2.5-72b', mockRedis)).toBe(false);
        // Qwen 3 base models are text-only (only qwen3.5 and qwen3-vl are multimodal)
        expect(await modelSupportsVision('qwen/qwen3-32b', mockRedis)).toBe(false);
        expect(await modelSupportsVision('qwen/qwen3-coder', mockRedis)).toBe(false);
      });
    });
  });

  describe('modelSupportsReasoning', () => {
    describe('with Redis cache available', () => {
      it('should return true for models with reasoning in supported_parameters', async () => {
        const models = [
          createMockModel('kimi/kimi-k2.5', ['text'], ['reasoning', 'temperature', 'top_p']),
        ];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        const result = await modelSupportsReasoning('kimi/kimi-k2.5', mockRedis);

        expect(result).toBe(true);
      });

      it('should return false for models without reasoning in supported_parameters', async () => {
        const models = [
          createMockModel('meta-llama/llama-3-70b', ['text'], ['temperature', 'top_p']),
        ];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        const result = await modelSupportsReasoning('meta-llama/llama-3-70b', mockRedis);

        expect(result).toBe(false);
      });

      it('should share cache between vision and reasoning checks', async () => {
        const models = [
          createMockModel('openai/gpt-4o', ['text', 'image'], ['reasoning', 'temperature']),
        ];
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

        // First call populates cache via vision check
        await modelSupportsVision('openai/gpt-4o', mockRedis);
        expect(mockRedis.get).toHaveBeenCalledTimes(1);

        // Second call should use memory cache (no additional Redis hit)
        const reasoning = await modelSupportsReasoning('openai/gpt-4o', mockRedis);
        expect(mockRedis.get).toHaveBeenCalledTimes(1);
        expect(reasoning).toBe(true);
      });
    });

    describe('pattern matching fallback', () => {
      beforeEach(() => {
        vi.mocked(mockRedis.get).mockResolvedValue(null);
      });

      it('should detect DeepSeek R1 reasoning models', async () => {
        expect(await modelSupportsReasoning('deepseek/deepseek-r1', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('deepseek/deepseek-reasoner', mockRedis)).toBe(true);
      });

      it('should detect QwQ reasoning models', async () => {
        expect(await modelSupportsReasoning('qwen/qwq-32b', mockRedis)).toBe(true);
      });

      it('should detect DeepSeek V3 reasoning models', async () => {
        expect(await modelSupportsReasoning('deepseek/deepseek-v3.1', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('deepseek/deepseek-v3.2', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('deepseek/deepseek-chat-v3-0324', mockRedis)).toBe(
          true
        );
      });

      it('should detect Qwen 3+ reasoning models', async () => {
        expect(await modelSupportsReasoning('qwen/qwen3-235b-a22b', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('qwen/qwen3.5-397b-a17b', mockRedis)).toBe(true);
      });

      it('should detect OpenAI GPT-5 reasoning models', async () => {
        expect(await modelSupportsReasoning('openai/gpt-5', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('openai/gpt-5-mini', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('openai/gpt-oss-120b', mockRedis)).toBe(true);
      });

      it('should detect Claude 3.7+ reasoning models', async () => {
        expect(await modelSupportsReasoning('anthropic/claude-3.7-sonnet', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('anthropic/claude-sonnet-4.6', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('anthropic/claude-opus-4.1', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('anthropic/claude-haiku-4.5', mockRedis)).toBe(true);
      });

      it('should detect Gemini reasoning models', async () => {
        expect(await modelSupportsReasoning('google/gemini-2.5-pro', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('google/gemini-2.0-flash', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('google/gemini-3-flash-preview', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('google/gemini-1.5-pro', mockRedis)).toBe(true);
      });

      it('should detect Grok reasoning models', async () => {
        expect(await modelSupportsReasoning('x-ai/grok-3-mini', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('x-ai/grok-4', mockRedis)).toBe(true);
      });

      it('should detect Kimi K2 models', async () => {
        expect(await modelSupportsReasoning('kimi/kimi-k2-thinking', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('kimi/kimi-k2.5', mockRedis)).toBe(true);
      });

      it('should detect GLM 4/5 models', async () => {
        expect(await modelSupportsReasoning('z-ai/glm-4.5-air', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('z-ai/glm-5-plus', mockRedis)).toBe(true);
      });

      it('should NOT detect non-reasoning models', async () => {
        expect(await modelSupportsReasoning('meta-llama/llama-3-70b', mockRedis)).toBe(false);
        expect(await modelSupportsReasoning('anthropic/claude-3-opus', mockRedis)).toBe(false);
        expect(await modelSupportsReasoning('qwen/qwen2.5-72b', mockRedis)).toBe(false);
        expect(await modelSupportsReasoning('openai/gpt-4o', mockRedis)).toBe(false);
      });
    });
  });

  describe('clearCapabilityCache', () => {
    it('should clear the memory cache', async () => {
      const models = [createMockModel('test-model', ['text', 'image'])];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

      // Populate cache
      await modelSupportsVision('test-model', mockRedis);
      expect(mockRedis.get).toHaveBeenCalledTimes(1);

      // Clear cache
      clearCapabilityCache();

      // Should hit Redis again
      await modelSupportsVision('test-model', mockRedis);
      expect(mockRedis.get).toHaveBeenCalledTimes(2);
    });
  });
});
