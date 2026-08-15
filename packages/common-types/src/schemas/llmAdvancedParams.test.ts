import { describe, it, expect } from 'vitest';
import {
  SamplingParamsSchema,
  ThinkingParamsSchema,
  AdvancedParamsInputSchema,
  OutputParamsSchema,
  OpenRouterParamsSchema,
  AdvancedParamsSchema,
  safeValidateAdvancedParams,
  upgradeLegacyReasoningShape,
  advancedParamsToConfigFormat,
  LLM_CONFIG_OVERRIDE_KEYS,
  applyLlmOverrideParams,
  type AdvancedParams,
  type LlmConfigOverrideKey,
} from './llmAdvancedParams.js';
import type { MappedLlmConfigWithName } from '../services/LlmConfigMapper.js';
import type { ResolvedLlmConfig } from '../types/configResolution.js';
import type { LoadedPersonality } from '../types/schemas/personality.js';

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

  describe('ThinkingParamsSchema', () => {
    it('should accept every canonical level', () => {
      for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'max'] as const) {
        expect(ThinkingParamsSchema.parse({ thinking: level })).toEqual({ thinking: level });
      }
    });

    it('should reject the retired effort names', () => {
      expect(() => ThinkingParamsSchema.parse({ thinking: 'xhigh' })).toThrow();
      expect(() => ThinkingParamsSchema.parse({ thinking: 'none' })).toThrow();
      expect(() => ThinkingParamsSchema.parse({ thinking: '' })).toThrow();
    });

    it('should accept an absent level — absent is NOT the same as off', () => {
      expect(ThinkingParamsSchema.parse({})).toEqual({});
      expect(ThinkingParamsSchema.parse({ thinking: undefined })).toEqual({});
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
        // Thinking
        thinking: 'high' as const,
        // Output
        max_tokens: 4096,
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

    // The read path sees rows the data migration has not reached yet. Plain
    // strip mode would delete `reasoning` and return {} — the level would look
    // like it had vanished from the dashboard and /inspect.
    it('should upgrade a stored legacy reasoning object instead of stripping it', () => {
      expect(safeValidateAdvancedParams({ reasoning: { effort: 'xhigh' } })).toEqual({
        thinking: 'max',
      });
      expect(safeValidateAdvancedParams({ reasoning: { enabled: false } })).toEqual({
        thinking: 'off',
      });
    });

    it('should leave an already-migrated row untouched (upgrade is idempotent)', () => {
      expect(safeValidateAdvancedParams({ thinking: 'medium', temperature: 0.5 })).toEqual({
        thinking: 'medium',
        temperature: 0.5,
      });
    });
  });

  describe('upgradeLegacyReasoningShape', () => {
    // Every row here is also an arm of the SQL CASE in
    // prisma/migrations/20260814120000_collapse_reasoning_to_thinking/migration.sql.
    // The two mappings must agree; change them together.
    const MAPPING: [string, Record<string, unknown>, string | undefined][] = [
      ['enabled:false wins over any effort', { enabled: false, effort: 'high' }, 'off'],
      ['enabled:false alone', { enabled: false }, 'off'],
      ['effort none', { effort: 'none' }, 'off'],
      ['effort xhigh collapses to max', { effort: 'xhigh' }, 'max'],
      ['effort high', { effort: 'high' }, 'high'],
      ['effort medium', { effort: 'medium' }, 'medium'],
      ['effort low', { effort: 'low' }, 'low'],
      ['effort minimal', { effort: 'minimal' }, 'minimal'],
      ['max_tokens only', { max_tokens: 16000 }, 'high'],
      [
        'unknown effort falls through to max_tokens',
        { effort: 'bogus', max_tokens: 16000 },
        'high',
      ],
      ['empty object', {}, undefined],
      ['exclude only', { exclude: false }, undefined],
      ['enabled:true with no level', { enabled: true }, undefined],
      ['unknown effort with no budget', { effort: 'bogus' }, undefined],
    ];

    it.each(MAPPING)('maps %s', (_label, reasoning, expected) => {
      const result = upgradeLegacyReasoningShape({ temperature: 0.7, reasoning }) as Record<
        string,
        unknown
      >;
      expect(result.reasoning).toBeUndefined();
      expect(result.thinking).toBe(expected);
      // Sibling params survive the rewrite untouched.
      expect(result.temperature).toBe(0.7);
    });

    it('passes through a payload with no reasoning object', () => {
      const input = { temperature: 0.7, thinking: 'low' };
      expect(upgradeLegacyReasoningShape(input)).toBe(input);
    });

    it('passes through non-object input untouched', () => {
      expect(upgradeLegacyReasoningShape(null)).toBeNull();
      expect(upgradeLegacyReasoningShape(undefined)).toBeUndefined();
      expect(upgradeLegacyReasoningShape('nope')).toBe('nope');
      expect(upgradeLegacyReasoningShape([1, 2])).toEqual([1, 2]);
    });

    // The one place this function and the SQL migration deliberately differ:
    // a non-object `reasoning` passes through untouched here (a general-purpose
    // boundary function must not mangle input it does not recognize), while
    // the migration's pass 2 drops the key. Pinned so the documented
    // divergence is a tested fact rather than a comment.
    it('passes a non-object reasoning value through untouched', () => {
      expect(upgradeLegacyReasoningShape({ reasoning: null })).toEqual({ reasoning: null });
      expect(upgradeLegacyReasoningShape({ reasoning: 'nonsense', temperature: 0.5 })).toEqual({
        reasoning: 'nonsense',
        temperature: 0.5,
      });
    });

    it('lets an already-canonical thinking key win over a stale reasoning object', () => {
      expect(
        upgradeLegacyReasoningShape({ thinking: 'low', reasoning: { effort: 'high' } })
      ).toEqual({ thinking: 'low' });
    });

    // An explicit null expresses no level, so it must NOT short-circuit the
    // upgrade — otherwise the null reaches the enum, which rejects it, and a
    // payload we could have upgraded becomes a rejected request instead.
    it('upgrades rather than short-circuiting when thinking is explicitly null', () => {
      expect(
        upgradeLegacyReasoningShape({ thinking: null, reasoning: { effort: 'high' } })
      ).toEqual({ thinking: 'high' });
      expect(AdvancedParamsInputSchema.safeParse({ thinking: null }).success).toBe(false);
    });
  });

  describe('AdvancedParamsInputSchema', () => {
    it('upgrades a legacy reasoning object instead of silently stripping it', () => {
      const parsed = AdvancedParamsInputSchema.parse({
        temperature: 0.7,
        reasoning: { effort: 'xhigh', max_tokens: 16000 },
      });
      expect(parsed).toEqual({ temperature: 0.7, thinking: 'max' });
    });

    it('leaves a canonical payload alone', () => {
      expect(AdvancedParamsInputSchema.parse({ thinking: 'medium' })).toEqual({
        thinking: 'medium',
      });
    });

    it('keeps a knobless payload knobless — absent must stay absent', () => {
      expect(AdvancedParamsInputSchema.parse({ temperature: 0.7 })).toEqual({ temperature: 0.7 });
    });

    it('demonstrates what the plain schema would have done to a legacy payload', () => {
      expect(AdvancedParamsSchema.parse({ reasoning: { effort: 'high' } })).toEqual({});
    });
  });

  describe('Real-world scenarios', () => {
    it('should validate typical OpenAI o1 configuration', () => {
      const params = {
        thinking: 'high' as const,
        max_tokens: 4096,
        temperature: 1, // Required for reasoning models
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
    });

    it('should validate configuration with thinking disabled', () => {
      const params = {
        thinking: 'off' as const,
        max_tokens: 4096,
        temperature: 0.7,
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
    });

    it('should validate typical non-reasoning model configuration', () => {
      const params: AdvancedParams = {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048,
        frequency_penalty: 0.3,
      };
      expect(AdvancedParamsSchema.parse(params)).toEqual(params);
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

    it('should convert output params (logitBias, responseFormat, showThinking)', () => {
      const input: AdvancedParams = {
        logit_bias: { '1234': 50, '5678': -50 },
        response_format: { type: 'json_object' },
        show_thinking: true,
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.logitBias).toEqual({ '1234': 50, '5678': -50 });
      expect(result.responseFormat).toEqual({ type: 'json_object' });
      expect(result.showThinking).toBe(true);
    });

    it('should forward the thinking level unchanged (same name both sides)', () => {
      const result = advancedParamsToConfigFormat({ thinking: 'max' });
      expect(result.thinking).toBe('max');
    });

    it('should leave thinking absent when absent (provider default preserved)', () => {
      expect(advancedParamsToConfigFormat({ temperature: 0.7 }).thinking).toBeUndefined();
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
        logit_bias: { '1234': 50 },
        response_format: { type: 'text' },
        show_thinking: true,
        // Thinking
        thinking: 'high',
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
        logitBias: { '1234': 50 },
        responseFormat: { type: 'text' },
        showThinking: true,
        thinking: 'high',
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
      expect(result.thinking).toBeUndefined();
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
      };
      const result = advancedParamsToConfigFormat(input);
      expect(result.showThinking).toBe(false);
    });

    it('should carry an explicit off level through — off is not absent', () => {
      const result = advancedParamsToConfigFormat({ thinking: 'off' });
      expect(result.thinking).toBe('off');
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
        'logitBias',
        'responseFormat',
        'showThinking',
        'thinking',
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
      // Note: memoryScoreThreshold, memoryLimit, maxMessages, maxAge, maxImages
      // moved to ConfigOverrides cascade
      const dbSpecificKeys = ['contextWindowTokens'];

      for (const key of dbSpecificKeys) {
        expect(LLM_CONFIG_OVERRIDE_KEYS).toContain(key);
      }
    });

    it('should not contain keys moved to ConfigOverrides cascade', () => {
      const movedToCascade = [
        'memoryScoreThreshold',
        'memoryLimit',
        'maxMessages',
        'maxAge',
        'maxImages',
      ];

      for (const key of movedToCascade) {
        expect(LLM_CONFIG_OVERRIDE_KEYS).not.toContain(key);
      }
    });

    it('should have exactly 18 keys', () => {
      // This test ensures we notice if keys are accidentally added or removed
      expect(LLM_CONFIG_OVERRIDE_KEYS.length).toBe(18);
    });
  });

  describe('applyLlmOverrideParams', () => {
    it('plain mode: copies defined keys, never clobbers with an absent key', () => {
      const target = { model: 'm', temperature: 0.9, topP: 0.5 };
      const result = applyLlmOverrideParams(target, { temperature: 0.2, maxTokens: 100 });
      expect(result).toBe(target); // mutates and returns target
      expect(result.temperature).toBe(0.2); // defined key wins
      expect(result.topP).toBe(0.5); // absent key keeps target's value
      expect((result as Record<string, unknown>).maxTokens).toBe(100);
    });

    it('plain mode: a null value IS copied (only undefined is skipped)', () => {
      // Matches the original call-site loops (`value !== undefined` guard):
      // a mapped config carrying an explicit null passes through unchanged.
      const result = applyLlmOverrideParams({ temperature: 0.9 }, { temperature: null });
      expect(result.temperature).toBeNull();
    });

    it('fallback mode: override wins per key, fallback fills the gaps', () => {
      const result = applyLlmOverrideParams(
        {},
        { temperature: 0.1, topP: null },
        { fallback: { temperature: 0.9, topP: 0.8, maxTokens: 50 } }
      );
      expect(result).toEqual({
        temperature: 0.1, // override wins
        topP: 0.8, // null falls through to fallback (?? semantics)
        maxTokens: 50, // absent in override → fallback
      });
    });

    it('fallback mode: undefined in both sources assigns nothing', () => {
      const result = applyLlmOverrideParams({}, {}, { fallback: {} });
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('clearAbsent mode: an absent key CLEARS the target value', () => {
      const target = { model: 'fallback-model', temperature: 0.9, seed: 42 };
      const result = applyLlmOverrideParams(target, { temperature: 0.3 }, { clearAbsent: true });
      expect(result.temperature).toBe(0.3);
      expect(result.seed).toBeUndefined(); // preset value cleared, not inherited
    });

    it('clearAbsent mode: a null value normalizes to undefined (`?? undefined`)', () => {
      const result = applyLlmOverrideParams(
        { temperature: 0.9 },
        { temperature: null },
        { clearAbsent: true }
      );
      expect(result.temperature).toBeUndefined();
    });

    it('never touches keys outside LLM_CONFIG_OVERRIDE_KEYS', () => {
      const target = { model: 'keep-me', unrelated: 'keep-me-too' };
      applyLlmOverrideParams(
        target,
        { model: 'evil', unrelated: 'evil' } as Record<string, unknown>,
        { clearAbsent: true }
      );
      expect(target.model).toBe('keep-me');
      expect(target.unrelated).toBe('keep-me-too');
    });

    it('every override key is an own (typed) property of the copy-loop source types', () => {
      // Compile-time drift pin: LlmOverrideSource is structural with unknown
      // values, so a source type silently dropping one of the 18 keys would
      // read as "always absent" instead of failing the build. Pick<> refuses
      // to compile if any key leaves these types — this test exists for the
      // typecheck, the runtime assertion is a formality.
      const pin = (
        _personality: Pick<LoadedPersonality, LlmConfigOverrideKey> | null,
        _resolved: Pick<ResolvedLlmConfig, LlmConfigOverrideKey> | null,
        _mapped: Pick<MappedLlmConfigWithName, LlmConfigOverrideKey> | null
      ): boolean => true;
      expect(pin(null, null, null)).toBe(true);
    });
  });
});
