/**
 * Model Override API Contract Tests
 *
 * Validates schemas for /user/model-override endpoints.
 */

import { describe, it, expect } from 'vitest';
import {
  UserDefaultConfigSchema,
  ListModelOverridesResponseSchema,
  SetModelOverrideResponseSchema,
  SetDefaultConfigResponseSchema,
  ClearDefaultConfigResponseSchema,
  DeleteModelOverrideResponseSchema,
  SetModelOverrideBodySchema,
  SetDefaultConfigBodySchema,
} from './model-override.js';

/** Helper to create a valid model override summary */
function createValidOverrideSummary(overrides = {}) {
  return {
    personalityId: '550e8400-e29b-41d4-a716-446655440000',
    personalityName: 'Lilith',
    configId: '550e8400-e29b-41d4-a716-446655440001',
    configName: 'Claude Sonnet',
    ...overrides,
  };
}

describe('Model Override API Contract Tests', () => {
  describe('UserDefaultConfigSchema', () => {
    it('should accept valid config with values', () => {
      const data = { configId: 'config-123', configName: 'Claude Sonnet' };
      const result = UserDefaultConfigSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept config with null values (no default set)', () => {
      const data = { configId: null, configName: null };
      const result = UserDefaultConfigSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing configId', () => {
      const data = { configName: 'test' };
      const result = UserDefaultConfigSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing configName', () => {
      const data = { configId: 'test' };
      const result = UserDefaultConfigSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('ListModelOverridesResponseSchema', () => {
    it('should accept response with overrides', () => {
      const data = {
        overrides: [
          createValidOverrideSummary(),
          createValidOverrideSummary({
            personalityId: 'id-2',
            personalityName: 'Sarcastic Bot',
            configId: null,
            configName: null,
          }),
        ],
      };
      const result = ListModelOverridesResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept empty overrides array', () => {
      const data = { overrides: [] };
      const result = ListModelOverridesResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing overrides field', () => {
      const result = ListModelOverridesResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('SetModelOverrideResponseSchema', () => {
    it('should accept valid set response', () => {
      const data = { override: createValidOverrideSummary() };
      const result = SetModelOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response with null config (cleared override)', () => {
      const data = {
        override: createValidOverrideSummary({ configId: null, configName: null }),
      };
      const result = SetModelOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing override field', () => {
      const result = SetModelOverrideResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('SetDefaultConfigResponseSchema', () => {
    it('should accept valid set default response', () => {
      const data = {
        default: { configId: 'config-123', configName: 'Claude Sonnet' },
      };
      const result = SetDefaultConfigResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response with null values', () => {
      const data = {
        default: { configId: null, configName: null },
      };
      const result = SetDefaultConfigResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing default field', () => {
      const result = SetDefaultConfigResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ClearDefaultConfigResponseSchema', () => {
    it('should accept valid clear response', () => {
      const data = { deleted: true as const };
      const result = ClearDefaultConfigResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject deleted=false', () => {
      const data = { deleted: false };
      const result = ClearDefaultConfigResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing deleted field', () => {
      const result = ClearDefaultConfigResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('DeleteModelOverrideResponseSchema', () => {
    it('should accept valid delete response', () => {
      const data = { deleted: true as const };
      const result = DeleteModelOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject deleted=false', () => {
      const data = { deleted: false };
      const result = DeleteModelOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing deleted field', () => {
      const result = DeleteModelOverrideResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // ================================================================
  // Input Schema Tests
  // ================================================================

  describe('SetModelOverrideBodySchema', () => {
    it('should accept valid body', () => {
      const data = { personalityId: 'some-personality-id', configId: 'some-config-id' };
      const result = SetModelOverrideBodySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing personalityId', () => {
      const data = { configId: 'some-config-id' };
      const result = SetModelOverrideBodySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty personalityId', () => {
      const data = { personalityId: '', configId: 'some-config-id' };
      const result = SetModelOverrideBodySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing configId', () => {
      const data = { personalityId: 'some-personality-id' };
      const result = SetModelOverrideBodySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty configId', () => {
      const data = { personalityId: 'some-personality-id', configId: '' };
      const result = SetModelOverrideBodySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('SetDefaultConfigBodySchema', () => {
    it('should accept valid body', () => {
      const data = { configId: 'some-config-id' };
      const result = SetDefaultConfigBodySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing configId', () => {
      const result = SetDefaultConfigBodySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject empty configId', () => {
      const data = { configId: '' };
      const result = SetDefaultConfigBodySchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
