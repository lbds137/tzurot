/**
 * PersonalityValidator Unit Tests
 * Tests Zod schemas and validation logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmConfigSchema } from './PersonalityValidator.js';
import { Decimal } from '@prisma/client/runtime/client';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return { ...actual, createLogger: () => mockLogger };
});

describe('PersonalityValidator', () => {
  describe('LlmConfigSchema', () => {
    it('should validate valid config with all fields', () => {
      const config = {
        model: 'anthropic/claude-sonnet-4.5',
        provider: 'openrouter',
        temperature: 0.7,
        maxTokens: 4096,
        topP: 0.9,
        topK: 40,
        frequencyPenalty: 0.5,
        presencePenalty: 0.5,
        contextWindowTokens: 200000,
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept minimal config with only model', () => {
      const config = {
        model: 'anthropic/claude-sonnet-4.5',
        provider: 'openrouter',
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
        provider: 'openrouter',
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
        provider: 'openrouter',
        temperature: 3.0, // Max is 2.0
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject negative maxTokens', () => {
      const config = {
        model: 'test-model',
        provider: 'openrouter',
        maxTokens: -100,
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject topP out of range', () => {
      const config = {
        model: 'test-model',
        provider: 'openrouter',
        topP: 1.5, // Max is 1.0
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject topK above maximum', () => {
      const config = {
        model: 'test-model',
        provider: 'openrouter',
        topK: 2000, // Max is 1000
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject contextWindowTokens above maximum', () => {
      const config = {
        model: 'test-model',
        provider: 'openrouter',
        contextWindowTokens: 3000000, // Max is 2000000
      };

      const result = LlmConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('coerceToNumber (driven via LlmConfigSchema.safeParse)', () => {
    beforeEach(() => {
      mockLogger.warn.mockClear();
    });

    // The named guard does nothing visible on the CORRECT path — `val !== null`
    // is false for a bare null, so the Decimal branch is skipped and the final
    // `val === null` branch is what returns undefined. The guard is still what
    // this test pins: drop it (mutate to `true`) and `'toNumber' in null` throws
    // a TypeError, because `in` requires an object. Verified by canary — that
    // mutation reddens this test and 'does not warn for an explicit null value',
    // and no other test supplies a null to reach it.
    it('parses successfully when temperature is explicit null (val !== null guard)', () => {
      const result = LlmConfigSchema.safeParse({ temperature: null });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.temperature).toBeUndefined();
      }
    });

    it('parses successfully and warns when temperature is an object with a non-function toNumber (callability, not mere presence)', () => {
      const result = LlmConfigSchema.safeParse({
        temperature: { toNumber: 'not-a-function' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.temperature).toBeUndefined();
      }
      expect(mockLogger.warn.mock.calls).toEqual([
        [
          { val: { toNumber: 'not-a-function' }, type: 'object' },
          'Unexpected value type in coerceToNumber',
        ],
      ]);
    });

    it('parses successfully with the field absent when temperature is an unexpected string type (no validation error)', () => {
      const result = LlmConfigSchema.safeParse({ temperature: 'abc' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.temperature).toBeUndefined();
      }
    });

    it('does not warn for an explicit null value', () => {
      LlmConfigSchema.safeParse({ temperature: null });
      expect(mockLogger.warn.mock.calls).toEqual([]);
    });

    it('does not warn when the key is absent entirely', () => {
      LlmConfigSchema.safeParse({});
      expect(mockLogger.warn.mock.calls).toEqual([]);
    });

    it('warns exactly once with the exact payload for an unexpected string type', () => {
      LlmConfigSchema.safeParse({ temperature: 'abc' });
      expect(mockLogger.warn.mock.calls).toEqual([
        [{ val: 'abc', type: 'string' }, 'Unexpected value type in coerceToNumber'],
      ]);
    });

    it.each([0, 1, 2])('accepts repetitionPenalty %s within the [0, 2] range', value => {
      const result = LlmConfigSchema.safeParse({ repetitionPenalty: value });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.repetitionPenalty).toBe(value);
      }
    });

    it.each([2.5, -0.5])('rejects repetitionPenalty %s outside the [0, 2] range', value => {
      const result = LlmConfigSchema.safeParse({ repetitionPenalty: value });
      expect(result.success).toBe(false);
    });
  });
});
