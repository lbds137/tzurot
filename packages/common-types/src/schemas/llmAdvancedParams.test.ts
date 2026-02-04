import { describe, it, expect } from 'vitest';
import {
  SamplingParamsSchema,
  ReasoningConfigSchema,
  ReasoningParamsSchema,
  OutputParamsSchema,
  OpenRouterParamsSchema,
  AdvancedParamsSchema,
  validateAdvancedParams,
  safeValidateAdvancedParams,
  hasReasoningEnabled,
  validateReasoningConstraints,
  advancedParamsToConfigFormat,
  LLM_CONFIG_OVERRIDE_KEYS,
  type AdvancedParams,
} from './llmAdvancedParams.js';

describe('LLM Advanced Params Schema', () => {
  describe('SamplingParamsSchema', () => {
    it('should accept valid temperature', () => {
      expect(SamplingParamsSchema.parse({ temperature: 0 })).toEqual({ temperature: 0 });
      expect(SamplingParamsSchema.parse({ temperature: 1 })).toEqual({ temperature: 1 });
      expect(SamplingParamsSchema.parse({ temperature: 2 })).toEqual({ temperature: 2 });
    });

    it('should reject temperature out of range', () => {
      expect(() => SamplingParamsSchema.parse({ temperature: -1 })).toThrow();
      expect(() => SamplingParamsSchema.parse({ temperature: 3 })).toThrow();
    });

    it('should accept valid top_p', () => {
      expect(SamplingParamsSchema.parse({ top_p: 0 })).toEqual({ top_p: 0 });
      expect(SamplingParamsSchema.parse({ top_p: 0.5 })).toEqual({ top_p: 0.5 });
      expect(SamplingParamsSchema.parse({ top_p: 1 })).toEqual({ top_p: 1 });
    });

    it('should reject top_p out of range', () => {
      expect(() => SamplingParamsSchema.parse({ top_p: -0.1 })).toThrow();
      expect(() => SamplingParamsSchema.parse({ top_p: 1.1 })).toThrow();
    });

    it('should accept valid top_k', () => {
      expect(SamplingParamsSchema.parse({ top_k: 0 })).toEqual({ top_k: 0 });
      expect(SamplingParamsSchema.parse({ top_k: 50 })).toEqual({ top_k: 50 });
    });

    it('should reject negative top_k', () => {
      expect(() => SamplingParamsSchema.parse({ top_k: -1 })).toThrow();
    });

    it('should reject non-integer top_k', () => {
      expect(() => SamplingParamsSchema.parse({ top_k: 1.5 })).toThrow();
    });

    it('should accept valid penalty values', () => {
      expect(SamplingParamsSchema.parse({ frequency_penalty: -2 })).toEqual({
        frequency_penalty: -2,
      });
      expect(SamplingParamsSchema.parse({ frequency_penalty: 2 })).toEqual({
        frequency_penalty: 2,
      });
      expect(SamplingParamsSchema.parse({ presence_penalty: 0 })).toEqual({ presence_penalty: 0 });
      expect(SamplingParamsSchema.parse({ repetition_penalty: 1.5 })).toEqual({
        repetition_penalty: 1.5,
      });
    });

    it('should reject penalty values out of range', () => {
      expect(() => SamplingParamsSchema.parse({ frequency_penalty: -3 })).toThrow();
      expect(() => SamplingParamsSchema.parse({ frequency_penalty: 3 })).toThrow();
      expect(() => SamplingParamsSchema.parse({ repetition_penalty: -1 })).toThrow();
      expect(() => SamplingParamsSchema.parse({ repetition_penalty: 3 })).toThrow();
    });

    it('should accept valid min_p and top_a', () => {
      expect(SamplingParamsSchema.parse({ min_p: 0.1, top_a: 0.5 })).toEqual({
        min_p: 0.1,
        top_a: 0.5,
      });
    });

    it('should accept valid seed', () => {
      expect(SamplingParamsSchema.parse({ seed: 42 })).toEqual({ seed: 42 });
      expect(SamplingParamsSchema.parse({ seed: 0 })).toEqual({ seed: 0 });
    });

    it('should reject non-integer seed', () => {
      expect(() => SamplingParamsSchema.parse({ seed: 1.5 })).toThrow();
    });

    it('should accept empty object', () => {
      expect(SamplingParamsSchema.parse({})).toEqual({});
    });

    it('should accept multiple params together', () => {
      const params = {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        frequency_penalty: 0.5,
        seed: 123,
      };
      expect(SamplingParamsSchema.parse(params)).toEqual(params);
    });
  });

  describe('ReasoningConfigSchema', () => {
    it('should accept valid effort levels', () => {
      expect(ReasoningConfigSchema.parse({ effort: 'xhigh' })).toEqual({ effort: 'xhigh' });
      expect(ReasoningConfigSchema.parse({ effort: 'high' })).toEqual({ effort: 'high' });
      expect(ReasoningConfigSchema.parse({ effort: 'medium' })).toEqual({ effort: 'medium' });
      expect(ReasoningConfigSchema.parse({ effort: 'low' })).toEqual({ effort: 'low' });
      expect(ReasoningConfigSchema.parse({ effort: 'minimal' })).toEqual({ effort: 'minimal' });
      expect(ReasoningConfigSchema.parse({ effort: 'none' })).toEqual({ effort: 'none' });
    });

    it('should accept xhigh effort level for maximum thinking', () => {
      // xhigh is ~95% token allocation for reasoning
      const config = { effort: 'xhigh' as const, max_tokens: 30000 };
      expect(ReasoningConfigSchema.parse(config)).toEqual(config);
    });

    it('should reject invalid effort levels', () => {
      expect(() => ReasoningConfigSchema.parse({ effort: 'maximum' })).toThrow();
      expect(() => ReasoningConfigSchema.parse({ effort: '' })).toThrow();
    });

    it('should accept valid max_tokens', () => {
      expect(ReasoningConfigSchema.parse({ max_tokens: 1024 })).toEqual({ max_tokens: 1024 });
      expect(ReasoningConfigSchema.parse({ max_tokens: 16000 })).toEqual({ max_tokens: 16000 });
      expect(ReasoningConfigSchema.parse({ max_tokens: 32000 })).toEqual({ max_tokens: 32000 });
    });

    it('should reject max_tokens below minimum (1024)', () => {
      expect(() => ReasoningConfigSchema.parse({ max_tokens: 1000 })).toThrow();
      expect(() => ReasoningConfigSchema.parse({ max_tokens: 0 })).toThrow();
    });

    it('should reject max_tokens above maximum (32000)', () => {
      expect(() => ReasoningConfigSchema.parse({ max_tokens: 33000 })).toThrow();
    });

    it('should accept boolean exclude', () => {
      expect(ReasoningConfigSchema.parse({ exclude: true })).toEqual({ exclude: true });
      expect(ReasoningConfigSchema.parse({ exclude: false })).toEqual({ exclude: false });
    });

    it('should accept boolean enabled', () => {
      expect(ReasoningConfigSchema.parse({ enabled: true })).toEqual({ enabled: true });
      expect(ReasoningConfigSchema.parse({ enabled: false })).toEqual({ enabled: false });
    });

    it('should accept combined reasoning config', () => {
      const config = {
        effort: 'high' as const,
        max_tokens: 16000,
        exclude: false,
        enabled: true,
      };
      expect(ReasoningConfigSchema.parse(config)).toEqual(config);
    });
  });

  describe('ReasoningParamsSchema', () => {
    it('should accept reasoning object', () => {
      const params = { reasoning: { effort: 'medium' as const } };
      expect(ReasoningParamsSchema.parse(params)).toEqual(params);
    });

    it('should accept empty object', () => {
      expect(ReasoningParamsSchema.parse({})).toEqual({});
    });

    it('should accept undefined reasoning', () => {
      expect(ReasoningParamsSchema.parse({ reasoning: undefined })).toEqual({});
    });
  });

  describe('OutputParamsSchema', () => {
    it('should accept valid max_tokens', () => {
      expect(OutputParamsSchema.parse({ max_tokens: 100 })).toEqual({ max_tokens: 100 });
      expect(OutputParamsSchema.parse({ max_tokens: 4096 })).toEqual({ max_tokens: 4096 });
    });

    it('should reject non-positive max_tokens', () => {
      expect(() => OutputParamsSchema.parse({ max_tokens: 0 })).toThrow();
      expect(() => OutputParamsSchema.parse({ max_tokens: -100 })).toThrow();
    });

    it('should accept stop sequences', () => {
      expect(OutputParamsSchema.parse({ stop: ['END', 'STOP'] })).toEqual({
        stop: ['END', 'STOP'],
      });
      expect(OutputParamsSchema.parse({ stop: [] })).toEqual({ stop: [] });
    });

    it('should accept logit_bias', () => {
      const params = { logit_bias: { '1234': 50, '5678': -50 } };
      expect(OutputParamsSchema.parse(params)).toEqual(params);
    });

    it('should reject logit_bias out of range', () => {
      expect(() => OutputParamsSchema.parse({ logit_bias: { '1234': 101 } })).toThrow();
      expect(() => OutputParamsSchema.parse({ logit_bias: { '1234': -101 } })).toThrow();
    });

    it('should accept response_format', () => {
      expect(OutputParamsSchema.parse({ response_format: { type: 'text' } })).toEqual({
        response_format: { type: 'text' },
      });
      expect(OutputParamsSchema.parse({ response_format: { type: 'json_object' } })).toEqual({
        response_format: { type: 'json_object' },
      });
    });

    it('should reject invalid response_format type', () => {
      expect(() => OutputParamsSchema.parse({ response_format: { type: 'xml' } })).toThrow();
    });

    it('should accept show_thinking boolean', () => {
      expect(OutputParamsSchema.parse({ show_thinking: true })).toEqual({ show_thinking: true });
      expect(OutputParamsSchema.parse({ show_thinking: false })).toEqual({ show_thinking: false });
    });

    it('should reject non-boolean show_thinking', () => {
      expect(() => OutputParamsSchema.parse({ show_thinking: 'yes' })).toThrow();
      expect(() => OutputParamsSchema.parse({ show_thinking: 1 })).toThrow();
    });
  });

  describe('OpenRouterParamsSchema', () => {
    it('should accept transforms', () => {
      expect(OpenRouterParamsSchema.parse({ transforms: ['middle-out'] })).toEqual({
        transforms: ['middle-out'],
      });
    });

    it('should accept route', () => {
      expect(OpenRouterParamsSchema.parse({ route: 'fallback' })).toEqual({ route: 'fallback' });
    });

    it('should reject invalid route', () => {
      expect(() => OpenRouterParamsSchema.parse({ route: 'invalid' })).toThrow();
    });

    it('should accept verbosity', () => {
      expect(OpenRouterParamsSchema.parse({ verbosity: 'low' })).toEqual({ verbosity: 'low' });
      expect(OpenRouterParamsSchema.parse({ verbosity: 'medium' })).toEqual({
        verbosity: 'medium',
      });
      expect(OpenRouterParamsSchema.parse({ verbosity: 'high' })).toEqual({ verbosity: 'high' });
    });
  });

  describe('AdvancedParamsSchema (Combined)', () => {
    it('should accept empty object', () => {
      expect(AdvancedParamsSchema.parse({})).toEqual({});
    });

    it('should accept all param types together', () => {
      const params = {
        // Sampling
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.5,
        // Reasoning
        reasoning: {
          effort: 'high' as const,
          max_tokens: 8000,
        },
        // Output
        max_tokens: 4096,
        stop: ['END'],
        // OpenRouter
        transforms: ['middle-out'],
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
    });

    it('should strip unknown properties', () => {
      const result = AdvancedParamsSchema.parse({
        temperature: 0.7,
        unknown_param: 'should be stripped',
      });
      expect(result).toEqual({ temperature: 0.7 });
      expect(result).not.toHaveProperty('unknown_param');
    });
  });

  describe('validateAdvancedParams', () => {
    it('should return validated params', () => {
      const params = { temperature: 0.5 };
      expect(validateAdvancedParams(params)).toEqual(params);
    });

    it('should throw on invalid params', () => {
      expect(() => validateAdvancedParams({ temperature: 5 })).toThrow();
    });

    it('should accept null (converts to empty object)', () => {
      expect(validateAdvancedParams(null)).toEqual({});
    });

    it('should accept undefined (converts to empty object)', () => {
      expect(validateAdvancedParams(undefined)).toEqual({});
    });
  });

  describe('safeValidateAdvancedParams', () => {
    it('should return validated params on success', () => {
      const params = { temperature: 0.5 };
      expect(safeValidateAdvancedParams(params)).toEqual(params);
    });

    it('should return null on invalid params', () => {
      expect(safeValidateAdvancedParams({ temperature: 5 })).toBeNull();
    });

    it('should return empty object for null input', () => {
      expect(safeValidateAdvancedParams(null)).toEqual({});
    });
  });

  describe('hasReasoningEnabled', () => {
    it('should return false for empty params', () => {
      expect(hasReasoningEnabled({})).toBe(false);
    });

    it('should return false for undefined reasoning', () => {
      expect(hasReasoningEnabled({ temperature: 0.7 })).toBe(false);
    });

    it('should return false when enabled is false', () => {
      expect(hasReasoningEnabled({ reasoning: { enabled: false } })).toBe(false);
    });

    it('should return false when effort is none', () => {
      expect(hasReasoningEnabled({ reasoning: { effort: 'none' } })).toBe(false);
    });

    it('should return true when effort is set (not none)', () => {
      expect(hasReasoningEnabled({ reasoning: { effort: 'xhigh' } })).toBe(true);
      expect(hasReasoningEnabled({ reasoning: { effort: 'high' } })).toBe(true);
      expect(hasReasoningEnabled({ reasoning: { effort: 'medium' } })).toBe(true);
      expect(hasReasoningEnabled({ reasoning: { effort: 'low' } })).toBe(true);
      expect(hasReasoningEnabled({ reasoning: { effort: 'minimal' } })).toBe(true);
    });

    it('should return true when max_tokens is set', () => {
      expect(hasReasoningEnabled({ reasoning: { max_tokens: 8000 } })).toBe(true);
    });

    it('should return true with both effort and max_tokens', () => {
      expect(hasReasoningEnabled({ reasoning: { effort: 'high', max_tokens: 8000 } })).toBe(true);
    });

    it('should return false with only exclude set', () => {
      expect(hasReasoningEnabled({ reasoning: { exclude: true } })).toBe(false);
    });
  });

  describe('validateReasoningConstraints', () => {
    it('should return true when no reasoning', () => {
      expect(validateReasoningConstraints({ max_tokens: 4096 })).toBe(true);
    });

    it('should return true when no max_tokens', () => {
      expect(validateReasoningConstraints({ reasoning: { max_tokens: 8000 } })).toBe(true);
    });

    it('should return true when reasoning.max_tokens < max_tokens', () => {
      const params: AdvancedParams = {
        reasoning: { max_tokens: 8000 },
        max_tokens: 16000,
      };
      expect(validateReasoningConstraints(params)).toBe(true);
    });

    it('should return false when reasoning.max_tokens >= max_tokens', () => {
      const params: AdvancedParams = {
        reasoning: { max_tokens: 8000 },
        max_tokens: 8000,
      };
      expect(validateReasoningConstraints(params)).toBe(false);
    });

    it('should return false when reasoning.max_tokens > max_tokens', () => {
      const params: AdvancedParams = {
        reasoning: { max_tokens: 16000 },
        max_tokens: 8000,
      };
      expect(validateReasoningConstraints(params)).toBe(false);
    });
  });

  describe('Real-world scenarios', () => {
    it('should validate typical OpenAI o1 configuration', () => {
      const params = {
        reasoning: { effort: 'high' as const },
        max_tokens: 4096,
        temperature: 1, // Required for reasoning models
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
      expect(hasReasoningEnabled(params)).toBe(true);
    });

    it('should validate typical Claude configuration', () => {
      const params = {
        reasoning: { max_tokens: 16000 },
        max_tokens: 32000,
        temperature: 0.7,
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
      expect(hasReasoningEnabled(params)).toBe(true);
      expect(validateReasoningConstraints(params)).toBe(true);
    });

    it('should validate configuration with reasoning excluded', () => {
      const params = {
        reasoning: { effort: 'high' as const, exclude: true },
        max_tokens: 4096,
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
      expect(hasReasoningEnabled(params)).toBe(true);
    });

    it('should validate configuration with reasoning disabled', () => {
      const params = {
        reasoning: { enabled: false },
        max_tokens: 4096,
        temperature: 0.7,
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
      expect(hasReasoningEnabled(params)).toBe(false);
    });

    it('should validate typical non-reasoning model configuration', () => {
      const params = {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048,
        frequency_penalty: 0.3,
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
      expect(hasReasoningEnabled(params)).toBe(false);
    });
  });

  describe('advancedParamsToConfigFormat', () => {
    it('should convert basic sampling params from snake_case to camelCase', () => {
      const input: AdvancedParams = {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 50,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        repetition_penalty: 1.1,
        max_tokens: 4096,
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.temperature).toBe(0.7);
      expect(result.topP).toBe(0.9);
      expect(result.topK).toBe(50);
      expect(result.frequencyPenalty).toBe(0.5);
      expect(result.presencePenalty).toBe(0.3);
      expect(result.repetitionPenalty).toBe(1.1);
      expect(result.maxTokens).toBe(4096);
    });

    it('should convert advanced sampling params (minP, topA, seed)', () => {
      const input: AdvancedParams = {
        min_p: 0.1,
        top_a: 0.5,
        seed: 42,
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.minP).toBe(0.1);
      expect(result.topA).toBe(0.5);
      expect(result.seed).toBe(42);
    });

    it('should convert output params (stop, logitBias, responseFormat, showThinking)', () => {
      const input: AdvancedParams = {
        stop: ['END', 'STOP'],
        logit_bias: { '1234': 50, '5678': -50 },
        response_format: { type: 'json_object' },
        show_thinking: true,
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.stop).toEqual(['END', 'STOP']);
      expect(result.logitBias).toEqual({ '1234': 50, '5678': -50 });
      expect(result.responseFormat).toEqual({ type: 'json_object' });
      expect(result.showThinking).toBe(true);
    });

    it('should convert reasoning config with all fields', () => {
      const input: AdvancedParams = {
        reasoning: {
          effort: 'xhigh',
          max_tokens: 16000,
          exclude: false,
          enabled: true,
        },
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.reasoning).toEqual({
        effort: 'xhigh',
        maxTokens: 16000,
        exclude: false,
        enabled: true,
      });
    });

    it('should convert OpenRouter-specific params (transforms, route, verbosity)', () => {
      const input: AdvancedParams = {
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: 'high',
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.transforms).toEqual(['middle-out']);
      expect(result.route).toBe('fallback');
      expect(result.verbosity).toBe('high');
    });

    it('should convert ALL params together', () => {
      const input: AdvancedParams = {
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
        response_format: { type: 'text' },
        show_thinking: true,
        // Reasoning
        reasoning: { effort: 'high', max_tokens: 8000 },
        // OpenRouter
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: 'medium',
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result).toEqual({
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        repetitionPenalty: 1.1,
        minP: 0.1,
        topA: 0.5,
        seed: 42,
        maxTokens: 4096,
        stop: ['END'],
        logitBias: { '1234': 50 },
        responseFormat: { type: 'text' },
        showThinking: true,
        reasoning: { effort: 'high', maxTokens: 8000, exclude: undefined, enabled: undefined },
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: 'medium',
      });
    });

    it('should handle empty object with all undefined values', () => {
      const result = advancedParamsToConfigFormat({});
      expect(result.temperature).toBeUndefined();
      expect(result.topP).toBeUndefined();
      expect(result.topK).toBeUndefined();
      expect(result.minP).toBeUndefined();
      expect(result.topA).toBeUndefined();
      expect(result.seed).toBeUndefined();
      expect(result.reasoning).toBeUndefined();
      expect(result.stop).toBeUndefined();
      expect(result.transforms).toBeUndefined();
      expect(result.showThinking).toBeUndefined();
    });

    it('should handle partial params', () => {
      const input: AdvancedParams = {
        temperature: 0.7,
        top_p: 0.9,
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.temperature).toBe(0.7);
      expect(result.topP).toBe(0.9);
      expect(result.topK).toBeUndefined();
      expect(result.frequencyPenalty).toBeUndefined();
    });

    it('should preserve zero values (not treat as undefined)', () => {
      const input: AdvancedParams = {
        temperature: 0,
        top_k: 0,
        frequency_penalty: 0,
        seed: 0,
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.temperature).toBe(0);
      expect(result.topK).toBe(0);
      expect(result.frequencyPenalty).toBe(0);
      expect(result.seed).toBe(0);
    });

    it('should preserve false values for booleans', () => {
      const input: AdvancedParams = {
        show_thinking: false,
        reasoning: { enabled: false, exclude: false },
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.showThinking).toBe(false);
      expect(result.reasoning?.enabled).toBe(false);
      expect(result.reasoning?.exclude).toBe(false);
    });

    it('should handle reasoning with only effort set', () => {
      const input: AdvancedParams = {
        reasoning: { effort: 'medium' },
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.reasoning?.effort).toBe('medium');
      expect(result.reasoning?.maxTokens).toBeUndefined();
    });
  });

  describe('LLM_CONFIG_OVERRIDE_KEYS', () => {
    it('should contain all ConvertedLlmParams keys', () => {
      // These are the keys from ConvertedLlmParams that come from advancedParamsToConfigFormat
      const convertedParamKeys = [
        'temperature',
        'topP',
        'topK',
        'frequencyPenalty',
        'presencePenalty',
        'repetitionPenalty',
        'minP',
        'topA',
        'seed',
        'maxTokens',
        'stop',
        'logitBias',
        'responseFormat',
        'showThinking',
        'reasoning',
        'transforms',
        'route',
        'verbosity',
      ];

      for (const key of convertedParamKeys) {
        expect(LLM_CONFIG_OVERRIDE_KEYS).toContain(key);
      }
    });

    it('should contain database-specific keys', () => {
      // These keys exist in LoadedPersonality/ResolvedLlmConfig but not in AdvancedParams
      const dbSpecificKeys = [
        'visionModel',
        'memoryScoreThreshold',
        'memoryLimit',
        'contextWindowTokens',
      ];

      for (const key of dbSpecificKeys) {
        expect(LLM_CONFIG_OVERRIDE_KEYS).toContain(key);
      }
    });

    it('should have exactly 25 keys', () => {
      // This test ensures we notice if keys are accidentally added or removed
      // Update this number when intentionally adding new config params
      // Added maxMessages, maxAge, maxImages for Phase 2 config consolidation
      expect(LLM_CONFIG_OVERRIDE_KEYS.length).toBe(25);
    });
  });
});
