import { describe, it, expect } from 'vitest';
import {
  LLM_CONFIG_FIELDS,
  LLM_CONFIG_OVERRIDE_KEYS,
  LLM_CONFIG_JSONB_KEYS,
  LLM_CONFIG_COLUMN_KEYS,
  CAMEL_TO_SNAKE_MAP,
  SNAKE_TO_CAMEL_MAP,
  getFieldsByCategory,
  getFieldDefault,
  getAllDefaults,
  type LlmConfigOverrideKey,
} from './llmConfigFields.js';

describe('LLM Config Fields Metadata', () => {
  describe('LLM_CONFIG_FIELDS', () => {
    it('should define all expected fields', () => {
      // These are all the fields that were previously hardcoded in LLM_CONFIG_OVERRIDE_KEYS
      const expectedKeys: LlmConfigOverrideKey[] = [
        // Core
        'visionModel',
        // Basic sampling
        'temperature',
        'topP',
        'topK',
        'frequencyPenalty',
        'presencePenalty',
        'repetitionPenalty',
        // Advanced sampling
        'minP',
        'topA',
        'seed',
        // Output control
        'maxTokens',
        'stop',
        'logitBias',
        'responseFormat',
        'showThinking',
        // Reasoning
        'reasoning',
        // OpenRouter-specific
        'transforms',
        'route',
        'verbosity',
        // Memory/context
        'memoryScoreThreshold',
        'memoryLimit',
        'contextWindowTokens',
      ];

      for (const key of expectedKeys) {
        expect(LLM_CONFIG_FIELDS).toHaveProperty(key);
      }
    });

    it('should have exactly 22 fields (matching old LLM_CONFIG_OVERRIDE_KEYS count)', () => {
      expect(Object.keys(LLM_CONFIG_FIELDS).length).toBe(22);
    });

    it('should have valid metadata for each field', () => {
      for (const [key, meta] of Object.entries(LLM_CONFIG_FIELDS)) {
        // Every field must have a schema
        expect(meta.schema, `${key} should have schema`).toBeDefined();

        // Every field must have a category
        expect(meta.category, `${key} should have category`).toBeDefined();

        // Every field must have a description
        expect(meta.description, `${key} should have description`).toBeTruthy();
      }
    });

    it('should have correct categories for each field', () => {
      expect(LLM_CONFIG_FIELDS.visionModel.category).toBe('core');

      expect(LLM_CONFIG_FIELDS.temperature.category).toBe('sampling');
      expect(LLM_CONFIG_FIELDS.topP.category).toBe('sampling');
      expect(LLM_CONFIG_FIELDS.topK.category).toBe('sampling');

      expect(LLM_CONFIG_FIELDS.minP.category).toBe('sampling_advanced');
      expect(LLM_CONFIG_FIELDS.topA.category).toBe('sampling_advanced');
      expect(LLM_CONFIG_FIELDS.seed.category).toBe('sampling_advanced');

      expect(LLM_CONFIG_FIELDS.maxTokens.category).toBe('output');
      expect(LLM_CONFIG_FIELDS.stop.category).toBe('output');
      expect(LLM_CONFIG_FIELDS.showThinking.category).toBe('output');

      expect(LLM_CONFIG_FIELDS.reasoning.category).toBe('reasoning');

      expect(LLM_CONFIG_FIELDS.transforms.category).toBe('openrouter');
      expect(LLM_CONFIG_FIELDS.route.category).toBe('openrouter');
      expect(LLM_CONFIG_FIELDS.verbosity.category).toBe('openrouter');

      expect(LLM_CONFIG_FIELDS.memoryScoreThreshold.category).toBe('memory');
      expect(LLM_CONFIG_FIELDS.memoryLimit.category).toBe('memory');

      expect(LLM_CONFIG_FIELDS.contextWindowTokens.category).toBe('context');
    });
  });

  describe('LLM_CONFIG_OVERRIDE_KEYS', () => {
    it('should be derived from LLM_CONFIG_FIELDS', () => {
      expect(LLM_CONFIG_OVERRIDE_KEYS).toHaveLength(Object.keys(LLM_CONFIG_FIELDS).length);

      for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
        expect(LLM_CONFIG_FIELDS).toHaveProperty(key);
      }
    });

    it('should contain all ConvertedLlmParams keys from llmAdvancedParams', () => {
      // These keys come from advancedParamsToConfigFormat()
      const convertedParamKeys: LlmConfigOverrideKey[] = [
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
      const dbSpecificKeys: LlmConfigOverrideKey[] = [
        'visionModel',
        'memoryScoreThreshold',
        'memoryLimit',
        'contextWindowTokens',
      ];

      for (const key of dbSpecificKeys) {
        expect(LLM_CONFIG_OVERRIDE_KEYS).toContain(key);
      }
    });
  });

  describe('LLM_CONFIG_JSONB_KEYS and LLM_CONFIG_COLUMN_KEYS', () => {
    it('should partition all keys between JSONB and column keys', () => {
      const allKeys = new Set([...LLM_CONFIG_JSONB_KEYS, ...LLM_CONFIG_COLUMN_KEYS]);
      expect(allKeys.size).toBe(LLM_CONFIG_OVERRIDE_KEYS.length);
    });

    it('should have no overlap between JSONB and column keys', () => {
      const jsonbSet = new Set(LLM_CONFIG_JSONB_KEYS);
      const columnSet = new Set(LLM_CONFIG_COLUMN_KEYS);

      for (const key of jsonbSet) {
        expect(columnSet.has(key)).toBe(false);
      }
    });

    it('should correctly identify JSONB fields', () => {
      // These fields have dbKey set (are in advancedParameters JSONB)
      expect(LLM_CONFIG_JSONB_KEYS).toContain('temperature');
      expect(LLM_CONFIG_JSONB_KEYS).toContain('topP');
      expect(LLM_CONFIG_JSONB_KEYS).toContain('maxTokens');
      expect(LLM_CONFIG_JSONB_KEYS).toContain('reasoning');
    });

    it('should correctly identify column fields', () => {
      // These fields have no dbKey (stored as separate columns)
      expect(LLM_CONFIG_COLUMN_KEYS).toContain('visionModel');
      expect(LLM_CONFIG_COLUMN_KEYS).toContain('memoryScoreThreshold');
      expect(LLM_CONFIG_COLUMN_KEYS).toContain('memoryLimit');
      expect(LLM_CONFIG_COLUMN_KEYS).toContain('contextWindowTokens');
    });
  });

  describe('CAMEL_TO_SNAKE_MAP', () => {
    it('should map camelCase to snake_case for JSONB fields', () => {
      expect(CAMEL_TO_SNAKE_MAP.temperature).toBe('temperature');
      expect(CAMEL_TO_SNAKE_MAP.topP).toBe('top_p');
      expect(CAMEL_TO_SNAKE_MAP.topK).toBe('top_k');
      expect(CAMEL_TO_SNAKE_MAP.frequencyPenalty).toBe('frequency_penalty');
      expect(CAMEL_TO_SNAKE_MAP.presencePenalty).toBe('presence_penalty');
      expect(CAMEL_TO_SNAKE_MAP.repetitionPenalty).toBe('repetition_penalty');
      expect(CAMEL_TO_SNAKE_MAP.minP).toBe('min_p');
      expect(CAMEL_TO_SNAKE_MAP.topA).toBe('top_a');
      expect(CAMEL_TO_SNAKE_MAP.maxTokens).toBe('max_tokens');
      expect(CAMEL_TO_SNAKE_MAP.logitBias).toBe('logit_bias');
      expect(CAMEL_TO_SNAKE_MAP.responseFormat).toBe('response_format');
      expect(CAMEL_TO_SNAKE_MAP.showThinking).toBe('show_thinking');
    });

    it('should NOT include column fields (no dbKey)', () => {
      expect(CAMEL_TO_SNAKE_MAP).not.toHaveProperty('visionModel');
      expect(CAMEL_TO_SNAKE_MAP).not.toHaveProperty('memoryScoreThreshold');
      expect(CAMEL_TO_SNAKE_MAP).not.toHaveProperty('memoryLimit');
      expect(CAMEL_TO_SNAKE_MAP).not.toHaveProperty('contextWindowTokens');
    });
  });

  describe('SNAKE_TO_CAMEL_MAP', () => {
    it('should be the reverse of CAMEL_TO_SNAKE_MAP', () => {
      for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE_MAP)) {
        expect(SNAKE_TO_CAMEL_MAP[snake]).toBe(camel);
      }
    });

    it('should map snake_case back to camelCase', () => {
      expect(SNAKE_TO_CAMEL_MAP.top_p).toBe('topP');
      expect(SNAKE_TO_CAMEL_MAP.frequency_penalty).toBe('frequencyPenalty');
      expect(SNAKE_TO_CAMEL_MAP.max_tokens).toBe('maxTokens');
      expect(SNAKE_TO_CAMEL_MAP.show_thinking).toBe('showThinking');
    });
  });

  describe('getFieldsByCategory', () => {
    it('should return sampling fields', () => {
      const sampling = getFieldsByCategory('sampling');
      expect(sampling).toContain('temperature');
      expect(sampling).toContain('topP');
      expect(sampling).toContain('topK');
      expect(sampling).toContain('frequencyPenalty');
      expect(sampling).toContain('presencePenalty');
      expect(sampling).toContain('repetitionPenalty');
    });

    it('should return output fields', () => {
      const output = getFieldsByCategory('output');
      expect(output).toContain('maxTokens');
      expect(output).toContain('stop');
      expect(output).toContain('showThinking');
    });

    it('should return reasoning fields', () => {
      const reasoning = getFieldsByCategory('reasoning');
      expect(reasoning).toContain('reasoning');
    });

    it('should return memory fields', () => {
      const memory = getFieldsByCategory('memory');
      expect(memory).toContain('memoryScoreThreshold');
      expect(memory).toContain('memoryLimit');
    });
  });

  describe('getFieldDefault', () => {
    it('should return default for temperature', () => {
      expect(getFieldDefault('temperature')).toBe(0.7);
    });

    it('should return default for maxTokens', () => {
      expect(getFieldDefault('maxTokens')).toBe(2000);
    });

    it('should return default for contextWindowTokens', () => {
      expect(getFieldDefault('contextWindowTokens')).toBe(16000);
    });

    it('should return undefined for fields without defaults', () => {
      expect(getFieldDefault('topP')).toBeUndefined();
      expect(getFieldDefault('reasoning')).toBeUndefined();
      expect(getFieldDefault('visionModel')).toBeUndefined();
    });
  });

  describe('getAllDefaults', () => {
    it('should return object with all defaults', () => {
      const defaults = getAllDefaults();

      expect(defaults.temperature).toBe(0.7);
      expect(defaults.maxTokens).toBe(2000);
      expect(defaults.contextWindowTokens).toBe(16000);
    });

    it('should not include fields without defaults', () => {
      const defaults = getAllDefaults();

      expect('topP' in defaults).toBe(false);
      expect('reasoning' in defaults).toBe(false);
      expect('visionModel' in defaults).toBe(false);
    });
  });

  describe('Schema validation', () => {
    it('should validate temperature range', () => {
      const { schema } = LLM_CONFIG_FIELDS.temperature;
      expect(schema.safeParse(0).success).toBe(true);
      expect(schema.safeParse(1).success).toBe(true);
      expect(schema.safeParse(2).success).toBe(true);
      expect(schema.safeParse(-1).success).toBe(false);
      expect(schema.safeParse(3).success).toBe(false);
    });

    it('should validate topP range', () => {
      const { schema } = LLM_CONFIG_FIELDS.topP;
      expect(schema.safeParse(0).success).toBe(true);
      expect(schema.safeParse(0.5).success).toBe(true);
      expect(schema.safeParse(1).success).toBe(true);
      expect(schema.safeParse(-0.1).success).toBe(false);
      expect(schema.safeParse(1.1).success).toBe(false);
    });

    it('should validate reasoning object', () => {
      const { schema } = LLM_CONFIG_FIELDS.reasoning;
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse({ effort: 'high' }).success).toBe(true);
      expect(schema.safeParse({ effort: 'xhigh', maxTokens: 16000 }).success).toBe(true);
      expect(schema.safeParse({ effort: 'invalid' }).success).toBe(false);
      expect(schema.safeParse({ maxTokens: 500 }).success).toBe(false); // Below min
    });

    it('should validate route enum', () => {
      const { schema } = LLM_CONFIG_FIELDS.route;
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse('fallback').success).toBe(true);
      expect(schema.safeParse('invalid').success).toBe(false);
    });

    it('should validate verbosity enum', () => {
      const { schema } = LLM_CONFIG_FIELDS.verbosity;
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse('low').success).toBe(true);
      expect(schema.safeParse('medium').success).toBe(true);
      expect(schema.safeParse('high').success).toBe(true);
      expect(schema.safeParse('invalid').success).toBe(false);
    });
  });
});
