/**
 * Tests for Model Factory
 *
 * These tests verify that all LLM sampling parameters are correctly passed
 * to the ChatOpenAI constructor when creating models.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @langchain/openai - use vi.hoisted for top-level mock reference
const { mockChatOpenAI } = vi.hoisted(() => ({
  mockChatOpenAI: vi.fn(),
}));

vi.mock('@langchain/openai', () => ({
  ChatOpenAI: mockChatOpenAI,
}));

// Mock @tzurot/common-types
vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getConfig: () => ({
    AI_PROVIDER: 'openrouter',
    DEFAULT_AI_MODEL: 'anthropic/claude-sonnet-4.5',
    OPENROUTER_API_KEY: 'test-openrouter-key',
  }),
  AIProvider: {
    OpenRouter: 'openrouter',
  },
  AI_DEFAULTS: {
    MAX_TOKENS: 4096,
    REASONING_MODEL_MAX_TOKENS: {
      xhigh: 65536,
      high: 32768,
      medium: 16384,
      low: 8192,
      minimal: 6144,
      none: 4096,
    },
  },
  AI_ENDPOINTS: {
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  },
}));

// Mock reasoningModelUtils - control isReasoningModel per test
const mockIsReasoningModel = vi.fn().mockReturnValue(false);
vi.mock('../utils/reasoningModelUtils.js', () => ({
  isReasoningModel: (modelName: string) => mockIsReasoningModel(modelName),
}));

import { createChatModel, getModelCacheKey, type ModelConfig } from './ModelFactory.js';

describe('ModelFactory', () => {
  beforeEach(() => {
    mockChatOpenAI.mockClear();
    mockIsReasoningModel.mockClear();
    mockIsReasoningModel.mockReturnValue(false); // Default: not a reasoning model
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

    it('should pass stop sequences via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        stop: ['STOP', 'END'],
      };

      createChatModel(config);

      expect(mockChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          modelKwargs: expect.objectContaining({
            stop: ['STOP', 'END'],
          }),
        })
      );
    });

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
    // Reasoning parameters (CRITICAL for thinking models)
    // ===================================

    it('should pass reasoning with effort via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        reasoning: { effort: 'high' },
      };

      createChatModel(config);

      // Get the actual call arguments
      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      // reasoning goes in modelKwargs
      expect(callArgs?.modelKwargs?.reasoning).toEqual({ effort: 'high' });

      // Custom fetch needed for response interception (LangChain drops reasoning from responses)
      expect(callArgs?.configuration?.fetch).toBeDefined();
    });

    it('should pass reasoning with maxTokens (converted to snake_case) via modelKwargs', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        reasoning: { maxTokens: 16000 },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      expect(callArgs?.modelKwargs?.reasoning).toEqual({ max_tokens: 16000 });
      // Custom fetch needed for response interception (LangChain drops reasoning from responses)
      expect(callArgs?.configuration?.fetch).toBeDefined();
    });

    it('should pass reasoning object with all fields except maxTokens when effort is set', () => {
      // OpenRouter constraint: only ONE of effort or maxTokens can be used
      // When both are provided, effort takes precedence
      const config: ModelConfig = {
        modelName: 'test-model',
        reasoning: {
          effort: 'xhigh',
          maxTokens: 32000, // Will be ignored because effort is set
          exclude: false,
          enabled: true,
        },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      expect(callArgs?.modelKwargs?.reasoning).toEqual({
        effort: 'xhigh',
        // max_tokens NOT included because effort takes precedence
        exclude: false,
        enabled: true,
      });
      // Custom fetch needed for response interception (LangChain drops reasoning from responses)
      expect(callArgs?.configuration?.fetch).toBeDefined();
    });

    it('should use maxTokens when effort is not set and pass exclude in reasoning object', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        reasoning: {
          maxTokens: 16000,
          exclude: true, // exclude: true means don't return reasoning in response
        },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      // reasoning object should be present with exclude flag
      expect(callArgs?.modelKwargs?.reasoning).toEqual({
        max_tokens: 16000,
        exclude: true,
      });
      // Custom fetch needed for response interception (LangChain drops reasoning from responses)
      expect(callArgs?.configuration?.fetch).toBeDefined();
    });

    // ===================================
    // OpenRouter-specific parameters (via custom fetch)
    // ===================================

    it('should NOT use custom fetch for showThinking alone (reasoning handled natively)', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        showThinking: true,
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { fetch?: unknown };
      };

      // showThinking no longer triggers custom fetch - reasoning is handled
      // natively via the reasoning param in modelKwargs
      expect(callArgs?.configuration?.fetch).toBeUndefined();
    });

    it('should use custom fetch for reasoning config (needed for response interception)', () => {
      const config: ModelConfig = {
        modelName: 'test-model',
        showThinking: false,
        reasoning: { enabled: true, effort: 'medium' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        modelKwargs?: Record<string, unknown>;
        configuration?: { fetch?: unknown };
      };

      // reasoning goes in modelKwargs AND custom fetch intercepts responses
      expect(callArgs?.modelKwargs?.reasoning).toEqual({
        enabled: true,
        effort: 'medium',
      });
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
        stop: ['END'],
        responseFormat: { type: 'text' },
        // Reasoning (effort only - maxTokens would conflict)
        reasoning: { effort: 'high' },
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
        stop: ['END'],
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

    it('should filter seed from modelKwargs for GLM 4.5 Air', () => {
      const config: ModelConfig = {
        modelName: 'z-ai/glm-4.5-air:free',
        seed: 42,
        topK: 40, // topK IS supported
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0][0] as {
        modelKwargs?: Record<string, unknown>;
      };
      expect(callArgs.modelKwargs).toBeDefined();
      expect(callArgs.modelKwargs?.seed).toBeUndefined();
      expect(callArgs.modelKwargs?.top_k).toBe(40); // Supported param preserved
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
      // Unsupported params filtered
      expect(callArgs.frequencyPenalty).toBeUndefined();
      expect(callArgs.presencePenalty).toBeUndefined();
      // Supported params preserved
      expect(callArgs.topP).toBe(0.95);
      const kwargs = callArgs.modelKwargs as Record<string, unknown>;
      expect(kwargs.seed).toBeUndefined();
      expect(kwargs.top_k).toBe(40);
      expect(kwargs.repetition_penalty).toBe(1.05);
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
        reasoning: { effort: 'high' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(8000); // User override, not scaled
    });

    it('should scale maxTokens for reasoning models with medium effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        reasoning: { effort: 'medium' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(16384); // Scaled for medium effort
    });

    it('should scale maxTokens for reasoning models with high effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'kimi/kimi-k2-thinking',
        reasoning: { effort: 'high' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(32768); // Scaled for high effort
    });

    it('should scale maxTokens for reasoning models with low effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'openai/o1-preview',
        reasoning: { effort: 'low' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(8192); // Scaled for low effort
    });

    it('should NOT scale maxTokens for standard models even with reasoning config', () => {
      mockIsReasoningModel.mockReturnValue(false); // Standard model

      const config: ModelConfig = {
        modelName: 'anthropic/claude-sonnet-4.5',
        reasoning: { effort: 'high' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBeUndefined(); // Not scaled, API decides
    });

    it('should NOT scale maxTokens for reasoning models without effort config', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        // No reasoning.effort set
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBeUndefined(); // Not scaled, API decides
    });

    it('should use standard limit when effort is none', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'deepseek/deepseek-r1',
        reasoning: { effort: 'none' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(4096); // Standard limit for 'none'
    });

    it('should scale maxTokens for xhigh effort', () => {
      mockIsReasoningModel.mockReturnValue(true);

      const config: ModelConfig = {
        modelName: 'openai/o1',
        reasoning: { effort: 'xhigh' },
      };

      createChatModel(config);

      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as { maxTokens?: number };
      expect(callArgs?.maxTokens).toBe(65536); // Maximum for xhigh effort
    });
  });

  describe('getModelCacheKey', () => {
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

    // ===================================
    // New parameter cache key tests
    // ===================================

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

  // ===================================
  // Custom fetch response handling (Fix 1: clone, Fix 2: 400 content recovery)
  // ===================================

  describe('custom fetch response handling', () => {
    /** Helper to extract the custom fetch function from the ChatOpenAI constructor call */
    function getCustomFetch(): (url: string, init?: RequestInit) => Promise<Response> {
      const config: ModelConfig = {
        modelName: 'test-model',
        reasoning: { effort: 'high' }, // Triggers custom fetch
      };
      createChatModel(config);
      const callArgs = mockChatOpenAI.mock.calls[0]?.[0] as {
        configuration?: { fetch?: (url: string, init?: RequestInit) => Promise<Response> };
      };
      const customFetch = callArgs?.configuration?.fetch;
      expect(customFetch).toBeDefined();
      return customFetch!;
    }

    /** Create a mock Response */
    function mockResponse(
      body: unknown,
      status: number,
      contentType = 'application/json'
    ): Response {
      return new Response(JSON.stringify(body), {
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: { 'content-type': contentType },
      });
    }

    it('should preserve response body when interception succeeds (clone behavior)', async () => {
      const customFetch = getCustomFetch();

      const responseBody = {
        choices: [
          {
            message: {
              content: 'Hello world',
              reasoning: 'I thought carefully',
            },
          },
        ],
      };

      // Mock global fetch to return our test response
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 200));

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });
        const resultBody = (await result.json()) as Record<string, unknown>;
        const choices = resultBody.choices as Array<{ message: { content: string } }>;

        expect(result.status).toBe(200);
        // Reasoning should be injected into content
        expect(choices[0].message.content).toContain('<reasoning>');
        expect(choices[0].message.content).toContain('Hello world');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should return original response when JSON parse fails (clone preserves body)', async () => {
      const customFetch = getCustomFetch();

      // Create a response with invalid JSON that will cause .json() to fail
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response('not valid json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        // Should return original response with body intact (since we cloned)
        expect(result.status).toBe(200);
        const text = await result.text();
        expect(text).toBe('not valid json');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should recover valid content from 400 response', async () => {
      const customFetch = getCustomFetch();

      const responseBody = {
        choices: [
          {
            message: {
              content: 'Valid response content',
            },
          },
        ],
        error: { message: 'Some provider error' },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        // Should synthesize a 200 response with the recovered content
        expect(result.status).toBe(200);
        const body = (await result.json()) as Record<string, unknown>;
        const choices = body.choices as Array<{ message: { content: string } }>;
        expect(choices[0].message.content).toBe('Valid response content');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should pass through 400 response when no valid content', async () => {
      const customFetch = getCustomFetch();

      const responseBody = {
        error: { message: 'Context length exceeded' },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        // Should pass through the error response unchanged
        expect(result.status).toBe(400);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should pass through 400 response with empty content', async () => {
      const customFetch = getCustomFetch();

      const responseBody = {
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        expect(result.status).toBe(400);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should pass through 400 response with unparseable JSON body', async () => {
      const customFetch = getCustomFetch();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response('not json at all', {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      );

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        // Should fall through and return original error response
        expect(result.status).toBe(400);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should NOT attempt content recovery for 500/502 errors', async () => {
      const customFetch = getCustomFetch();

      const responseBody = {
        choices: [
          {
            message: {
              content: 'This should not be recovered',
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 502));

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        // 502 is NOT in the 400-499 range, so no recovery attempted
        expect(result.status).toBe(502);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should inject reasoning into recovered 400 content', async () => {
      const customFetch = getCustomFetch();

      const responseBody = {
        choices: [
          {
            message: {
              content: 'Hello world',
              reasoning: 'Deep thinking here',
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(mockResponse(responseBody, 400));

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        expect(result.status).toBe(200);
        const body = (await result.json()) as Record<string, unknown>;
        const choices = body.choices as Array<{ message: { content: string } }>;
        expect(choices[0].message.content).toContain('<reasoning>Deep thinking here</reasoning>');
        expect(choices[0].message.content).toContain('Hello world');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should NOT attempt content recovery for non-JSON 400 responses', async () => {
      const customFetch = getCustomFetch();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        new Response('Bad Request', {
          status: 400,
          headers: { 'content-type': 'text/plain' },
        })
      );

      try {
        const result = await customFetch('https://api.test.com/v1/chat', {
          method: 'GET',
        });

        expect(result.status).toBe(400);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
