/**
 * Tests for Preset Configuration Validation
 */

import { describe, it, expect } from 'vitest';
import { presetConfigValidator, PARAMETER_DESCRIPTIONS } from './presetValidation.js';
import type { FlattenedPresetData } from './config.js';

/**
 * Create a minimal valid preset config for testing
 */
function createTestConfig(overrides: Partial<FlattenedPresetData> = {}): FlattenedPresetData {
  return {
    id: 'test-id',
    name: 'Test Preset',
    description: '',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    visionModel: '',
    isGlobal: false,
    isOwned: true,
    canEdit: true,
    maxReferencedMessages: '20',
    // Sampling params
    temperature: '',
    top_p: '',
    top_k: '',
    max_tokens: '',
    seed: '',
    // Penalty params
    frequency_penalty: '',
    presence_penalty: '',
    repetition_penalty: '',
    min_p: '',
    top_a: '',
    // Reasoning params
    reasoning_effort: '',
    reasoning_max_tokens: '',
    reasoning_exclude: '',
    reasoning_enabled: '',
    // Output params
    show_thinking: '',
    // Context settings
    maxMessages: '50',
    maxAge: '',
    maxImages: '10',
    // Memory and context window settings
    contextWindowTokens: '131072',
    memoryScoreThreshold: '',
    memoryLimit: '',
    ...overrides,
  };
}

describe('presetConfigValidator', () => {
  describe('error rules', () => {
    describe('min_p / top_a conflict', () => {
      it('should error when both min_p and top_a are set', () => {
        const config = createTestConfig({ min_p: '0.1', top_a: '0.5' });
        const result = presetConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].field).toBe('min_p / top_a');
        expect(result.errors[0].message).toContain('Use min_p OR top_a');
      });

      it('should pass when only min_p is set', () => {
        const config = createTestConfig({ min_p: '0.1' });
        const result = presetConfigValidator.validate(config);

        expect(result.errors.filter(e => e.field === 'min_p / top_a')).toHaveLength(0);
      });

      it('should pass when only top_a is set', () => {
        const config = createTestConfig({ top_a: '0.5' });
        const result = presetConfigValidator.validate(config);

        expect(result.errors.filter(e => e.field === 'min_p / top_a')).toHaveLength(0);
      });

      it('should pass when neither is set', () => {
        const config = createTestConfig({});
        const result = presetConfigValidator.validate(config);

        expect(result.errors.filter(e => e.field === 'min_p / top_a')).toHaveLength(0);
      });

      it('should pass when values are 0', () => {
        const config = createTestConfig({ min_p: '0', top_a: '0' });
        const result = presetConfigValidator.validate(config);

        expect(result.errors.filter(e => e.field === 'min_p / top_a')).toHaveLength(0);
      });
    });

    describe('reasoning_max_tokens constraint', () => {
      it('should error when reasoning tokens >= max tokens', () => {
        const config = createTestConfig({
          reasoning_max_tokens: '8000',
          max_tokens: '4000',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
        expect(result.errors.some(e => e.field === 'reasoning_max_tokens')).toBe(true);
      });

      it('should error when reasoning tokens equal max tokens', () => {
        const config = createTestConfig({
          reasoning_max_tokens: '4000',
          max_tokens: '4000',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.isValid).toBe(false);
      });

      it('should pass when reasoning tokens < max tokens', () => {
        const config = createTestConfig({
          reasoning_max_tokens: '2000',
          max_tokens: '4000',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.errors.filter(e => e.field === 'reasoning_max_tokens')).toHaveLength(0);
      });

      it('should pass when only reasoning tokens is set', () => {
        const config = createTestConfig({ reasoning_max_tokens: '8000' });
        const result = presetConfigValidator.validate(config);

        expect(result.errors.filter(e => e.field === 'reasoning_max_tokens')).toHaveLength(0);
      });
    });
  });

  describe('warning rules', () => {
    describe('temperature / top_p warning', () => {
      it('should warn when both temperature and top_p are low', () => {
        const config = createTestConfig({ temperature: '0.3', top_p: '0.7' });
        const result = presetConfigValidator.validate(config);

        expect(result.isValid).toBe(true); // Warnings don't invalidate
        expect(result.warnings.some(w => w.field === 'temperature / top_p')).toBe(true);
      });

      it('should not warn when temperature is normal', () => {
        const config = createTestConfig({ temperature: '0.7', top_p: '0.7' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'temperature / top_p')).toHaveLength(0);
      });
    });

    describe('high temperature warning', () => {
      it('should warn when temperature > 1.5', () => {
        const config = createTestConfig({ temperature: '1.8' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'temperature')).toBe(true);
        expect(result.warnings.find(w => w.field === 'temperature')?.message).toContain(
          'incoherent'
        );
      });

      it('should not warn when temperature is normal', () => {
        const config = createTestConfig({ temperature: '1.0' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'temperature')).toHaveLength(0);
      });
    });

    describe('penalty strategy warning', () => {
      it('should warn when using repetition_penalty with frequency_penalty', () => {
        const config = createTestConfig({
          repetition_penalty: '1.1',
          frequency_penalty: '0.5',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'penalties')).toBe(true);
      });

      it('should warn when using repetition_penalty with presence_penalty', () => {
        const config = createTestConfig({
          repetition_penalty: '1.2',
          presence_penalty: '0.3',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'penalties')).toBe(true);
      });

      it('should not warn when only using repetition_penalty', () => {
        const config = createTestConfig({ repetition_penalty: '1.1' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'penalties')).toHaveLength(0);
      });

      it('should not warn when only using freq/presence penalties', () => {
        const config = createTestConfig({
          frequency_penalty: '0.5',
          presence_penalty: '0.3',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'penalties')).toHaveLength(0);
      });
    });

    describe('high repetition_penalty warning', () => {
      it('should warn when repetition_penalty > 1.5', () => {
        const config = createTestConfig({ repetition_penalty: '1.8' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'repetition_penalty')).toBe(true);
      });

      it('should not warn when repetition_penalty is moderate', () => {
        const config = createTestConfig({ repetition_penalty: '1.2' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'repetition_penalty')).toHaveLength(0);
      });
    });

    describe('low max_tokens warning', () => {
      it('should warn when max_tokens < 100', () => {
        const config = createTestConfig({ max_tokens: '50' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'max_tokens')).toBe(true);
      });

      it('should not warn when max_tokens is reasonable', () => {
        const config = createTestConfig({ max_tokens: '2048' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'max_tokens')).toHaveLength(0);
      });
    });

    describe('reasoning effort without enabled warning', () => {
      it('should warn when effort is set but reasoning is disabled', () => {
        const config = createTestConfig({
          reasoning_effort: 'high',
          reasoning_enabled: 'false',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'reasoning_effort')).toBe(true);
      });

      it('should not warn when effort is set and reasoning is enabled', () => {
        const config = createTestConfig({
          reasoning_effort: 'high',
          reasoning_enabled: 'true',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'reasoning_effort')).toHaveLength(0);
      });

      it('should not warn when effort is set and enabled is not specified', () => {
        const config = createTestConfig({ reasoning_effort: 'high' });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.filter(w => w.field === 'reasoning_effort')).toHaveLength(0);
      });
    });

    describe('reasoning effort / max_tokens mutual exclusivity', () => {
      it('should warn when both reasoning effort and max_tokens are set', () => {
        const config = createTestConfig({
          reasoning_effort: 'high',
          max_tokens: '4096',
        });
        const result = presetConfigValidator.validate(config);

        expect(result.warnings.some(w => w.field === 'reasoning_effort / max_tokens')).toBe(true);
        expect(
          result.warnings.find(w => w.field === 'reasoning_effort / max_tokens')?.message
        ).toContain('mutually exclusive');
      });

      it('should not warn when only effort is set', () => {
        const config = createTestConfig({ reasoning_effort: 'medium' });
        const result = presetConfigValidator.validate(config);

        expect(
          result.warnings.filter(w => w.field === 'reasoning_effort / max_tokens')
        ).toHaveLength(0);
      });

      it('should not warn when only max_tokens is set', () => {
        const config = createTestConfig({ max_tokens: '4096' });
        const result = presetConfigValidator.validate(config);

        expect(
          result.warnings.filter(w => w.field === 'reasoning_effort / max_tokens')
        ).toHaveLength(0);
      });

      it('should not warn when effort is empty string', () => {
        const config = createTestConfig({
          reasoning_effort: '',
          max_tokens: '4096',
        });
        const result = presetConfigValidator.validate(config);

        expect(
          result.warnings.filter(w => w.field === 'reasoning_effort / max_tokens')
        ).toHaveLength(0);
      });
    });
  });

  describe('combined scenarios', () => {
    it('should detect multiple issues at once', () => {
      const config = createTestConfig({
        min_p: '0.1',
        top_a: '0.5', // Error: both set
        temperature: '1.8', // Warning: too high
        repetition_penalty: '1.8', // Warning: too high
      });

      const result = presetConfigValidator.validate(config);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    });

    it('should pass with a well-configured preset', () => {
      const config = createTestConfig({
        temperature: '0.7',
        top_p: '0.9',
        max_tokens: '4096',
        frequency_penalty: '0.2',
      });

      const result = presetConfigValidator.validate(config);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});

describe('PARAMETER_DESCRIPTIONS', () => {
  it('should have descriptions for all common parameters', () => {
    const expectedParams = [
      'temperature',
      'top_p',
      'top_k',
      'min_p',
      'top_a',
      'frequency_penalty',
      'presence_penalty',
      'repetition_penalty',
      'max_tokens',
      'seed',
      'reasoning_effort',
      'reasoning_max_tokens',
    ];

    for (const param of expectedParams) {
      expect(PARAMETER_DESCRIPTIONS[param]).toBeDefined();
      expect(PARAMETER_DESCRIPTIONS[param].length).toBeGreaterThan(10);
    }
  });
});
