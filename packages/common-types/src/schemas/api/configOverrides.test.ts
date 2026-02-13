/**
 * ConfigOverrides Schema Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ConfigOverridesSchema,
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrides,
} from './configOverrides.js';

describe('ConfigOverridesSchema', () => {
  describe('valid inputs', () => {
    it('should accept an empty object (all optional)', () => {
      const result = ConfigOverridesSchema.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('should accept a single field override', () => {
      const result = ConfigOverridesSchema.safeParse({ maxMessages: 25 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ maxMessages: 25 });
    });

    it('should accept all fields at once', () => {
      const full: ConfigOverrides = {
        maxMessages: 75,
        maxAge: 86400,
        maxImages: 5,
        memoryScoreThreshold: 0.8,
        memoryLimit: 10,
        focusModeEnabled: true,
      };
      const result = ConfigOverridesSchema.safeParse(full);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(full);
    });

    it('should accept maxAge as null (no limit)', () => {
      const result = ConfigOverridesSchema.safeParse({ maxAge: null });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ maxAge: null });
    });

    it('should accept maxAge as 0 (disabled)', () => {
      const result = ConfigOverridesSchema.safeParse({ maxAge: 0 });
      expect(result.success).toBe(true);
    });

    it('should accept boundary values', () => {
      const result = ConfigOverridesSchema.safeParse({
        maxMessages: 1,
        maxImages: 0,
        memoryScoreThreshold: 0,
        memoryLimit: 0,
      });
      expect(result.success).toBe(true);
    });

    it('should accept upper boundary values', () => {
      const result = ConfigOverridesSchema.safeParse({
        maxMessages: 100,
        maxImages: 20,
        memoryScoreThreshold: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('should reject maxMessages below minimum', () => {
      const result = ConfigOverridesSchema.safeParse({ maxMessages: 0 });
      expect(result.success).toBe(false);
    });

    it('should reject maxMessages above maximum', () => {
      const result = ConfigOverridesSchema.safeParse({ maxMessages: 101 });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer maxMessages', () => {
      const result = ConfigOverridesSchema.safeParse({ maxMessages: 25.5 });
      expect(result.success).toBe(false);
    });

    it('should reject negative maxAge', () => {
      const result = ConfigOverridesSchema.safeParse({ maxAge: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject maxImages above maximum', () => {
      const result = ConfigOverridesSchema.safeParse({ maxImages: 21 });
      expect(result.success).toBe(false);
    });

    it('should reject negative maxImages', () => {
      const result = ConfigOverridesSchema.safeParse({ maxImages: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject memoryScoreThreshold below 0', () => {
      const result = ConfigOverridesSchema.safeParse({ memoryScoreThreshold: -0.1 });
      expect(result.success).toBe(false);
    });

    it('should reject memoryScoreThreshold above 1', () => {
      const result = ConfigOverridesSchema.safeParse({ memoryScoreThreshold: 1.1 });
      expect(result.success).toBe(false);
    });

    it('should reject negative memoryLimit', () => {
      const result = ConfigOverridesSchema.safeParse({ memoryLimit: -1 });
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean focusModeEnabled', () => {
      const result = ConfigOverridesSchema.safeParse({ focusModeEnabled: 'yes' });
      expect(result.success).toBe(false);
    });
  });

  describe('strict mode', () => {
    it('should reject unknown keys', () => {
      const result = ConfigOverridesSchema.safeParse({
        maxMessages: 50,
        unknownField: 'should fail',
      });
      expect(result.success).toBe(false);
    });

    it('should reject llm-related fields (not part of config overrides)', () => {
      const result = ConfigOverridesSchema.safeParse({
        model: 'openai/gpt-4o',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('HARDCODED_CONFIG_DEFAULTS', () => {
  it('should have all required fields defined', () => {
    expect(HARDCODED_CONFIG_DEFAULTS.maxMessages).toBe(50);
    expect(HARDCODED_CONFIG_DEFAULTS.maxAge).toBeNull();
    expect(HARDCODED_CONFIG_DEFAULTS.maxImages).toBe(10);
    expect(HARDCODED_CONFIG_DEFAULTS.memoryScoreThreshold).toBe(0.5);
    expect(HARDCODED_CONFIG_DEFAULTS.memoryLimit).toBe(20);
    expect(HARDCODED_CONFIG_DEFAULTS.focusModeEnabled).toBe(false);
  });

  it('should pass schema validation', () => {
    // Defaults should be valid ConfigOverrides (minus the null maxAge which is valid)
    const result = ConfigOverridesSchema.safeParse({
      maxMessages: HARDCODED_CONFIG_DEFAULTS.maxMessages,
      maxAge: HARDCODED_CONFIG_DEFAULTS.maxAge,
      maxImages: HARDCODED_CONFIG_DEFAULTS.maxImages,
      memoryScoreThreshold: HARDCODED_CONFIG_DEFAULTS.memoryScoreThreshold,
      memoryLimit: HARDCODED_CONFIG_DEFAULTS.memoryLimit,
      focusModeEnabled: HARDCODED_CONFIG_DEFAULTS.focusModeEnabled,
    });
    expect(result.success).toBe(true);
  });
});
