import { describe, it, expect } from 'vitest';
import { Prisma } from './prisma.js';
import {
  LLM_CONFIG_SELECT,
  LLM_CONFIG_SELECT_WITH_NAME,
  mapLlmConfigFromDb,
  mapLlmConfigFromDbWithName,
  type RawLlmConfigFromDb,
  type RawLlmConfigFromDbWithName,
} from './LlmConfigMapper.js';

describe('LlmConfigMapper', () => {
  describe('LLM_CONFIG_SELECT', () => {
    it('should include all required fields', () => {
      expect(LLM_CONFIG_SELECT.model).toBe(true);
      expect(LLM_CONFIG_SELECT.visionModel).toBe(true);
      expect(LLM_CONFIG_SELECT.advancedParameters).toBe(true);
      expect(LLM_CONFIG_SELECT.memoryScoreThreshold).toBe(true);
      expect(LLM_CONFIG_SELECT.memoryLimit).toBe(true);
      expect(LLM_CONFIG_SELECT.contextWindowTokens).toBe(true);
    });

    it('should not include legacy columns', () => {
      const select = LLM_CONFIG_SELECT as Record<string, unknown>;
      expect(select).not.toHaveProperty('temperature');
      expect(select).not.toHaveProperty('topP');
      expect(select).not.toHaveProperty('maxTokens');
    });
  });

  describe('LLM_CONFIG_SELECT_WITH_NAME', () => {
    it('should extend base select with name', () => {
      expect(LLM_CONFIG_SELECT_WITH_NAME.name).toBe(true);
      expect(LLM_CONFIG_SELECT_WITH_NAME.model).toBe(true);
    });
  });

  describe('mapLlmConfigFromDb', () => {
    const createRaw = (overrides: Partial<RawLlmConfigFromDb> = {}): RawLlmConfigFromDb => ({
      model: 'openai/gpt-4',
      visionModel: 'openai/gpt-4-vision',
      advancedParameters: null,
      memoryScoreThreshold: null,
      memoryLimit: null,
      contextWindowTokens: 128000,
      maxMessages: 50,
      maxAge: null,
      maxImages: 10,
      ...overrides,
    });

    it('should map basic fields correctly', () => {
      const raw = createRaw();
      const result = mapLlmConfigFromDb(raw);

      expect(result.model).toBe('openai/gpt-4');
      expect(result.visionModel).toBe('openai/gpt-4-vision');
      expect(result.contextWindowTokens).toBe(128000);
    });

    it('should parse advancedParameters JSONB with all param types', () => {
      const raw = createRaw({
        advancedParameters: {
          // Sampling (basic)
          temperature: 0.7,
          top_p: 0.9,
          top_k: 50,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          repetition_penalty: 1.1,
          // Sampling (advanced)
          min_p: 0.1,
          top_a: 0.5,
          seed: 42,
          // Output
          max_tokens: 4096,
          stop: ['END'],
          logit_bias: { '1234': 50 },
          response_format: { type: 'json_object' },
          show_thinking: true,
          // Reasoning
          reasoning: { effort: 'xhigh', max_tokens: 16000 },
          // OpenRouter
          transforms: ['middle-out'],
          route: 'fallback',
          verbosity: 'high',
        },
      });

      const result = mapLlmConfigFromDb(raw);

      // Basic sampling
      expect(result.temperature).toBe(0.7);
      expect(result.topP).toBe(0.9);
      expect(result.topK).toBe(50);
      expect(result.frequencyPenalty).toBe(0.5);
      expect(result.presencePenalty).toBe(0.3);
      expect(result.repetitionPenalty).toBe(1.1);

      // Advanced sampling
      expect(result.minP).toBe(0.1);
      expect(result.topA).toBe(0.5);
      expect(result.seed).toBe(42);

      // Output
      expect(result.maxTokens).toBe(4096);
      expect(result.stop).toEqual(['END']);
      expect(result.logitBias).toEqual({ '1234': 50 });
      expect(result.responseFormat).toEqual({ type: 'json_object' });
      expect(result.showThinking).toBe(true);

      // Reasoning
      expect(result.reasoning?.effort).toBe('xhigh');
      expect(result.reasoning?.maxTokens).toBe(16000);

      // OpenRouter
      expect(result.transforms).toEqual(['middle-out']);
      expect(result.route).toBe('fallback');
      expect(result.verbosity).toBe('high');
    });

    it('should handle empty advancedParameters (null)', () => {
      const raw = createRaw({ advancedParameters: null });
      const result = mapLlmConfigFromDb(raw);

      expect(result.temperature).toBeUndefined();
      expect(result.maxTokens).toBeUndefined();
      expect(result.reasoning).toBeUndefined();
    });

    it('should handle empty advancedParameters (empty object)', () => {
      const raw = createRaw({ advancedParameters: {} });
      const result = mapLlmConfigFromDb(raw);

      expect(result.temperature).toBeUndefined();
      expect(result.maxTokens).toBeUndefined();
    });

    it('should convert Prisma Decimal to number', () => {
      // Create a mock Decimal with toNumber method
      const mockDecimal = {
        toNumber: () => 0.75,
      };

      const raw = createRaw({ memoryScoreThreshold: mockDecimal });
      const result = mapLlmConfigFromDb(raw);

      expect(result.memoryScoreThreshold).toBe(0.75);
    });

    it('should handle actual Prisma.Decimal type', () => {
      const decimal = new Prisma.Decimal(0.85);
      const raw = createRaw({ memoryScoreThreshold: decimal });
      const result = mapLlmConfigFromDb(raw);

      expect(result.memoryScoreThreshold).toBe(0.85);
    });

    it('should handle null memoryScoreThreshold', () => {
      const raw = createRaw({ memoryScoreThreshold: null });
      const result = mapLlmConfigFromDb(raw);

      expect(result.memoryScoreThreshold).toBeNull();
    });

    it('should handle invalid advancedParameters gracefully', () => {
      const raw = createRaw({
        advancedParameters: { temperature: 999 }, // Invalid: out of range
      });
      const result = mapLlmConfigFromDb(raw);

      // Should return empty params due to validation failure
      expect(result.temperature).toBeUndefined();
    });

    it('should preserve model fields regardless of advancedParameters state', () => {
      const raw = createRaw({
        model: 'anthropic/claude-3-opus',
        visionModel: null,
        advancedParameters: { temperature: 999 }, // Invalid
      });
      const result = mapLlmConfigFromDb(raw);

      expect(result.model).toBe('anthropic/claude-3-opus');
      expect(result.visionModel).toBeNull();
    });

    it('should handle partial advancedParameters', () => {
      const raw = createRaw({
        advancedParameters: {
          temperature: 0.5,
          max_tokens: 2048,
        },
      });
      const result = mapLlmConfigFromDb(raw);

      expect(result.temperature).toBe(0.5);
      expect(result.maxTokens).toBe(2048);
      expect(result.topP).toBeUndefined();
      expect(result.reasoning).toBeUndefined();
    });
  });

  describe('mapLlmConfigFromDbWithName', () => {
    it('should include name in result', () => {
      const raw: RawLlmConfigFromDbWithName = {
        name: 'My Custom Config',
        model: 'openai/gpt-4',
        visionModel: null,
        advancedParameters: { temperature: 0.7 },
        memoryScoreThreshold: null,
        memoryLimit: 100,
        contextWindowTokens: 128000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
      };

      const result = mapLlmConfigFromDbWithName(raw);

      expect(result.name).toBe('My Custom Config');
      expect(result.model).toBe('openai/gpt-4');
      expect(result.temperature).toBe(0.7);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical personality default config', () => {
      const raw: RawLlmConfigFromDb = {
        model: 'anthropic/claude-3-sonnet',
        visionModel: 'anthropic/claude-3-haiku',
        advancedParameters: {
          temperature: 0.9,
          top_p: 0.95,
          max_tokens: 4096,
        },
        memoryScoreThreshold: new Prisma.Decimal(0.7),
        memoryLimit: 50,
        contextWindowTokens: 200000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
      };

      const result = mapLlmConfigFromDb(raw);

      expect(result.model).toBe('anthropic/claude-3-sonnet');
      expect(result.visionModel).toBe('anthropic/claude-3-haiku');
      expect(result.temperature).toBe(0.9);
      expect(result.topP).toBe(0.95);
      expect(result.maxTokens).toBe(4096);
      expect(result.memoryScoreThreshold).toBe(0.7);
      expect(result.memoryLimit).toBe(50);
      expect(result.contextWindowTokens).toBe(200000);
    });

    it('should handle config with reasoning enabled', () => {
      const raw: RawLlmConfigFromDb = {
        model: 'deepseek/deepseek-r1',
        visionModel: null,
        advancedParameters: {
          temperature: 1.0, // Required for reasoning models
          max_tokens: 32000,
          reasoning: {
            effort: 'high',
            max_tokens: 16000,
            exclude: false,
          },
          show_thinking: true,
        },
        memoryScoreThreshold: null,
        memoryLimit: null,
        contextWindowTokens: 128000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
      };

      const result = mapLlmConfigFromDb(raw);

      expect(result.model).toBe('deepseek/deepseek-r1');
      expect(result.temperature).toBe(1.0);
      expect(result.maxTokens).toBe(32000);
      expect(result.reasoning?.effort).toBe('high');
      expect(result.reasoning?.maxTokens).toBe(16000);
      expect(result.reasoning?.exclude).toBe(false);
      expect(result.showThinking).toBe(true);
    });

    it('should handle user override config with minimal params', () => {
      const raw: RawLlmConfigFromDbWithName = {
        name: 'Creative Mode',
        model: 'openai/gpt-4o',
        visionModel: 'openai/gpt-4o',
        advancedParameters: {
          temperature: 1.5,
          frequency_penalty: 0.8,
        },
        memoryScoreThreshold: null,
        memoryLimit: null,
        contextWindowTokens: 128000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
      };

      const result = mapLlmConfigFromDbWithName(raw);

      expect(result.name).toBe('Creative Mode');
      expect(result.temperature).toBe(1.5);
      expect(result.frequencyPenalty).toBe(0.8);
      // Other params should be undefined for proper cascade merging
      expect(result.topP).toBeUndefined();
      expect(result.maxTokens).toBeUndefined();
    });
  });
});
