/**
 * Tests for Model Factory
 *
 * These tests verify that all LLM sampling parameters are correctly passed
 * to the ChatOpenAI constructor when creating models.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';

// Mock @langchain/openai - use vi.hoisted for top-level mock reference
const { mockChatOpenAI, mockConfigData } = vi.hoisted(() => ({
  mockChatOpenAI: vi.fn(),
  mockConfigData: {
    AI_PROVIDER: 'openrouter' as string,
    OPENROUTER_API_KEY: 'test-openrouter-key',
    OPENROUTER_APP_TITLE: undefined as string | undefined,
    OPENROUTER_APP_URL: undefined as string | undefined,
  },
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: mockChatOpenAI,
}));

// Mock @tzurot/common-types
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => mockConfigData,
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
    AI_DEFAULTS: {
      MAX_TOKENS: 4096,
      REASONING_MODEL_MAX_TOKENS: {
        max: 65536,
        high: 32768,
        medium: 16384,
        low: 8192,
        minimal: 6144,
        off: 4096,
      },
    },
    AI_ENDPOINTS: {
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      ZAI_CODING_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
    },
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

// Mock reasoningModelUtils - control isReasoningModel per test
const mockIsReasoningModel = vi.fn().mockReturnValue(false);
vi.mock('../utils/reasoningModelUtils.js', () => ({
  isReasoningModel: (modelName: string) => mockIsReasoningModel(modelName),
}));

import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  AdvancedParamsSchema,
  THINKING_LEVELS,
  type AdvancedParams,
} from '@tzurot/common-types/schemas/llmAdvancedParams';
import {
  createChatModel,
  isZaiSupportedParam,
  ZAI_PARAM_DISPOSITIONS,
  type ModelConfig,
} from './ModelFactory.js';

describe('ModelFactory', () => {
  beforeEach(() => {
    mockChatOpenAI.mockClear();
    mockIsReasoningModel.mockClear();
    mockIsReasoningModel.mockReturnValue(false); // Default: not a reasoning model
    mockConfigData.AI_PROVIDER = 'openrouter'; // Reset per test
    mockConfigData.OPENROUTER_APP_TITLE = undefined; // Reset per test
    mockConfigData.OPENROUTER_APP_URL = undefined; // Reset per test
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createChatModel', () => {
    it('should pass basic parameters to ChatOpenAI', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        apiKey: 'test-api-key',
        temperature: 0.8,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'test-model',
          apiKey: 'test-api-key',
          temperature: 0.8,
        })
      );
    });

    it('an absent modelName falls back to the LIVE fallbackTextModel setting (divergent-from-fallback value)', () => {
      registerSystemSettings({
        get: (key: string) => (key === 'fallbackTextModel' ? 'divergent/text-model' : undefined),
      } as unknown as SystemSettingsService);
      try {
        createChatModel({ apiKey: 'k' } as ModelConfig);
        expect(mockChatOpenAI).toHaveBeenCalledWith(
          expect.objectContaining({ modelName: 'divergent/text-model' })
        );
      } finally {
        resetSystemSettingsRegistration();
      }
    });

    it('disables SDK-internal retries so 429s surface to the LLMInvoker ladder immediately', () => {
      // During a free-pool 429 storm the SDK's own retry loop absorbed 429s
      // inside the per-attempt budget until OUR abort fired — the failure then
      // classified TIMEOUT and bypassed the quota retarget.
      createChatModel({ modelName: 'test-model', apiKey: 'k' });

      expect(mockChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    });

    it('should always set __includeRawResponse:true so the OpenRouter reasoning extractor has access to the raw API response', () => {
      // Required for extractAndPopulateOpenRouterReasoning() in LLMInvoker to read
      // additional_kwargs.__raw_response. If this assertion ever fails, also check
      // the canary test extractOpenRouterReasoning.canary.test.ts which exercises
      // the LangChain end of the same contract.
      const config: ModelConfig = {
        modelName: 'test-model',
        apiKey: 'test-api-key',
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ __includeRawResponse: true })
      );
    });

    it('should pass topP to ChatOpenAI', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        topP: 0.95,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          topP: 0.95,
        })
      );
    });

    it('should pass frequencyPenalty to ChatOpenAI', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        frequencyPenalty: 0.5,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          frequencyPenalty: 0.5,
        })
      );
    });

    it('should pass presencePenalty to ChatOpenAI', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        presencePenalty: 0.3,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          presencePenalty: 0.3,
        })
      );
    });

    it('should pass maxTokens to ChatOpenAI', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        maxTokens: 4096,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTokens: 4096,
        })
      );
    });

    it('should pass topK via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        topK: 40,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            top_k: 40,
          }),
        })
      );
    });

    it('should pass repetitionPenalty via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        repetitionPenalty: 1.1,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            repetition_penalty: 1.1,
          }),
        })
      );
    });

    it('should pass all sampling parameters together', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        apiKey: 'test-key',
        temperature: 0.8,
        topP: 0.95,
        topK: 40,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        repetitionPenalty: 1.1,
        maxTokens: 4096,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'test-model',
          apiKey: 'test-key',
          temperature: 0.8,
          topP: 0.95,
          frequencyPenalty: 0.5,
          presencePenalty: 0.3,
          maxTokens: 4096,
          modelKwargs: expect.objectContaining({
            top_k: 40,
            repetition_penalty: 1.1,
          }),
        })
      );
    });

    it('should pass undefined temperature when not provided (let model decide)', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
      };

      createChatModel(config);

      // Temperature should be undefined, not defaulted
      // Different models have different optimal defaults (reasoning models need specific temps)
      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.temperature).toBeUndefined();
    });

    it('should not include modelKwargs when topK and repetitionPenalty are undefined', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        temperature: 0.8,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0];
      expect(callArgs.modelKwargs).toBeUndefined();
    });

    it('should include OpenRouter base URL configuration', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
          },
        })
      );
    });

    // ===================================
    // Advanced sampling parameters
    // ===================================

    it('should pass minP via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        minP: 0.1,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            min_p: 0.1,
          }),
        })
      );
    });

    it('should pass topA via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        topA: 0.5,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            top_a: 0.5,
          }),
        })
      );
    });

    it('should pass seed via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        seed: 12345,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            seed: 12345,
          }),
        })
      );
    });

    // ===================================
    // Output control parameters
    // ===================================

    it('should pass logitBias via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        logitBias: { '1234': 50, '5678': -50 },
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            logit_bias: { '1234': 50, '5678': -50 },
          }),
        })
      );
    });

    it('should pass responseFormat via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        responseFormat: { type: 'json_object' },
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            response_format: { type: 'json_object' },
          }),
        })
      );
    });

    // ===================================
    // Thinking level → OpenRouter reasoning translation
    // ===================================

    it.each([
      ['minimal', 'minimal'],
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
      ['max', 'max'],
    ] as const)('translates thinking=%s to reasoning.effort=%s', (thinking, effort) => {
      createChatModel({ modelName: 'test-model', thinking });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      expect(callArgs?.modelKwargs?.reasoning).toEqual({ effort });

      // Custom fetch needed for response interception (LangChain drops reasoning from responses)
      expect(callArgs?.configuration?.fetch).toBeDefined();
    });

    it("translates thinking=off to OpenRouter's effort=none", () => {
      createChatModel({ modelName: 'test-model', thinking: 'off' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
      };

      expect(callArgs?.modelKwargs?.reasoning).toEqual({ effort: 'none' });
    });

    it('sends no reasoning object at all when the level is absent (provider default)', () => {
      createChatModel({ modelName: 'test-model', temperature: 0.7 });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      expect(callArgs?.modelKwargs?.reasoning).toBeUndefined();
      expect(callArgs?.configuration?.fetch).toBeUndefined();
    });

    it('never sends exclude — both providers default to returning the trace', () => {
      createChatModel({ modelName: 'test-model', thinking: 'high' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
      };

      expect(callArgs?.modelKwargs?.reasoning).not.toHaveProperty('exclude');
      expect(callArgs?.modelKwargs?.reasoning).not.toHaveProperty('enabled');
    });

    // ===================================
    // OpenRouter-specific parameters (via custom fetch)
    // ===================================

    it('should use custom fetch for a thinking config (needed for response interception)', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        thinking: 'medium',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      // reasoning goes in modelKwargs AND custom fetch intercepts responses
      expect(callArgs?.modelKwargs?.reasoning).toEqual({ effort: 'medium' });
      expect(callArgs?.configuration?.fetch).toBeDefined();
    });

    it('should use custom fetch for transforms', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        transforms: ['middle-out'],
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { fetch?: unknown };
      };

      // transforms injected via custom fetch
      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
    });

    it('should use custom fetch for route', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        route: 'fallback',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { fetch?: unknown };
      };

      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
    });

    it('should use custom fetch for verbosity', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        verbosity: 'low',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { fetch?: unknown };
      };

      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
    });

    it('should pass all advanced parameters together', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        // Advanced sampling
        minP: 0.1,
        topA: 0.5,
        seed: 42,
        // Output
        responseFormat: { type: 'text' },
        // Thinking level
        thinking: 'high',
        // OpenRouter
        transforms: ['middle-out'],
        route: 'fallback',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      // Standard params in modelKwargs
      expect(callArgs?.modelKwargs).toEqual({
        min_p: 0.1,
        top_a: 0.5,
        seed: 42,
        response_format: { type: 'text' },
        reasoning: { effort: 'high' },
      });

      // OpenRouter-specific params (transforms, route) injected via custom fetch
      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
    });
  });

  // ===================================
  // Restricted parameter filtering
  // ===================================

  describe('restricted parameter filtering', () => {
    it('should filter frequencyPenalty for GLM 4.5 Air', () => {
      const config: ModelConfig = {
        modelName: 'z-ai/glm-4.5-air:free',
        frequencyPenalty: 0.5,
        temperature: 0.9,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.frequencyPenalty).toBeUndefined();
      expect(callArgs.temperature).toBe(0.9); // Other params preserved
    });

    it('should filter presencePenalty for GLM 4.5 Air', () => {
      const config: ModelConfig = {
        modelName: 'z-ai/glm-4.5-air:free',
        presencePenalty: 0.3,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.presencePenalty).toBeUndefined();
    });

    it('should filter seed and topK from modelKwargs for GLM 4.5 Air', () => {
      const config: ModelConfig = {
        modelName: 'z-ai/glm-4.5-air:free',
        seed: 42,
        topK: 40,
        topP: 0.95, // top_p IS supported by Z.AI
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      const kwargs = callArgs.modelKwargs as Record<string, unknown> | undefined;
      expect(kwargs?.seed).toBeUndefined();
      expect(kwargs?.top_k).toBeUndefined();
      expect(callArgs.topP).toBe(0.95); // Supported param preserved
    });

    it('should preserve all params for non-restricted models', () => {
      const config: ModelConfig = {
        modelName: 'anthropic/claude-sonnet-4.5',
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.frequencyPenalty).toBe(0.5);
      expect(callArgs.presencePenalty).toBe(0.3);
      const kwargs = callArgs.modelKwargs as Record<string, unknown>;
      expect(kwargs.seed).toBe(42);
    });

    it('should filter multiple unsupported params at once for GLM 4.5 Air', () => {
      const config: ModelConfig = {
        modelName: 'z-ai/glm-4.5-air:free',
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topP: 0.95,
        topK: 40,
        repetitionPenalty: 1.05,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      // Unsupported params filtered (per Z.AI docs)
      expect(callArgs.frequencyPenalty).toBeUndefined();
      expect(callArgs.presencePenalty).toBeUndefined();
      // Supported params preserved
      expect(callArgs.topP).toBe(0.95);
      // All modelKwargs params were unsupported, so modelKwargs is omitted entirely
      expect(callArgs.modelKwargs).toBeUndefined();
    });

    it('should apply provider-tier z.ai-direct filter to ALL models (not just glm-4.5-air)', () => {
      // Critical: when routing direct to z.ai, the strict supported-params list
      // applies regardless of which GLM variant. glm-4.7 via OpenRouter would
      // pass these params; glm-4.7 direct-to-z.ai would 400. The provider-tier
      // filter handles this without needing one regex per model.
      const config: ModelConfig = {
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        apiKey: 'zai-key',
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        seed: 42,
        topK: 40,
        topP: 0.95,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.frequencyPenalty).toBeUndefined();
      expect(callArgs.presencePenalty).toBeUndefined();
      expect(callArgs.topP).toBe(0.95); // top_p is supported by z.ai
      const kwargs = callArgs.modelKwargs as Record<string, unknown> | undefined;
      expect(kwargs?.seed).toBeUndefined();
      expect(kwargs?.top_k).toBeUndefined();
    });

    it('should NOT apply z.ai-direct filter when route is OpenRouter (even for glm-4.7)', () => {
      // Inverse of the previous test: same model name routed via OpenRouter
      // does NOT get the strict z.ai-tier filter — OpenRouter normalizes params.
      // Only the per-model RESTRICTED_PARAM_MODELS pattern applies (which doesn't
      // currently include glm-4.7).
      const config: ModelConfig = {
        modelName: 'z-ai/glm-4.7',
        // provider not set → uses env-level default (openrouter in this test)
        seed: 42,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      const kwargs = callArgs.modelKwargs as Record<string, unknown>;
      expect(kwargs.seed).toBe(42); // Preserved through OpenRouter
    });
  });

  // ===================================
  // maxTokens Scaling for Reasoning Models
  // ===================================

  describe('maxTokens scaling for reasoning models', () => {
    it('should use user-configured maxTokens when explicitly set (user override wins)', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        maxTokens: 8000,
        thinking: 'high',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(8000); // User override, not scaled
    });

    it('should scale maxTokens for reasoning models with medium effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        thinking: 'medium',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(16384); // Scaled for medium
    });

    it('should scale maxTokens for reasoning models with high effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'kimi/kimi-k2-thinking',
        thinking: 'high',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(32768); // Scaled for high effort
    });

    it('should scale maxTokens for reasoning models with low effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'openai/o1-preview',
        thinking: 'low',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(8192); // Scaled for low effort
    });

    it('should NOT scale maxTokens for standard models even with reasoning config', () => {
      mockIsReasoningModel.mockReturnValue(false); // Standard model

      const config: ModelConfig = {
        modelName: 'anthropic/claude-sonnet-4.5',
        thinking: 'high',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBeUndefined(); // Not scaled, API decides
    });

    it('should NOT scale maxTokens for reasoning models without effort config', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        // No thinking level set
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBeUndefined(); // Not scaled, API decides
    });

    it('should use the standard limit when thinking is off', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        thinking: 'off',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(4096); // Standard limit for 'off'
    });

    it('should scale maxTokens for the max level', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'openai/o1',
        thinking: 'max',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(65536); // Maximum for the max level
    });
  });

  // ===================================
  // Reasoning capability gate
  // ===================================

  describe('reasoning capability gate', () => {
    it('should skip reasoning params when supportsReasoning is false', () => {
      const config: ModelConfig = {
        modelName: 'meta-llama/llama-3-70b',
        thinking: 'high',
        supportsReasoning: false,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
      };
      // reasoning should NOT be in modelKwargs
      expect(callArgs?.modelKwargs?.reasoning).toBeUndefined();
    });

    it('should pass reasoning params when supportsReasoning is true', () => {
      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        thinking: 'high',
        supportsReasoning: true,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
      };
      expect(callArgs?.modelKwargs?.reasoning).toEqual({ effort: 'high' });
    });

    it('should pass reasoning params when supportsReasoning is undefined (backward compat)', () => {
      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        thinking: 'medium',
        // supportsReasoning not set
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
      };
      expect(callArgs?.modelKwargs?.reasoning).toEqual({ effort: 'medium' });
    });

    it('should not use custom fetch when reasoning is gated out', () => {
      const config: ModelConfig = {
        modelName: 'meta-llama/llama-3-70b',
        thinking: 'high',
        supportsReasoning: false,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { fetch?: unknown };
      };
      // No reasoning = no custom fetch needed (unless other params require it)
      expect(callArgs?.configuration?.fetch).toBeUndefined();
    });
  });

  // ===================================
  // App attribution headers
  // ===================================

  describe('app attribution headers', () => {
    it('should pass ASCII app title as X-Title header', () => {
      mockConfigData.OPENROUTER_APP_TITLE = 'MyBot';

      createChatModel({ modelName: 'test-model' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toEqual({ 'X-Title': 'MyBot' });
    });

    it('appends appTitleSuffix so background workloads attribute as a distinct app', () => {
      mockConfigData.OPENROUTER_APP_TITLE = 'MyBot';

      createChatModel({ modelName: 'test-model', appTitleSuffix: 'Extraction' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toEqual({ 'X-Title': 'MyBot Extraction' });
    });

    it('should strip non-Latin characters from X-Title header', () => {
      mockConfigData.OPENROUTER_APP_TITLE = 'צורות Bot';

      createChatModel({ modelName: 'test-model' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toEqual({ 'X-Title': 'Bot' });
    });

    it('should omit headers when title is entirely non-ASCII and no URL', () => {
      mockConfigData.OPENROUTER_APP_TITLE = 'צורות';

      createChatModel({ modelName: 'test-model' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toBeUndefined();
    });

    it('should not set headers when both config values are undefined', () => {
      mockConfigData.OPENROUTER_APP_TITLE = undefined;
      mockConfigData.OPENROUTER_APP_URL = undefined;

      createChatModel({ modelName: 'test-model' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toBeUndefined();
    });

    it('should set HTTP-Referer header when OPENROUTER_APP_URL is set', () => {
      mockConfigData.OPENROUTER_APP_URL = 'https://myapp.example.com';

      createChatModel({ modelName: 'test-model' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toEqual({
        'HTTP-Referer': 'https://myapp.example.com',
      });
    });

    it('should set both headers when both config values are set', () => {
      mockConfigData.OPENROUTER_APP_TITLE = 'MyBot';
      mockConfigData.OPENROUTER_APP_URL = 'https://myapp.example.com';

      createChatModel({ modelName: 'test-model' });

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { defaultHeaders?: Record<string, string> };
      };
      expect(callArgs?.configuration?.defaultHeaders).toEqual({
        'HTTP-Referer': 'https://myapp.example.com',
        'X-Title': 'MyBot',
      });
    });
  });

  // ===================================
  // Unsupported provider guard
  // ===================================

  describe('unsupported provider guard', () => {
    it('should throw when AI_PROVIDER is set to ElevenLabs (voice-only provider)', () => {
      mockConfigData.AI_PROVIDER = 'elevenlabs';

      expect(() => createChatModel({ modelName: 'test-model' })).toThrow(
        'ElevenLabs is a voice provider, not an LLM provider'
      );
    });
  });

  // ===================================
  // ZaiCoding provider branch
  // ===================================

  describe('ZaiCoding provider', () => {
    it('should use the z.ai coding-plan baseURL when provider is zai-coding', () => {
      const config: ModelConfig = {
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        apiKey: 'zai-user-key',
        temperature: 0.7,
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'glm-4.7',
          apiKey: 'zai-user-key',
          temperature: 0.7,
          // SDK-internal retries off here too — retries belong to the ladder.
          maxRetries: 0,
          configuration: expect.objectContaining({
            baseURL: 'https://api.z.ai/api/coding/paas/v4',
          }),
        })
      );
    });

    it('should override env-level AI_PROVIDER with per-request provider field', () => {
      // Env-level AI_PROVIDER is openrouter (default), but ModelConfig.provider
      // overrides it for this request. Required so a single-process worker can
      // route different requests to different providers.
      mockConfigData.AI_PROVIDER = 'openrouter';

      const config: ModelConfig = {
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        apiKey: 'zai-key',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      const configuration = callArgs.configuration as Record<string, unknown>;
      expect(configuration.baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
    });

    it('should throw when zai-coding has no apiKey (no system fallback)', () => {
      // Critical: z.ai has no system-level fallback key. Callers wanting
      // OpenRouter fallthrough on missing z.ai key must do that resolution
      // BEFORE createChatModel (PR 2: ProviderRouter).
      const config: ModelConfig = {
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        // No apiKey
      };

      expect(() => createChatModel(config)).toThrow(/z\.ai coding plan API key is required/);
    });

    it('should not include OpenRouter app-attribution headers on z.ai routes', () => {
      mockConfigData.OPENROUTER_APP_TITLE = 'TzurotBot';
      mockConfigData.OPENROUTER_APP_URL = 'https://tzurot.example.com';

      const config: ModelConfig = {
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        apiKey: 'zai-key',
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      const configuration = callArgs.configuration as Record<string, unknown>;
      expect(configuration.defaultHeaders).toBeUndefined();
    });
  });

  // ===================================
  // z.ai thinking translation
  // ===================================

  describe('z.ai thinking translation', () => {
    const zaiConfig = (overrides: Partial<ModelConfig> = {}): ModelConfig => ({
      modelName: 'glm-4.7',
      provider: AIProvider.ZaiCoding,
      apiKey: 'zai-key',
      ...overrides,
    });

    const kwargsFromLastCall = (): Record<string, unknown> | undefined => {
      const callArgs = mockChatOpenAI.mock.calls.at(-1)?.[0] as
        { modelKwargs?: Record<string, unknown> } | undefined;
      return callArgs?.modelKwargs;
    };

    it.each(['minimal', 'low', 'medium', 'high', 'max'] as const)(
      'sends z.ai enabled thinking + reasoning_effort=%s',
      thinking => {
        createChatModel(zaiConfig({ thinking }));

        expect(kwargsFromLastCall()).toEqual({
          thinking: { type: 'enabled' },
          reasoning_effort: thinking,
        });
      }
    );

    it('sends z.ai disabled thinking for off, with no effort', () => {
      createChatModel(zaiConfig({ thinking: 'off' }));

      expect(kwargsFromLastCall()).toEqual({ thinking: { type: 'disabled' } });
    });

    it('sends no thinking params at all when the level is absent', () => {
      createChatModel(zaiConfig());

      expect(kwargsFromLastCall()).toBeUndefined();
    });

    it('honors the supportsReasoning=false gate on the z.ai route too', () => {
      createChatModel(zaiConfig({ thinking: 'high', supportsReasoning: false }));

      expect(kwargsFromLastCall()).toBeUndefined();
    });

    // Regression pin for the false-advertising bug: the z.ai route used to be
    // handed OpenRouter's `reasoning` object, which z.ai accepts and silently
    // ignores — so a configured level ran at the provider default with no error.
    it.each([...THINKING_LEVELS, undefined])(
      'never sends a reasoning key to z.ai (level=%s)',
      thinking => {
        createChatModel(zaiConfig({ thinking }));

        expect(kwargsFromLastCall() ?? {}).not.toHaveProperty('reasoning');
      }
    );

    it('still sends OpenRouter the reasoning object for the same level', () => {
      // The inverse half: translation is provider-aware, not a blanket rename.
      createChatModel({ modelName: 'glm-4.7', thinking: 'high' });

      expect(kwargsFromLastCall()?.reasoning).toEqual({ effort: 'high' });
    });
  });

  // ===================================
  // z.ai param allowlist
  // ===================================

  describe('z.ai param allowlist', () => {
    it('drops a modelKwargs param that is absent from the allowlist', () => {
      // logit_bias is outside z.ai's supported set, so the allowlist strips it
      // — the allow-mode arm of the filter, exercised via a real schema param.
      createChatModel({
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        apiKey: 'zai-key',
        logitBias: { '123': 50 },
      });

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.modelKwargs).toBeUndefined();
    });

    it('keeps allowlisted modelKwargs params', () => {
      createChatModel({
        modelName: 'glm-4.7',
        provider: AIProvider.ZaiCoding,
        apiKey: 'zai-key',
        responseFormat: { type: 'text' },
      });

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.modelKwargs).toEqual({ response_format: { type: 'text' } });
    });

    it('leaves the OpenRouter route on denylist semantics for glm-4.5-air', () => {
      // The per-model OpenRouter entry must NOT become an allowlist: params
      // OpenRouter handles (here response_format) have to survive.
      createChatModel({
        modelName: 'z-ai/glm-4.5-air:free',
        responseFormat: { type: 'text' },
        seed: 42,
      });

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      const kwargs = callArgs.modelKwargs as Record<string, unknown>;
      expect(kwargs.response_format).toEqual({ type: 'text' });
      expect(kwargs.seed).toBeUndefined();
    });

    it('lets the OpenRouter route keep reasoning for a restricted model', () => {
      // The sharpest edge of the denylist/allowlist split: an allowlist applied
      // to the OpenRouter route would strip the reasoning object entirely.
      createChatModel({
        modelName: 'z-ai/glm-4.5-air:free',
        thinking: 'high',
      });

      const callArgs = mockChatOpenAI.mock.calls[0][0] as Record<string, unknown>;
      const kwargs = callArgs.modelKwargs as Record<string, unknown>;
      expect(kwargs.reasoning).toEqual({ effort: 'high' });
    });
  });

  // ===================================
  // Schema ↔ z.ai disposition parity
  // ===================================

  describe('z.ai param disposition parity', () => {
    // Object.keys erases the map's `keyof AdvancedParams` key type; restore it
    // so the disposition lookups below stay index-safe under noImplicitAny.
    const dispositionKeys = Object.keys(ZAI_PARAM_DISPOSITIONS) as (keyof AdvancedParams)[];

    it('declares a z.ai disposition for exactly the schema keys', () => {
      // Both directions: a new AdvancedParamsSchema key fails here until its
      // z.ai disposition is declared, and a stale declaration fails too.
      expect(Object.keys(ZAI_PARAM_DISPOSITIONS).sort()).toEqual(
        Object.keys(AdvancedParamsSchema.shape).sort()
      );
    });

    it('keeps every sent param in the allowlist', () => {
      const sent = dispositionKeys.filter(key => ZAI_PARAM_DISPOSITIONS[key] === 'sent');
      expect(sent.length).toBeGreaterThan(0);
      for (const key of sent) {
        expect(isZaiSupportedParam(key)).toBe(true);
      }
    });

    it('keeps every dropped param out of the allowlist', () => {
      const dropped = dispositionKeys.filter(key => ZAI_PARAM_DISPOSITIONS[key] === 'dropped');
      expect(dropped.length).toBeGreaterThan(0);
      for (const key of dropped) {
        expect(isZaiSupportedParam(key)).toBe(false);
      }
    });

    it('translates exactly the thinking level', () => {
      // `thinking` is the only translated key. Note the schema key and z.ai's
      // wire `thinking` object are different things that share a spelling —
      // this map is keyed by SCHEMA key.
      const translated = dispositionKeys.filter(
        key => ZAI_PARAM_DISPOSITIONS[key] === 'translated'
      );
      expect(translated).toEqual(['thinking']);
    });
  });
});
