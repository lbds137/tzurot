import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { DiagnosticPayload } from '@tzurot/common-types/types/diagnostic';
import type { OpenRouterModel } from '@tzurot/common-types/types/ai';
import { computeEstimatedCost, estimateDiagnosticCost } from './diagnosticCost.js';
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
