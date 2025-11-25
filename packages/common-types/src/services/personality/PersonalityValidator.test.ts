/**
 * PersonalityValidator Unit Tests
 * Tests Zod schemas and validation logic
 */

import { describe, it, expect } from 'vitest';
import { LlmConfigSchema, parseLlmConfig } from './PersonalityValidator.js';
import { Decimal } from '@prisma/client/runtime/client';

describe('PersonalityValidator', () => {
  describe('LlmConfigSchema', () => {
    it('should validate valid config with all fields', () => {
      const config = {
        model: 'anthropic/claude-sonnet-4.5',
        visionModel: 'anthropic/claude-sonnet-4.5',
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        topK: 40,
        frequencyPenalty: 0.5,
        presencePenalty: 0.5,
        memoryScoreThreshold: 0.7,
        memoryLimit: 10,
        contextWindowTokens: 200000,
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept minimal config with only model', () => {
      const config = {
        model: 'anthropic/claude-sonnet-4.5',
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept null config', () => {
      const result = LlmConfigSchema.safeParse(null);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should accept undefined config', () => {
      const result = LlmConfigSchema.safeParse(undefined);
      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it('should convert Prisma Decimal to number', () => {
      const config = {
        model: 'test-model',
        temperature: new Decimal(0.7),
        topP: new Decimal(0.9),
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data?.temperature).toBe('number');
        expect(result.data?.temperature).toBe(0.7);
        expect(typeof result.data?.topP).toBe('number');
        expect(result.data?.topP).toBe(0.9);
      }
    });

    it('should reject temperature out of range', () => {
      const config = {
        model: 'test-model',
        temperature: 3.0, // Max is 2.0
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject negative maxTokens', () => {
      const config = {
        model: 'test-model',
        maxTokens: -100,
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject topP out of range', () => {
      const config = {
        model: 'test-model',
        topP: 1.5, // Max is 1.0
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject topK above maximum', () => {
      const config = {
        model: 'test-model',
        topK: 2000, // Max is 1000
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject contextWindowTokens above maximum', () => {
      const config = {
        model: 'test-model',
        contextWindowTokens: 3000000, // Max is 2000000
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('parseLlmConfig', () => {
    it('should parse valid config', () => {
      const dbConfig = {
        model: 'anthropic/claude-sonnet-4.5',
        visionModel: null,
        temperature: new Decimal(0.7),
        maxTokens: 4096,
        topP: null,
        topK: null,
        frequencyPenalty: null,
        presencePenalty: null,
        memoryScoreThreshold: new Decimal(0.7),
        memoryLimit: 10,
        contextWindowTokens: 200000,
      };

      const result = parseLlmConfig(dbConfig);
      expect(result).not.toBeNull();
      expect(result?.model).toBe('anthropic/claude-sonnet-4.5');
      expect(result?.temperature).toBe(0.7);
      expect(result?.maxTokens).toBe(4096);
    });

    it('should handle config with invalid types gracefully', () => {
      const invalidConfig = {
        model: 'test-model',
        temperature: 'invalid', // Should be number, but coerceToNumber converts to undefined
      };

      const result = parseLlmConfig(invalidConfig);
      // The coercion function converts invalid values to undefined, which is valid for optional fields
      expect(result).not.toBeNull();
      expect(result?.model).toBe('test-model');
      expect(result?.temperature).toBeUndefined();
    });

    it('should return null for null config', () => {
      const result = parseLlmConfig(null);
      expect(result).toBeNull();
    });

    it('should handle config with out-of-range values', () => {
      const invalidConfig = {
        model: 'test-model',
        temperature: 5.0, // Out of range
      };

      const result = parseLlmConfig(invalidConfig);
      expect(result).toBeNull();
    });
  });
});
