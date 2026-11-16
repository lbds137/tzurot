import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { OpenRouterModel, OpenRouterModelPricing } from '@tzurot/common-types/types/ai';
import {
  computeEstimatedCost,
  estimateDiagnosticCost,
  resolveTierPricing,
} from './diagnosticCost.js';
import type { OpenRouterModelCache } from './OpenRouterModelCache.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeModel(overrides: Partial<OpenRouterModel> = {}): OpenRouterModel {
  return {
    id: 'anthropic/claude-3.5-sonnet',
    canonical_slug: 'anthropic/claude-3.5-sonnet',
    hugging_face_id: null,
    name: 'Claude 3.5 Sonnet',
    created: 0,
    description: '',
    context_length: 200_000,
    architecture: {
      modality: 'text->text',
      input_modalities: ['text'],
      output_modalities: ['text'],
      tokenizer: 'Claude',
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
    top_provider: { context_length: 200_000, max_completion_tokens: 8192, is_moderated: true },
    per_request_limits: null,
    supported_parameters: [],
    ...overrides,
  } as OpenRouterModel;
}

function makePayload(overrides: Partial<DiagnosticPayload['llmResponse']> = {}): DiagnosticPayload {
  return {
    meta: {
      requestId: 'req-1',
      personalityId: 'p-1',
      personalityName: 'Test',
      userId: 'u-1',
      guildId: null,
      channelId: 'c-1',
      timestamp: '2026-09-21T00:00:00Z',
    },
    inputProcessing: {
      rawUserMessage: 'hi',
      attachmentDescriptions: [],
      voiceTranscript: null,
      referencedMessageIds: [],
      referencedMessagesContent: [],
      searchQuery: null,
    },
    memoryRetrieval: { memoriesFound: [], freshModeEnabled: false },
    tokenBudget: {
      contextWindowSize: 128000,
      systemPromptTokens: 500,
      memoryTokensUsed: 0,
      historyTokensUsed: 0,
      memoriesDropped: 0,
      historyMessagesDropped: 0,
    },
    assembledPrompt: { messages: [], totalTokenEstimate: 0 },
    llmConfig: { model: 'anthropic/claude-3.5-sonnet', provider: 'anthropic', allParams: {} },
    llmResponse: {
      rawContent: 'hello',
      finishReason: 'stop',
      promptTokens: 1000,
      completionTokens: 10000,
      modelUsed: 'anthropic/claude-3.5-sonnet',
      ...overrides,
    },
    postProcessing: {
      transformsApplied: [],
      duplicateDetected: false,
      thinkingExtracted: false,
      thinkingContent: null,
      artifactsStripped: [],
      finalContent: 'hello',
    },
    timing: { totalDurationMs: 100 },
  };
}

function makeCache(models: OpenRouterModel[]): OpenRouterModelCache {
  return { getModels: vi.fn().mockResolvedValue(models) } as unknown as OpenRouterModelCache;
}

describe('computeEstimatedCost', () => {
  it('computes exact USD products and per-million derivations for two-decade token counts', () => {
    const result = computeEstimatedCost({
      promptTokens: 1_000,
      completionTokens: 10_000,
      promptPricePerToken: 0.000003,
      completionPricePerToken: 0.000015,
      model: 'anthropic/claude-3.5-sonnet',
    });

    expect(result.promptUsd).toBeCloseTo(0.003, 10);
    expect(result.completionUsd).toBeCloseTo(0.15, 10);
    expect(result.totalUsd).toBeCloseTo(0.153, 10);
    expect(result.promptPricePerMillion).toBeCloseTo(3, 10);
    expect(result.completionPricePerMillion).toBeCloseTo(15, 10);
    expect(result.model).toBe('anthropic/claude-3.5-sonnet');
    expect(result.source).toBe('openrouter-list');
  });
});

describe('estimateDiagnosticCost', () => {
  it('returns null when the cache is undefined', async () => {
    const result = await estimateDiagnosticCost(
      undefined,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the row provider is not OpenRouter', async () => {
    const cache = makeCache([makeModel()]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.ZaiCoding,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
    expect(cache.getModels).not.toHaveBeenCalled();
  });

  it('returns null when the model is absent from the catalog', async () => {
    const cache = makeCache([makeModel({ id: 'some/other-model' })]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the prompt price is NaN', async () => {
    const cache = makeCache([makeModel({ pricing: { ...makeModel().pricing, prompt: 'n/a' } })]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the completion price is NaN', async () => {
    const cache = makeCache([
      makeModel({ pricing: { ...makeModel().pricing, completion: 'n/a' } }),
    ]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the prompt price is non-finite (Infinity)', async () => {
    const cache = makeCache([
      makeModel({ pricing: { ...makeModel().pricing, prompt: 'Infinity' } }),
    ]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
  });

  it('returns null when the completion price is negative', async () => {
    const cache = makeCache([
      makeModel({ pricing: { ...makeModel().pricing, completion: '-0.000001' } }),
    ]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).toBeNull();
  });

  it('returns null and short-circuits before the catalog lookup when routedModel is empty', async () => {
    const getModels = vi.fn();
    const cache = { getModels } as unknown as OpenRouterModelCache;
    const payload = makePayload({ routedModel: '', modelUsed: 'anthropic/claude-3.5-sonnet' });
    const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
    expect(result).toBeNull();
    expect(getModels).not.toHaveBeenCalled();
  });

  it('returns a zero-cost object (not null) when both prices are the string "0"', async () => {
    const cache = makeCache([
      makeModel({ pricing: { ...makeModel().pricing, prompt: '0', completion: '0' } }),
    ]);
    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );
    expect(result).not.toBeNull();
    expect(result?.totalUsd).toBe(0);
    expect(result?.promptUsd).toBe(0);
    expect(result?.completionUsd).toBe(0);
  });

  it('prices routedModel over modelUsed when both are present', async () => {
    const cache = makeCache([
      makeModel({
        id: 'routed/model',
        pricing: { ...makeModel().pricing, prompt: '0.000001', completion: '0.000002' },
      }),
    ]);
    const payload = makePayload({ routedModel: 'routed/model', modelUsed: 'requested/model' });
    const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
    expect(result?.model).toBe('routed/model');
  });

  it('fallback-served row (auth provider zai-coding) prices off the OpenRouter catalog', async () => {
    // The row's `provider` column is the SERVED provider (OpenRouter, from
    // an auto-promotion fallback swap), not the auth-resolved provider
    // (zai-coding) that dispatched the primary attempt — the gate above
    // reads that column, so a fallback-served row prices normally.
    const cache = makeCache([
      makeModel({
        id: 'z-ai/glm-5.1',
        pricing: { ...makeModel().pricing, prompt: '0.000002', completion: '0.000004' },
      }),
    ]);
    const payload = makePayload({
      modelUsed: 'glm-5.1',
      routedModel: 'z-ai/glm-5.1',
      promptTokens: 500,
      completionTokens: 1500,
    });

    const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');

    expect(result).not.toBeNull();
    expect(result?.model).toBe('z-ai/glm-5.1');
    expect(result?.totalUsd).toBeCloseTo(0.007, 10);
  });

  it('returns null when getModels() rejects, and logs the failure', async () => {
    const cache = {
      getModels: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as OpenRouterModelCache;

    const result = await estimateDiagnosticCost(
      cache,
      AIProvider.OpenRouter,
      makePayload(),
      'req-1'
    );

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  describe('malformed data payloads (no pricable llmResponse)', () => {
    beforeEach(() => {
      mockLogger.warn.mockClear();
    });

    it('returns null for an empty object', async () => {
      const cache = makeCache([makeModel()]);
      const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, {}, 'req-1');
      expect(result).toBeNull();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(cache.getModels).not.toHaveBeenCalled();
    });

    it.each([null, 'text', 7, []])('returns null for a non-object payload (%j)', async payload => {
      const cache = makeCache([makeModel()]);
      const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
      expect(result).toBeNull();
      expect(cache.getModels).not.toHaveBeenCalled();
    });

    it('returns null for a legacy payload with only a meta field', async () => {
      const cache = makeCache([makeModel()]);
      const result = await estimateDiagnosticCost(
        cache,
        AIProvider.OpenRouter,
        { meta: {} },
        'req-1'
      );
      expect(result).toBeNull();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(cache.getModels).not.toHaveBeenCalled();
    });

    it('returns null when llmResponse token counts are not numbers', async () => {
      const cache = makeCache([makeModel()]);
      const result = await estimateDiagnosticCost(
        cache,
        AIProvider.OpenRouter,
        { llmResponse: { promptTokens: 'x' } },
        'req-1'
      );
      expect(result).toBeNull();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(cache.getModels).not.toHaveBeenCalled();
    });

    it('returns null and short-circuits before the catalog lookup when promptTokens is negative', async () => {
      const cache = makeCache([makeModel()]);
      const payload = makePayload({ promptTokens: -1 });
      const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
      expect(result).toBeNull();
      expect(cache.getModels).not.toHaveBeenCalled();
    });

    it('returns null when completionTokens is negative', async () => {
      const cache = makeCache([makeModel()]);
      const payload = makePayload({ promptTokens: 1000, completionTokens: -5 });
      const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
      expect(result).toBeNull();
      expect(cache.getModels).not.toHaveBeenCalled();
    });

    it('returns a zero-cost object (not null) when both token counts are zero', async () => {
      const cache = makeCache([makeModel()]);
      const payload = makePayload({ promptTokens: 0, completionTokens: 0 });
      const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
      expect(result).not.toBeNull();
      expect(result?.totalUsd).toBe(0);
      expect(result?.promptUsd).toBe(0);
      expect(result?.completionUsd).toBe(0);
    });
  });
});

const HAIKU_PRICING = {
  prompt: '0.0000001',
  completion: '0.0000005',
  web_search: '0.01',
  input_cache_read: '0.00000001',
  input_cache_write: '0.000000125',
  input_cache_write_1h: '0.0000002',
  overrides: [
    {
      min_prompt_tokens: 100000,
      prompt: '0.0000005',
      completion: '0.0000025',
      input_cache_read: '0.00000005',
      input_cache_write: '0.000000625',
      input_cache_write_1h: '0.000001',
    },
  ],
} satisfies OpenRouterModelPricing;

const GLM_PRICING = {
  prompt: '0.0000000699',
  completion: '0.0000014',
  input_cache_read: '0.0000000689',
} satisfies OpenRouterModelPricing;

async function estimate(
  id: string,
  pricing: OpenRouterModelPricing,
  llmResponse: Record<string, unknown>
) {
  const cache = makeCache([makeModel({ id, pricing })]);
  const payload = makePayload({ modelUsed: id, ...llmResponse } as never);
  return estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
}

describe('cache-aware pricing', () => {
  const HAIKU = 'anthropic/claude-haiku-5.5';

  it('T1 prices the worked example at read, write (1h) and uncached rates', async () => {
    const result = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 13_613,
      completionTokens: 212,
      cachedPromptTokens: 9_334,
      cachedWriteTokens: 77,
    });
    expect(result?.totalUsd).toBeCloseTo(0.000635, 6);
    expect(result?.cache?.noCacheTotalUsd).toBeCloseTo(0.0014673, 9);
    expect(result?.cache?.writeTtl).toBe('1h');
    expect(result?.cache?.uncachedPromptUsd).toBeCloseTo(4_202 * 1e-7, 12);
    expect(result?.cache?.readUsd).toBeCloseTo(9_334 * 1e-8, 12);
    expect(result?.cache?.writeUsd).toBeCloseTo(77 * 2e-7, 12);
    expect(result?.promptPricePerMillion).toBeCloseTo(0.1, 9);
  });

  it('T2 falls back to cache: null when writes exist but the model has no write price', async () => {
    const result = await estimate('z-ai/glm-5.3', GLM_PRICING, {
      promptTokens: 1_000,
      completionTokens: 100,
      cachedPromptTokens: 500,
      cachedWriteTokens: 50,
    });
    expect(result?.cache).toBeNull();
    expect(result?.promptUsd).toBeCloseTo(1_000 * 0.0000000699, 12);
    expect(result?.totalUsd).toBeCloseTo(1_000 * 0.0000000699 + 100 * 0.0000014, 12);
  });

  it('T3 prices reads only when the model has a read price and no writes', async () => {
    const result = await estimate('z-ai/glm-5.3', GLM_PRICING, {
      promptTokens: 1_000,
      completionTokens: 100,
      cachedPromptTokens: 600,
      cachedWriteTokens: 0,
    });
    expect(result?.cache).not.toBeNull();
    expect(result?.cache?.writeUsd).toBe(0);
    expect(result?.cache?.readUsd).toBeCloseTo(600 * 0.0000000689, 12);
    expect(result?.cache?.uncachedPromptUsd).toBeCloseTo(400 * 0.0000000699, 12);
    expect(result?.cache?.writeTtl).toBe('5m');
  });

  it('prices a read-only turn without any write price in the catalog', async () => {
    const readOnlyPricing = {
      prompt: '0.0000001',
      completion: '0.0000005',
      input_cache_read: '0.00000001',
    } satisfies OpenRouterModelPricing;
    const result = await estimate(HAIKU, readOnlyPricing, {
      promptTokens: 1_000,
      completionTokens: 100,
      cachedPromptTokens: 600,
      cachedWriteTokens: 0,
    });
    expect(result?.cache).not.toBeNull();
    expect(result?.cache?.readUsd).toBeCloseTo(600 * 0.00000001, 12);
    expect(result?.cache?.writeUsd).toBe(0);
  });

  it('T4 returns cache: null with today totals when cache counts are absent or both zero', async () => {
    const absent = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 1_000,
      completionTokens: 100,
    });
    const zero = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 1_000,
      completionTokens: 100,
      cachedPromptTokens: 0,
      cachedWriteTokens: 0,
    });
    expect(absent?.cache).toBeNull();
    expect(zero?.cache).toBeNull();
    expect(absent?.totalUsd).toBeCloseTo(1_000 * 1e-7 + 100 * 5e-7, 12);
    expect(zero?.totalUsd).toBeCloseTo(absent?.totalUsd ?? NaN, 12);
  });

  it('T5 does not clamp: read + write above the prompt count gives cache: null', async () => {
    const result = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 1_000,
      completionTokens: 100,
      cachedPromptTokens: 900,
      cachedWriteTokens: 200,
    });
    expect(result?.cache).toBeNull();
    expect(result?.promptUsd).toBeCloseTo(1_000 * 1e-7, 12);
  });

  it('T6 applies the tier strictly above its threshold, to prompt, completion and cache prices', async () => {
    const above = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 150_000,
      completionTokens: 1_000,
      cachedPromptTokens: 100_000,
      cachedWriteTokens: 1_000,
    });
    expect(above?.promptPricePerMillion).toBeCloseTo(0.5, 9);
    expect(above?.completionPricePerMillion).toBeCloseTo(2.5, 9);
    expect(above?.cache?.uncachedPromptUsd).toBeCloseTo(49_000 * 5e-7, 9);
    expect(above?.cache?.readUsd).toBeCloseTo(100_000 * 5e-8, 9);
    expect(above?.cache?.writeUsd).toBeCloseTo(1_000 * 1e-6, 9);

    const exactly = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 100_000,
      completionTokens: 1_000,
    });
    expect(exactly?.promptPricePerMillion).toBeCloseTo(0.1, 9);
    expect(exactly?.completionPricePerMillion).toBeCloseTo(0.5, 9);
  });

  it('T6b picks the largest matching threshold and lets absent keys inherit the base', () => {
    const resolved = resolveTierPricing(
      {
        prompt: '1',
        completion: '2',
        input_cache_read: '3',
        overrides: [
          { min_prompt_tokens: 100, prompt: '10' },
          { min_prompt_tokens: 1_000, prompt: '100' },
          { min_prompt_tokens: 10_000, prompt: '1000' },
        ],
      } satisfies OpenRouterModelPricing,
      5_000
    );
    expect(resolved.prompt).toBe('100');
    expect(resolved.completion).toBe('2');
    expect(resolved.input_cache_read).toBe('3');
  });

  it('T7 ignores an override entry carrying an unknown condition key', () => {
    const pricing = {
      prompt: '1',
      completion: '2',
      overrides: [{ min_prompt_tokens: 10, prompt: '99', region: 'eu' }],
    } as unknown as OpenRouterModelPricing;
    expect(resolveTierPricing(pricing, 1_000).prompt).toBe('1');
  });

  it('ignores non-object override entries without failing the lookup', () => {
    const pricing = {
      prompt: '1',
      completion: '2',
      overrides: [null, 'x', 5, [], { min_prompt_tokens: 10, prompt: '7' }],
    } as unknown as OpenRouterModelPricing;
    expect(resolveTierPricing(pricing, 1_000).prompt).toBe('7');
  });

  it('applies a tier entry that also reprices a non-cache catalog key (image)', () => {
    const pricing = {
      prompt: '1',
      completion: '2',
      overrides: [{ min_prompt_tokens: 100_000, prompt: '5', image: '9' }],
    } as unknown as OpenRouterModelPricing;
    expect(resolveTierPricing(pricing, 150_000).prompt).toBe('5');
    expect(resolveTierPricing(pricing, 50_000).prompt).toBe('1');
  });

  it('applies a tier entry carrying an unmodelled string price key (audio)', () => {
    const pricing = {
      prompt: '1',
      completion: '2',
      overrides: [{ min_prompt_tokens: 100_000, prompt: '5', audio: '0.00001' }],
    } as unknown as OpenRouterModelPricing;
    expect(resolveTierPricing(pricing, 150_000).prompt).toBe('5');
  });

  it('ignores a tier entry with a max_ condition key', () => {
    const pricing = {
      prompt: '1',
      completion: '2',
      overrides: [{ min_prompt_tokens: 100_000, max_prompt_tokens: 500_000, prompt: '5' }],
    } as unknown as OpenRouterModelPricing;
    expect(resolveTierPricing(pricing, 150_000).prompt).toBe('1');
  });

  it('ignores a tier entry carrying an object-valued key', () => {
    const pricing = {
      prompt: '1',
      completion: '2',
      overrides: [{ min_prompt_tokens: 100_000, prompt: '5', region: { eu: true } }],
    } as unknown as OpenRouterModelPricing;
    expect(resolveTierPricing(pricing, 150_000).prompt).toBe('1');
  });

  it('keys the write TTL on the requested id, not the routed one', async () => {
    const routed = 'anthropic/claude-haiku-5.5';
    const cache = makeCache([makeModel({ id: routed, pricing: HAIKU_PRICING })]);
    const payload = makePayload({
      modelUsed: 'openrouter/auto',
      routedModel: routed,
      promptTokens: 1_000,
      completionTokens: 10,
      cachedPromptTokens: 0,
      cachedWriteTokens: 100,
    });
    const result = await estimateDiagnosticCost(cache, AIProvider.OpenRouter, payload, 'req-1');
    expect(result?.cache?.writeTtl).toBe('5m');
  });

  it('T8 prices a non-anthropic model at the default input_cache_write with writeTtl 5m', async () => {
    const result = await estimate(
      'openai/some-model',
      {
        prompt: '0.000001',
        completion: '0.000002',
        input_cache_read: '0.0000001',
        input_cache_write: '0.0000012',
        input_cache_write_1h: '0.9',
      } satisfies OpenRouterModelPricing,
      { promptTokens: 1_000, completionTokens: 10, cachedPromptTokens: 0, cachedWriteTokens: 100 }
    );
    expect(result?.cache?.writeTtl).toBe('5m');
    expect(result?.cache?.writeUsd).toBeCloseTo(100 * 0.0000012, 12);
  });

  it.each([
    ['negative', -1],
    ['string', '9334'],
  ])('T9 returns null when cachedPromptTokens is %s', async (_label, bad) => {
    const result = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 1_000,
      completionTokens: 10,
      cachedPromptTokens: bad,
    });
    expect(result).toBeNull();
  });

  it('T9b returns null when cachedWriteTokens is invalid', async () => {
    const result = await estimate(HAIKU, HAIKU_PRICING, {
      promptTokens: 1_000,
      completionTokens: 10,
      cachedWriteTokens: Number.NaN,
    });
    expect(result).toBeNull();
  });

  it.each([
    ['negative', { ...HAIKU_PRICING, input_cache_read: '-0.1' }],
    ['unparseable', { ...HAIKU_PRICING, input_cache_read: 'n/a' }],
  ])(
    'T10 a %s cache price disables cache pricing but still returns the estimate',
    async (_l, pricing) => {
      const result = await estimate(HAIKU, pricing, {
        promptTokens: 1_000,
        completionTokens: 100,
        cachedPromptTokens: 500,
      });
      expect(result).not.toBeNull();
      expect(result?.cache).toBeNull();
      expect(result?.totalUsd).toBeCloseTo(1_000 * 1e-7 + 100 * 5e-7, 12);
    }
  );
});

describe('cache-aware pricing edge cases', () => {
  const HAIKU = 'anthropic/claude-haiku-5.5';

  it('an anthropic id whose catalog lacks the 1h write price gets cache: null, not the 5m price', async () => {
    const { input_cache_write_1h: _omitted, ...withoutOneHour } = HAIKU_PRICING;
    const result = await estimate(
      HAIKU,
      { ...withoutOneHour, overrides: [] } satisfies OpenRouterModelPricing,
      {
        promptTokens: 1_000,
        completionTokens: 100,
        cachedPromptTokens: 400,
        cachedWriteTokens: 50,
      }
    );
    expect(result).not.toBeNull();
    expect(result?.cache).toBeNull();
    expect(result?.promptUsd).toBeCloseTo(1_000 * 1e-7, 12);
  });

  it('treats a mixed-case anthropic id as anthropic: 1h write TTL', async () => {
    const result = await estimate('Anthropic/Claude-Haiku-5.5', HAIKU_PRICING, {
      promptTokens: 1_000,
      completionTokens: 100,
      cachedPromptTokens: 400,
      cachedWriteTokens: 50,
    });
    expect(result?.cache?.writeTtl).toBe('1h');
    expect(result?.cache?.writeUsd).toBeCloseTo(50 * 2e-7, 12);
  });

  it('applies the tier to prompt and completion on the cache: null path (no read price anywhere)', async () => {
    const { input_cache_read: _read, ...base } = HAIKU_PRICING;
    const result = await estimate(
      HAIKU,
      {
        ...base,
        overrides: [{ min_prompt_tokens: 100_000, prompt: '0.0000005', completion: '0.0000025' }],
      } satisfies OpenRouterModelPricing,
      {
        promptTokens: 150_000,
        completionTokens: 1_000,
        cachedPromptTokens: 100_000,
        cachedWriteTokens: 0,
      }
    );
    expect(result?.cache).toBeNull();
    expect(result?.promptPricePerMillion).toBeCloseTo(0.5, 9);
    expect(result?.completionPricePerMillion).toBeCloseTo(2.5, 9);
    expect(result?.promptUsd).toBeCloseTo(150_000 * 5e-7, 9);
  });

  it('a tier entry with a null price does not overwrite the base price', async () => {
    const pricing = {
      prompt: '0.000001',
      completion: '0.000002',
      overrides: [{ min_prompt_tokens: 100, prompt: null, completion: '0.000009' }],
    } as unknown as OpenRouterModelPricing;
    const resolved = resolveTierPricing(pricing, 1_000);
    expect(resolved.prompt).toBe('0.000001');
    expect(resolved.completion).toBe('0.000009');

    const result = await estimate('openai/some-model', pricing, {
      promptTokens: 1_000,
      completionTokens: 10,
    });
    expect(result?.promptPricePerMillion).toBeCloseTo(1, 9);
    expect(result?.completionPricePerMillion).toBeCloseTo(9, 9);
  });

  it('yields a nonzero float-noise delta when read and write prices equal the prompt price', () => {
    // The bot-client caveat treats |delta| within 1e-9 of the total as zero;
    // this pins that the noise it guards against really comes out of the math.
    const price = 2.5e-6;
    const result = computeEstimatedCost({
      promptTokens: 54_321,
      completionTokens: 0,
      promptPricePerToken: price,
      completionPricePerToken: price,
      model: 'm',
      cachedReadTokens: 12_345,
      cachedWriteTokens: 6_789,
      cacheReadPricePerToken: price,
      cacheWritePricePerToken: price,
    });
    const delta = (result.cache?.noCacheTotalUsd ?? NaN) - result.totalUsd;
    expect(delta).not.toBe(0);
    expect(Math.abs(delta)).toBeLessThan(1e-9 * result.totalUsd);
  });
});

describe('computeEstimatedCost cache arithmetic', () => {
  it('derives totals from the parts and noCacheTotalUsd from the prompt rate', () => {
    const result = computeEstimatedCost({
      promptTokens: 1_000,
      completionTokens: 100,
      promptPricePerToken: 1e-6,
      completionPricePerToken: 2e-6,
      model: 'm',
      cachedReadTokens: 600,
      cachedWriteTokens: 100,
      cacheReadPricePerToken: 1e-7,
      cacheWritePricePerToken: 2e-6,
      cacheWriteTtl: '1h',
    });
    expect(result.cache?.uncachedPromptUsd).toBeCloseTo(300e-6, 12);
    expect(result.promptUsd).toBeCloseTo(300e-6 + 60e-6 + 200e-6, 12);
    expect(result.totalUsd).toBeCloseTo(result.promptUsd + 200e-6, 12);
    expect(result.cache?.noCacheTotalUsd).toBeCloseTo(1_000e-6 + 200e-6, 12);
  });
});
