/**
 * ConfigOverrides Schema Tests
 */

import { describe, it, expect } from 'vitest';
import { AI_DEFAULTS } from '../../constants/ai.js';
import {
  ConfigOverridesSchema,
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrides,
  ResolvedConfigOverridesSchema,
  ResolveUserConfigDefaultsResponseSchema,
  GetUserConfigDefaultsResponseSchema,
  UpdateConfigDefaultsResponseSchema,
  ClearUserConfigDefaultsResponseSchema,
  UpdatePersonalityConfigOverridesResponseSchema,
  ClearPersonalityConfigOverridesResponseSchema,
  GetChannelConfigOverridesResponseSchema,
  UpdateChannelConfigOverridesRequestSchema,
  UpdateChannelConfigOverridesResponseSchema,
  ClearChannelConfigOverridesResponseSchema,
  CONFIG_OVERRIDES_KEYS,
  NULL_TERMINAL_FIELDS,
  isNullTerminalField,
  CONFIG_WIRE_OFF,
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
        showModelFooter: false,
      };
      const result = ConfigOverridesSchema.safeParse(full);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(full);
    });

    it('should accept showModelFooter as boolean', () => {
      expect(ConfigOverridesSchema.safeParse({ showModelFooter: true }).success).toBe(true);
      expect(ConfigOverridesSchema.safeParse({ showModelFooter: false }).success).toBe(true);
    });

    it('should accept voiceResponseMode enum values', () => {
      expect(ConfigOverridesSchema.safeParse({ voiceResponseMode: 'always' }).success).toBe(true);
      expect(ConfigOverridesSchema.safeParse({ voiceResponseMode: 'voice-only' }).success).toBe(
        true
      );
      expect(ConfigOverridesSchema.safeParse({ voiceResponseMode: 'never' }).success).toBe(true);
    });

    it('should accept voiceTranscriptionEnabled as boolean', () => {
      expect(ConfigOverridesSchema.safeParse({ voiceTranscriptionEnabled: true }).success).toBe(
        true
      );
      expect(ConfigOverridesSchema.safeParse({ voiceTranscriptionEnabled: false }).success).toBe(
        true
      );
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

    it('should reject non-boolean showModelFooter', () => {
      const result = ConfigOverridesSchema.safeParse({ showModelFooter: 'yes' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid voiceResponseMode value', () => {
      const result = ConfigOverridesSchema.safeParse({ voiceResponseMode: 'sometimes' });
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean voiceTranscriptionEnabled', () => {
      const result = ConfigOverridesSchema.safeParse({ voiceTranscriptionEnabled: 'yes' });
      expect(result.success).toBe(false);
    });
  });

  describe('unknown key handling', () => {
    it('should strip unknown keys from input', () => {
      const result = ConfigOverridesSchema.safeParse({
        maxMessages: 50,
        unknownField: 'should be stripped',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ maxMessages: 50 });
      expect(result.data).not.toHaveProperty('unknownField');
    });

    it('should strip llm-related fields (not part of config overrides)', () => {
      const result = ConfigOverridesSchema.safeParse({
        model: 'openai/gpt-4o',
        provider: 'openrouter',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
      expect(result.data).not.toHaveProperty('model');
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
    expect(HARDCODED_CONFIG_DEFAULTS.showModelFooter).toBe(true);
    expect(HARDCODED_CONFIG_DEFAULTS.voiceResponseMode).toBe('always');
    expect(HARDCODED_CONFIG_DEFAULTS.voiceTranscriptionEnabled).toBe(true);
  });

  it('should tie the memory defaults to AI_DEFAULTS (single source of truth)', () => {
    // The cascade baseline and the ai-worker retrieval fallback must agree, or a
    // request with no override would retrieve memories differently depending on
    // which path resolved it. The type-level `typeof AI_DEFAULTS.*` derivation on
    // HARDCODED_CONFIG_DEFAULTS makes drift a compile error; this asserts the tie
    // at runtime too so the intent is visible where the values are read.
    expect(HARDCODED_CONFIG_DEFAULTS.memoryScoreThreshold).toBe(AI_DEFAULTS.MEMORY_SCORE_THRESHOLD);
    expect(HARDCODED_CONFIG_DEFAULTS.memoryLimit).toBe(AI_DEFAULTS.MEMORY_LIMIT);
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

describe('CONFIG_OVERRIDES_KEYS', () => {
  it('lists every key in the ConfigOverrides schema (no drift)', () => {
    const schemaKeys = Object.keys(ConfigOverridesSchema.shape).sort();
    const tupleKeys = [...CONFIG_OVERRIDES_KEYS].sort();
    expect(tupleKeys).toEqual(schemaKeys);
  });

  it('produces an exhaustive key set (every HARDCODED_CONFIG_DEFAULTS key present)', () => {
    const defaultKeys = Object.keys(HARDCODED_CONFIG_DEFAULTS).sort();
    const tupleKeys = [...CONFIG_OVERRIDES_KEYS].sort();
    expect(tupleKeys).toEqual(defaultKeys);
  });
});

describe('Config-Overrides Response Schemas', () => {
  const fullyResolved = {
    ...HARDCODED_CONFIG_DEFAULTS,
    sources: Object.fromEntries(
      Object.keys(HARDCODED_CONFIG_DEFAULTS).map(k => [k, 'hardcoded' as const])
    ),
  };

  describe('ResolvedConfigOverridesSchema', () => {
    it('accepts the hardcoded baseline (all sources = hardcoded)', () => {
      expect(ResolvedConfigOverridesSchema.safeParse(fullyResolved).success).toBe(true);
    });

    it('rejects unknown source label', () => {
      const bad = { ...fullyResolved, sources: { maxMessages: 'bogus' } };
      expect(ResolvedConfigOverridesSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe('ResolveUserConfigDefaultsResponseSchema', () => {
    // Helper: emits the same exhaustive sources map the handler produces
    // (every ConfigOverrides field present, defaulting to 'hardcoded').
    const allHardcodedSources = Object.fromEntries(
      Object.keys(HARDCODED_CONFIG_DEFAULTS).map(k => [k, 'hardcoded' as const])
    );

    it('accepts flat shape with exhaustive sources + userOverrides', () => {
      const data = {
        ...HARDCODED_CONFIG_DEFAULTS,
        sources: { ...allHardcodedSources, maxMessages: 'user-default' as const },
        userOverrides: { maxMessages: 75 },
      };
      expect(ResolveUserConfigDefaultsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts null userOverrides with exhaustive sources + all ConfigOverrides fields', () => {
      const data = {
        ...HARDCODED_CONFIG_DEFAULTS,
        sources: allHardcodedSources,
        userOverrides: null,
      };
      expect(ResolveUserConfigDefaultsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects partial sources (Zod v4 record requires exhaustive keys)', () => {
      const data = {
        ...HARDCODED_CONFIG_DEFAULTS,
        sources: { maxMessages: 'hardcoded' as const },
        userOverrides: null,
      };
      expect(ResolveUserConfigDefaultsResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects responses missing ConfigOverrides fields (now strongly-typed at root)', () => {
      const data = {
        // Missing maxMessages, maxAge, etc. — schema now derived from
        // ConfigOverridesSchema.required() so these are mandatory.
        sources: allHardcodedSources,
        userOverrides: null,
      };
      expect(ResolveUserConfigDefaultsResponseSchema.safeParse(data).success).toBe(false);
    });
  });

  describe('GetUserConfigDefaultsResponseSchema', () => {
    it('accepts populated configDefaults', () => {
      const data = { configDefaults: { maxMessages: 30 } };
      expect(GetUserConfigDefaultsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts null configDefaults', () => {
      expect(GetUserConfigDefaultsResponseSchema.safeParse({ configDefaults: null }).success).toBe(
        true
      );
    });
  });

  describe('UpdateConfigDefaultsResponseSchema', () => {
    it('accepts merged configDefaults', () => {
      const data = { configDefaults: { maxMessages: 30, focusModeEnabled: true } };
      expect(UpdateConfigDefaultsResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects null configDefaults (PATCH always returns merged object)', () => {
      expect(UpdateConfigDefaultsResponseSchema.safeParse({ configDefaults: null }).success).toBe(
        false
      );
    });
  });

  describe('ClearUserConfigDefaultsResponseSchema', () => {
    it('accepts { success: true }', () => {
      expect(ClearUserConfigDefaultsResponseSchema.safeParse({ success: true }).success).toBe(true);
    });

    it('rejects success=false', () => {
      expect(ClearUserConfigDefaultsResponseSchema.safeParse({ success: false }).success).toBe(
        false
      );
    });
  });

  describe('UpdatePersonalityConfigOverridesResponseSchema', () => {
    it('accepts merged configOverrides', () => {
      const data = { configOverrides: { maxMessages: 30 } };
      expect(UpdatePersonalityConfigOverridesResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('ClearPersonalityConfigOverridesResponseSchema', () => {
    it('accepts { success: true }', () => {
      expect(
        ClearPersonalityConfigOverridesResponseSchema.safeParse({ success: true }).success
      ).toBe(true);
    });
  });

  describe('GetChannelConfigOverridesResponseSchema', () => {
    it('accepts populated configOverrides', () => {
      const data = { configOverrides: { maxMessages: 30 } };
      expect(GetChannelConfigOverridesResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts null configOverrides (no row yet)', () => {
      expect(
        GetChannelConfigOverridesResponseSchema.safeParse({ configOverrides: null }).success
      ).toBe(true);
    });

    it('rejects missing configOverrides field', () => {
      expect(GetChannelConfigOverridesResponseSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('UpdateChannelConfigOverridesRequestSchema', () => {
    it('accepts a partial overrides record', () => {
      const data = { maxMessages: 50, focusModeEnabled: true };
      expect(UpdateChannelConfigOverridesRequestSchema.safeParse(data).success).toBe(true);
    });

    it('accepts an empty object (no-op patch)', () => {
      expect(UpdateChannelConfigOverridesRequestSchema.safeParse({}).success).toBe(true);
    });

    it('accepts null field values (used to clear individual settings)', () => {
      expect(UpdateChannelConfigOverridesRequestSchema.safeParse({ maxAge: null }).success).toBe(
        true
      );
    });
  });

  describe('UpdateChannelConfigOverridesResponseSchema', () => {
    it('accepts merged configOverrides', () => {
      const data = { configOverrides: { maxMessages: 30, focusModeEnabled: true } };
      expect(UpdateChannelConfigOverridesResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects null configOverrides (PATCH always returns merged object)', () => {
      expect(
        UpdateChannelConfigOverridesResponseSchema.safeParse({ configOverrides: null }).success
      ).toBe(false);
    });
  });

  describe('ClearChannelConfigOverridesResponseSchema', () => {
    it('accepts { success: true }', () => {
      expect(ClearChannelConfigOverridesResponseSchema.safeParse({ success: true }).success).toBe(
        true
      );
    });

    it('rejects success=false', () => {
      expect(ClearChannelConfigOverridesResponseSchema.safeParse({ success: false }).success).toBe(
        false
      );
    });
  });
});

describe('NULL_TERMINAL_FIELDS registry', () => {
  it('matches the schema nullable set exactly — every field accepts null iff registered', () => {
    for (const key of CONFIG_OVERRIDES_KEYS) {
      const accepts = ConfigOverridesSchema.safeParse({ [key]: null }).success;
      expect(accepts, `${key}: nullable-in-schema must equal registry membership`).toBe(
        isNullTerminalField(key)
      );
    }
  });

  it('pins the hardcoded maxAge default to null forever', () => {
    // Legacy rows wrote "off" as key-absence (pre-sentinel write path stripped
    // nulls), so those users actually inherit — they experience OFF only
    // because this default is null. Changing it would silently flip their
    // setting. See the comment on HARDCODED_CONFIG_DEFAULTS.
    expect(HARDCODED_CONFIG_DEFAULTS.maxAge).toBeNull();
  });

  it('CONFIG_WIRE_OFF is not a legal stored value anywhere', () => {
    for (const key of NULL_TERMINAL_FIELDS) {
      expect(ConfigOverridesSchema.safeParse({ [key]: CONFIG_WIRE_OFF }).success).toBe(false);
    }
  });
});
