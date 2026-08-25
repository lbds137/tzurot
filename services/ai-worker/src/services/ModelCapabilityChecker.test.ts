/**
 * ModelCapabilityChecker Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { type OpenRouterModel } from '@tzurot/common-types/types/ai';

// Module-scope logger (not injectable), so asserting the degraded-data warn on
// a transient catalog miss requires mocking the logger module per package convention.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

import {
  modelSupportsVision,
  modelSupportsReasoning,
  getModelContextLength,
  isModelListed,
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
    describe('the free-model router (authoritative override)', () => {
      it('reports vision-capable even on a full catalog cache-miss', async () => {
        // Regression: selectVisionModel assigns 'openrouter/free' directly as
        // the free vision fallback, but no VISION_MODEL_PATTERNS substring
        // matches it — pre-fix, Redis-down + pattern-fallback misreported
        // the designed-in vision fallback as non-vision.
        vi.mocked(mockRedis.get).mockResolvedValue(null);

        expect(await modelSupportsVision('openrouter/free', mockRedis)).toBe(true);
      });

      it('does not consult the catalog at all — the override is by design, not data', async () => {
        // A router catalog row (if one ever appears) describes the router,
        // not the vision-capable models it routes to; the answer must not
        // depend on it.
        vi.mocked(mockRedis.get).mockResolvedValue(null);

        await modelSupportsVision('openrouter/free', mockRedis);

        expect(mockRedis.get).not.toHaveBeenCalled();
      });
    });

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

      it('should detect Gemma 3 and Gemma 4 models', async () => {
        expect(await modelSupportsVision('google/gemma-3-27b-it', mockRedis)).toBe(true);
        expect(await modelSupportsVision('google/gemma-3-27b-it:free', mockRedis)).toBe(true);
        expect(await modelSupportsVision('gemma3-12b', mockRedis)).toBe(true);
        // Gemma 4 (both hyphenated and concatenated) — its own pattern entries.
        expect(await modelSupportsVision('google/gemma-4-31b-it', mockRedis)).toBe(true);
        expect(await modelSupportsVision('gemma4-9b', mockRedis)).toBe(true);
      });

      it('should detect Llama vision models but not text-only Llama', async () => {
        // The 'llama' pattern requires the 'vision' qualifier — base Llama is text-only.
        expect(
          await modelSupportsVision('meta-llama/llama-3.2-90b-vision-instruct', mockRedis)
        ).toBe(true);
        expect(await modelSupportsVision('meta-llama/llama-3.3-70b-instruct', mockRedis)).toBe(
          false
        );
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

      it('should detect Qwen 3+ reasoning models (all qwen3 variants support reasoning)', async () => {
        expect(await modelSupportsReasoning('qwen/qwen3-235b-a22b', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('qwen/qwen3.5-397b-a17b', mockRedis)).toBe(true);
        // qwen3 base models are text-only for vision but still support reasoning
        expect(await modelSupportsReasoning('qwen/qwen3-32b', mockRedis)).toBe(true);
        expect(await modelSupportsReasoning('qwen/qwen3-coder', mockRedis)).toBe(true);
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

  describe('getModelContextLength', () => {
    it('should return the context length from the Redis cache', async () => {
      const models = [
        createMockModel('cognitivecomputations/dolphin-mistral-24b-venice-edition', ['text']),
      ];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

      const result = await getModelContextLength(
        'cognitivecomputations/dolphin-mistral-24b-venice-edition',
        mockRedis
      );

      expect(result).toBe(4096); // createMockModel's context_length
    });

    it('should resolve :free-suffixed model IDs', async () => {
      const models = [
        createMockModel('cognitivecomputations/dolphin-mistral-24b-venice-edition', ['text']),
      ];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

      const result = await getModelContextLength(
        'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
        mockRedis
      );

      expect(result).toBe(4096);
    });

    it('should return null when the model is not in the cache', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify([]));

      const result = await getModelContextLength('unknown/model', mockRedis);

      expect(result).toBeNull();
    });

    it('should return null when Redis is unavailable and the model was never resolved', async () => {
      // The remaining hole: with nothing memoized there is no length to fall back
      // on, so a transient outage still yields null. The precondition matters —
      // after a prior successful resolve the memo answers instead (see below).
      vi.mocked(mockRedis.get).mockRejectedValue(new Error('Redis down'));

      const result = await getModelContextLength('openai/gpt-4o', mockRedis);

      expect(result).toBeNull();
    });

    describe('transient vs. absent catalog misses', () => {
      const CATALOG_MODEL = 'openai/gpt-4o';

      /** Resolve CATALOG_MODEL from a healthy catalog, populating both caches. */
      const resolveFromHealthyCatalog = async (): Promise<void> => {
        vi.mocked(mockRedis.get).mockResolvedValue(
          JSON.stringify([createMockModel(CATALOG_MODEL, ['text', 'image'])])
        );
        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBe(4096);
      };

      /**
       * Push CATALOG_MODEL out of the 5-minute capability cache while leaving the
       * 24h context-length memo intact. clearCapabilityCache() clears both by
       * design, and vitest's fake timers do not reach TTLCache's clock (probed:
       * a value survived a 10-minute advance), so LRU pressure is the lever —
       * the capability cache holds 500 entries and catalog-absent lookups fill it.
       */
      const evictFromCapabilityCache = async (): Promise<void> => {
        vi.mocked(mockRedis.get).mockResolvedValue('[]');
        for (let i = 0; i < 500; i++) {
          await getModelContextLength(`filler/model-${i}`, mockRedis);
        }
      };

      /** Read CATALOG_MODEL and assert the read actually reached Redis. */
      const readExpectingRedisCall = async (): Promise<number | null> => {
        const before = vi.mocked(mockRedis.get).mock.calls.length;
        const result = await getModelContextLength(CATALOG_MODEL, mockRedis);
        expect(vi.mocked(mockRedis.get).mock.calls.length).toBe(before + 1);
        return result;
      };

      it('falls back to the memoized length when the catalog key is missing', async () => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();

        vi.mocked(mockRedis.get).mockResolvedValue(null);

        expect(await readExpectingRedisCall()).toBe(4096);
      });

      it('falls back to the memoized length when the catalog payload is unparseable', async () => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();

        vi.mocked(mockRedis.get).mockResolvedValue('{not json');

        expect(await readExpectingRedisCall()).toBe(4096);
      });

      it('falls back to the memoized length when Redis throws', async () => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();

        vi.mocked(mockRedis.get).mockRejectedValue(new Error('Redis down'));

        expect(await readExpectingRedisCall()).toBe(4096);
      });

      it.each([
        ['an unparseable payload', '{not json'],
        ['a Redis throw', null],
      ])('emits exactly one warn for %s, carrying the cause', async (_label, payload) => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();
        mockLogger.warn.mockClear();

        if (payload === null) {
          vi.mocked(mockRedis.get).mockRejectedValue(new Error('Redis down'));
        } else {
          vi.mocked(mockRedis.get).mockResolvedValue(payload);
        }
        await getModelContextLength(CATALOG_MODEL, mockRedis);

        // resolveFromRedis used to warn too, so the same failure logged twice.
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.anything(), hasMemoizedContextLength: true }),
          expect.stringContaining('degraded capability data')
        );
      });

      it('does not cache a transient miss — the next read retries Redis', async () => {
        vi.mocked(mockRedis.get).mockResolvedValue(null);
        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledTimes(1);

        // Redis recovers well inside the 5-minute capability TTL: the fresh
        // catalog value must win, which it only can if the miss was not cached.
        vi.mocked(mockRedis.get).mockResolvedValue(
          JSON.stringify([createMockModel(CATALOG_MODEL, ['text', 'image'])])
        );
        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBe(4096);
        expect(mockRedis.get).toHaveBeenCalledTimes(2);
      });

      it('caches an absent result — a loaded catalog settles the question', async () => {
        vi.mocked(mockRedis.get).mockResolvedValue(
          JSON.stringify([createMockModel('some-other-model', ['text'])])
        );

        expect(await getModelContextLength('unknown/model', mockRedis)).toBeNull();
        expect(await getModelContextLength('unknown/model', mockRedis)).toBeNull();
        expect(mockRedis.get).toHaveBeenCalledTimes(1);
      });

      it('warns about degraded data on a transient miss with nothing memoized', async () => {
        vi.mocked(mockRedis.get).mockResolvedValue(null);

        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBeNull();

        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            modelId: CATALOG_MODEL,
            contextLength: null,
            hasMemoizedContextLength: false,
          }),
          expect.stringContaining('degraded capability data')
        );
      });

      it('drops the memo once the catalog confirms the model is absent', async () => {
        await resolveFromHealthyCatalog();
        // Evict first, or the read below is answered from the capability cache
        // and never reaches the catalog at all.
        await evictFromCapabilityCache();

        // The catalog reloads without the model (deprecated or renamed). That is
        // a newer observation than the memo, so the memo must not survive it.
        vi.mocked(mockRedis.get).mockResolvedValue(
          JSON.stringify([createMockModel('some-other-model', ['text'])])
        );
        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBeNull();

        // That absent result is itself cached, so evict again to force the
        // transient path to consult the memo rather than the cached null.
        await evictFromCapabilityCache();
        vi.mocked(mockRedis.get).mockResolvedValue(null);

        // Without the invalidation this would still report the stale 4096.
        expect(await readExpectingRedisCall()).toBeNull();
      });

      it('drops the memo when a resolved entry carries no context length', async () => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();

        // OpenRouterModel declares context_length as a number, but the catalog
        // is parsed through an unchecked cast — so this is what a wire-level
        // null looks like by the time it reaches the memo.
        const nulled = {
          ...createMockModel(CATALOG_MODEL, ['text', 'image']),
          context_length: null,
        } as unknown as OpenRouterModel;
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify([nulled]));
        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBeNull();

        await evictFromCapabilityCache();
        vi.mocked(mockRedis.get).mockResolvedValue(null);

        // Without the else-branch delete this would report the stale 4096.
        expect(await readExpectingRedisCall()).toBeNull();
      });

      it('treats a missing context_length as unknown rather than leaking undefined', async () => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();

        // A field absent from the wire arrives as undefined, not null — it would
        // slip past every `!== null` guard and reach Math.floor(undefined * f).
        const { context_length: _dropped, ...withoutLength } = createMockModel(CATALOG_MODEL, [
          'text',
        ]);
        vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify([withoutLength]));

        expect(await getModelContextLength(CATALOG_MODEL, mockRedis)).toBeNull();

        await evictFromCapabilityCache();
        vi.mocked(mockRedis.get).mockResolvedValue(null);
        expect(await readExpectingRedisCall()).toBeNull();
      });

      it('reports the memo backstop in the warn when one is present', async () => {
        await resolveFromHealthyCatalog();
        await evictFromCapabilityCache();
        mockLogger.warn.mockClear();

        vi.mocked(mockRedis.get).mockResolvedValue(null);
        expect(await readExpectingRedisCall()).toBe(4096);

        // The boolean is what on-call triage reads to tell "clamp still correct"
        // from "running unclamped" — pin both of its states, not just false.
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            modelId: CATALOG_MODEL,
            contextLength: 4096,
            hasMemoizedContextLength: true,
          }),
          expect.stringContaining('degraded capability data')
        );
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

    it('should clear the context-length memo too', async () => {
      const models = [createMockModel('test-model', ['text'])];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));
      expect(await getModelContextLength('test-model', mockRedis)).toBe(4096);

      clearCapabilityCache();

      // A transient miss now has nothing to fall back on — if the memo had
      // survived the clear, this would still report 4096.
      vi.mocked(mockRedis.get).mockResolvedValue(null);
      expect(await getModelContextLength('test-model', mockRedis)).toBeNull();
    });
  });

  describe('isModelListed', () => {
    it('returns true for a model the catalog lists', async () => {
      const models = [createMockModel('google/gemma-3-27b-it', ['text'])];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

      expect(await isModelListed('google/gemma-3-27b-it', mockRedis)).toBe(true);
    });

    it('returns false when the catalog loaded but does not list the model', async () => {
      const models = [createMockModel('google/gemma-3-27b-it', ['text'])];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

      expect(await isModelListed('z-ai/glm-5.3', mockRedis)).toBe(false);
    });

    it('returns null when redis.get resolves null (catalog unavailable)', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue(null);

      expect(await isModelListed('any/model', mockRedis)).toBeNull();
    });

    it('returns null when redis.get resolves an empty string', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue('');

      expect(await isModelListed('any/model', mockRedis)).toBeNull();
    });

    it('returns null on unparseable JSON', async () => {
      vi.mocked(mockRedis.get).mockResolvedValue('{not json');

      expect(await isModelListed('any/model', mockRedis)).toBeNull();
    });

    it('returns null when redis.get rejects', async () => {
      vi.mocked(mockRedis.get).mockRejectedValue(new Error('connection lost'));

      expect(await isModelListed('any/model', mockRedis)).toBeNull();
    });

    it('resolves a :free-suffixed id against the unsuffixed catalog entry', async () => {
      const models = [createMockModel('x-ai/grok-4.1-fast', ['text'])];
      vi.mocked(mockRedis.get).mockResolvedValue(JSON.stringify(models));

      expect(await isModelListed('x-ai/grok-4.1-fast:free', mockRedis)).toBe(true);
    });
  });
});
