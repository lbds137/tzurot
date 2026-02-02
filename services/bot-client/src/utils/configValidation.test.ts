/**
 * Tests for Configuration Validation Framework
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ConfigValidator,
  buildValidationEmbed,
  canProceed,
  formatValidationIssues,
  type ValidationResult,
} from './configValidation.js';

// Mock Discord.js EmbedBuilder
vi.mock('discord.js', () => ({
  EmbedBuilder: vi.fn().mockImplementation(() => ({
    setColor: vi.fn().mockReturnThis(),
    setTitle: vi.fn().mockReturnThis(),
    setDescription: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis(),
    data: {},
  })),
}));

// Mock commandHelpers
vi.mock('./commandHelpers.js', () => ({
  createErrorEmbed: vi.fn().mockImplementation((title, description) => ({
    type: 'error',
    title,
    description,
    fields: [] as Array<{ name: string; value: string; inline: boolean }>,
    addFields: vi.fn().mockImplementation(function (
      this: { fields: Array<{ name: string; value: string; inline: boolean }> },
      field: { name: string; value: string; inline: boolean }
    ) {
      this.fields.push(field);
      return this;
    }),
  })),
  createWarningEmbed: vi.fn().mockImplementation((title, description) => ({
    type: 'warning',
    title,
    description,
    fields: [] as Array<{ name: string; value: string; inline: boolean }>,
    addFields: vi.fn().mockImplementation(function (
      this: { fields: Array<{ name: string; value: string; inline: boolean }> },
      field: { name: string; value: string; inline: boolean }
    ) {
      this.fields.push(field);
      return this;
    }),
  })),
}));

// Test config type
interface TestConfig {
  temperature?: number;
  topP?: number;
  minP?: number;
  topA?: number;
  maxTokens?: number;
  reasoning?: {
    maxTokens?: number;
  };
}

describe('ConfigValidator', () => {
  describe('basic functionality', () => {
    it('should return valid result for empty config with no rules', () => {
      const validator = new ConfigValidator<TestConfig>();
      const result = validator.validate({});

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should track rule count', () => {
      const validator = new ConfigValidator<TestConfig>()
        .addError('field1', () => false, 'error1')
        .addWarning('field2', () => false, 'warn1');

      expect(validator.ruleCount).toBe(2);
    });
  });

  describe('error rules', () => {
    it('should detect errors when condition is true', () => {
      const validator = new ConfigValidator<TestConfig>().addError(
        'temperature',
        c => (c.temperature ?? 0) < 0,
        'Temperature must be positive'
      );

      const result = validator.validate({ temperature: -1 });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        severity: 'error',
        field: 'temperature',
        message: 'Temperature must be positive',
      });
    });

    it('should pass when error condition is false', () => {
      const validator = new ConfigValidator<TestConfig>().addError(
        'temperature',
        c => (c.temperature ?? 0) < 0,
        'Temperature must be positive'
      );

      const result = validator.validate({ temperature: 0.7 });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('warning rules', () => {
    it('should detect warnings when condition is true', () => {
      const validator = new ConfigValidator<TestConfig>().addWarning(
        'temperature',
        c => (c.temperature ?? 0) > 1.5,
        'High temperature may produce incoherent output'
      );

      const result = validator.validate({ temperature: 1.8 });

      expect(result.isValid).toBe(true); // Warnings don't invalidate
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        severity: 'warning',
        field: 'temperature',
        message: 'High temperature may produce incoherent output',
      });
    });

    it('should allow valid result with only warnings', () => {
      const validator = new ConfigValidator<TestConfig>().addWarning(
        'temperature',
        c => (c.temperature ?? 0) > 1.5,
        'Warning message'
      );

      const result = validator.validate({ temperature: 2.0 });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('combined rules', () => {
    it('should detect both errors and warnings', () => {
      const validator = new ConfigValidator<TestConfig>()
        .addError('minP / topA', c => (c.minP ?? 0) > 0 && (c.topA ?? 0) > 0, 'Use one, not both')
        .addWarning('temperature', c => (c.temperature ?? 0) > 1.5, 'High temperature');

      const result = validator.validate({
        minP: 0.1,
        topA: 0.5,
        temperature: 1.8,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.issues).toHaveLength(2);
    });

    it('should handle multiple errors on same field', () => {
      const validator = new ConfigValidator<TestConfig>()
        .addError('temperature', c => (c.temperature ?? 0) < 0, 'Must be positive')
        .addError('temperature', c => (c.temperature ?? 0) > 2, 'Must be <= 2');

      const result = validator.validate({ temperature: -1 });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Must be positive');
    });
  });

  describe('real-world validation scenarios', () => {
    it('should validate minP/topA mutual exclusivity', () => {
      const validator = new ConfigValidator<TestConfig>().addError(
        'minP / topA',
        c => (c.minP ?? 0) > 0 && (c.topA ?? 0) > 0,
        'Use min_p OR top_a, not both. They achieve the same goal differently.'
      );

      // Both set - should error
      expect(validator.validate({ minP: 0.1, topA: 0.5 }).isValid).toBe(false);

      // Only minP - should pass
      expect(validator.validate({ minP: 0.1 }).isValid).toBe(true);

      // Only topA - should pass
      expect(validator.validate({ topA: 0.5 }).isValid).toBe(true);

      // Neither - should pass
      expect(validator.validate({}).isValid).toBe(true);
    });

    it('should validate reasoning tokens vs max tokens', () => {
      const validator = new ConfigValidator<TestConfig>().addError(
        'reasoning.maxTokens',
        c =>
          c.reasoning?.maxTokens !== undefined &&
          c.maxTokens !== undefined &&
          c.reasoning.maxTokens >= c.maxTokens,
        'Reasoning tokens must be less than max_tokens to leave room for response.'
      );

      // Reasoning >= maxTokens - should error
      expect(validator.validate({ reasoning: { maxTokens: 8000 }, maxTokens: 4000 }).isValid).toBe(
        false
      );

      // Reasoning < maxTokens - should pass
      expect(validator.validate({ reasoning: { maxTokens: 4000 }, maxTokens: 8000 }).isValid).toBe(
        true
      );
    });
  });
});

describe('buildValidationEmbed', () => {
  it('should return null for no issues', () => {
    const result: ValidationResult = {
      isValid: true,
      issues: [],
      errors: [],
      warnings: [],
    };

    expect(buildValidationEmbed(result)).toBeNull();
  });

  it('should create error embed when errors present', () => {
    const result: ValidationResult = {
      isValid: false,
      issues: [{ severity: 'error', field: 'temperature', message: 'Too low' }],
      errors: [{ severity: 'error', field: 'temperature', message: 'Too low' }],
      warnings: [],
    };

    const embed = buildValidationEmbed(result);

    expect(embed).not.toBeNull();
    expect((embed as unknown as { type: string }).type).toBe('error');
  });

  it('should create warning embed when only warnings present', () => {
    const result: ValidationResult = {
      isValid: true,
      issues: [{ severity: 'warning', field: 'temperature', message: 'High value' }],
      errors: [],
      warnings: [{ severity: 'warning', field: 'temperature', message: 'High value' }],
    };

    const embed = buildValidationEmbed(result);

    expect(embed).not.toBeNull();
    expect((embed as unknown as { type: string }).type).toBe('warning');
  });

  it('should group issues by field', () => {
    const result: ValidationResult = {
      isValid: false,
      issues: [
        { severity: 'error', field: 'fieldA', message: 'Error 1' },
        { severity: 'warning', field: 'fieldA', message: 'Warning 1' },
        { severity: 'error', field: 'fieldB', message: 'Error 2' },
      ],
      errors: [
        { severity: 'error', field: 'fieldA', message: 'Error 1' },
        { severity: 'error', field: 'fieldB', message: 'Error 2' },
      ],
      warnings: [{ severity: 'warning', field: 'fieldA', message: 'Warning 1' }],
    };

    const embed = buildValidationEmbed(result) as unknown as {
      fields: Array<{ name: string; value: string }>;
    };

    expect(embed.fields).toHaveLength(2);
    // fieldA has both error and warning, so should use error icon
    expect(embed.fields[0].name).toContain('❌');
    expect(embed.fields[0].name).toContain('fieldA');
  });
});

describe('canProceed', () => {
  it('should return true when valid', () => {
    const result: ValidationResult = {
      isValid: true,
      issues: [],
      errors: [],
      warnings: [],
    };

    expect(canProceed(result)).toBe(true);
  });

  it('should return true with only warnings', () => {
    const result: ValidationResult = {
      isValid: true,
      issues: [{ severity: 'warning', field: 'temp', message: 'warning' }],
      errors: [],
      warnings: [{ severity: 'warning', field: 'temp', message: 'warning' }],
    };

    expect(canProceed(result)).toBe(true);
  });

  it('should return false with errors', () => {
    const result: ValidationResult = {
      isValid: false,
      issues: [{ severity: 'error', field: 'temp', message: 'error' }],
      errors: [{ severity: 'error', field: 'temp', message: 'error' }],
      warnings: [],
    };

    expect(canProceed(result)).toBe(false);
  });
});

describe('formatValidationIssues', () => {
  it('should return "No issues found" for empty result', () => {
    const result: ValidationResult = {
      isValid: true,
      issues: [],
      errors: [],
      warnings: [],
    };

    expect(formatValidationIssues(result)).toBe('No issues found');
  });

  it('should format issues with icons', () => {
    const result: ValidationResult = {
      isValid: false,
      issues: [
        { severity: 'error', field: 'fieldA', message: 'Error message' },
        { severity: 'warning', field: 'fieldB', message: 'Warning message' },
      ],
      errors: [{ severity: 'error', field: 'fieldA', message: 'Error message' }],
      warnings: [{ severity: 'warning', field: 'fieldB', message: 'Warning message' }],
    };

    const formatted = formatValidationIssues(result);

    expect(formatted).toContain('❌ [fieldA] Error message');
    expect(formatted).toContain('⚠️ [fieldB] Warning message');
  });
});
