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
  AI_ENDPOINTS: {
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  },
}));

import { createChatModel, getModelCacheKey, type ModelConfig } from './ModelFactory.js';

describe('ModelFactory', () => {
  beforeEach(() => {
    mockChatOpenAI.mockClear();
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

    it('should pass reasoning with effort via modelKwargs and use custom fetch for include_reasoning', () => {
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

      // include_reasoning is injected via custom fetch (not in modelKwargs)
      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
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
      // Custom fetch used for include_reasoning
      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
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
      // Custom fetch used because exclude !== true
      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
    });

    it('should use maxTokens when effort is not set and NOT use custom fetch when exclude: true', () => {
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

      // reasoning object should be present
      expect(callArgs?.modelKwargs?.reasoning).toEqual({
        max_tokens: 16000,
        exclude: true,
      });
      // No custom fetch when exclude: true (no include_reasoning needed)
      expect(callArgs?.configuration?.fetch).toBeUndefined();
    });

    // ===================================
    // OpenRouter-specific parameters (via custom fetch)
    // ===================================

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

      // OpenRouter-specific params (include_reasoning, transforms, route) via custom fetch
      expect(callArgs?.configuration?.fetch).toBeInstanceOf(Function);
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
});
