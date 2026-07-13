import { describe, it, expect } from 'vitest';
import { createTestConfig } from '../../config/config.js';
import { AUTO_ROUTER_MODEL, FREE_ROUTER_MODEL, isFreeModel } from '../../constants/ai.js';
import {
  SystemSettingsSchema,
  StoredSystemSettingsSchema,
  SYSTEM_SETTINGS_REGISTRY,
  SYSTEM_SETTINGS_KEYS,
  SYSTEM_SETTINGS_FALLBACKS,
  buildSystemSettingsSeed,
  GetSystemSettingsResponseSchema,
  UpdateSystemSettingsRequestSchema,
  UpdateSystemSettingsResponseSchema,
  type SystemSettings,
} from './systemSettings.js';

describe('SYSTEM_SETTINGS_REGISTRY completeness', () => {
  it('has an entry for every schema key (inverse of the compile-time check)', () => {
    const schemaKeys = Object.keys(SystemSettingsSchema.shape).sort();
    const registryKeys = [...SYSTEM_SETTINGS_KEYS].sort();
    expect(registryKeys).toEqual(schemaKeys);
  });

  it('every entry key field matches its record key', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      expect(SYSTEM_SETTINGS_REGISTRY[key].key).toBe(key);
    }
  });

  it('model metadata is present exactly on model-control entries', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      expect(meta.model !== undefined).toBe(meta.control === 'model');
    }
  });

  it('choices are present exactly on enum-control entries', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      expect(meta.choices !== undefined).toBe(meta.control === 'enum');
    }
  });

  it('bounds metadata is present exactly on integer-control entries', () => {
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      expect(meta.min !== undefined).toBe(meta.control === 'integer');
      if (meta.max !== undefined) {
        expect(meta.control).toBe('integer');
      }
    }
  });

  it('registry bounds behaviorally match the zod schema (the no-drift parity check)', () => {
    // The schema stays authoritative for validation; the registry mirrors bounds
    // for input surfaces. Parity is asserted behaviorally (accept/reject at the
    // boundary), so it survives zod internals changing shape.
    for (const key of SYSTEM_SETTINGS_KEYS) {
      const meta = SYSTEM_SETTINGS_REGISTRY[key];
      if (meta.control !== 'integer' || meta.min === undefined) {
        continue;
      }
      const field = SystemSettingsSchema.shape[key];
      expect(field.safeParse(meta.min).success, `${key} accepts min`).toBe(true);
      expect(field.safeParse(meta.min - 1).success, `${key} rejects min-1`).toBe(false);
      if (meta.max !== undefined) {
        expect(field.safeParse(meta.max).success, `${key} accepts max`).toBe(true);
        expect(field.safeParse(meta.max + 1).success, `${key} rejects max+1`).toBe(false);
      } else {
        expect(field.safeParse(Number.MAX_SAFE_INTEGER).success, `${key} is unbounded above`).toBe(
          true
        );
      }
    }
  });
});

describe('fallbacks (the floor beneath the floor)', () => {
  it('the full fallback bag parses against the resolved schema', () => {
    expect(() => SystemSettingsSchema.parse(SYSTEM_SETTINGS_FALLBACKS)).not.toThrow();
  });

  it('feature flags fall back OFF (a lost DB never silently enables a feature)', () => {
    expect(SYSTEM_SETTINGS_FALLBACKS.extractionEnabled).toBe(false);
    expect(SYSTEM_SETTINGS_FALLBACKS.factsInPromptEnabled).toBe(false);
    expect(SYSTEM_SETTINGS_FALLBACKS.zaiFreeTierEnabled).toBe(false);
  });

  it('free floors fall back to a free-route model (billing firewall holds even at the floor)', () => {
    expect(isFreeModel(SYSTEM_SETTINGS_FALLBACKS.fallbackTextModelFree)).toBe(true);
    expect(isFreeModel(SYSTEM_SETTINGS_FALLBACKS.fallbackVisionModelFree)).toBe(true);
  });
});

describe('buildSystemSettingsSeed', () => {
  it('produces a bag that parses against the resolved schema', () => {
    const seed = buildSystemSettingsSeed(createTestConfig());
    expect(() => SystemSettingsSchema.parse(seed)).not.toThrow();
  });

  it('preserves current env values for migrating settings', () => {
    const env = createTestConfig({
      EXTRACTION_ENABLED: 'true',
      EXTRACTION_BATCH_THRESHOLD: 12,
      ZAI_FREE_TIER_HEADROOM_PERCENT: 40,
      EXTRACTION_MODEL: 'custom/extractor',
      EXTRACTION_PROVIDER: 'zai-coding',
    });
    const seed = buildSystemSettingsSeed(env);
    expect(seed.extractionEnabled).toBe(true);
    expect(seed.extractionBatchThreshold).toBe(12);
    expect(seed.zaiHeadroomPercent).toBe(40);
    expect(seed.extractionModel).toBe('custom/extractor');
    expect(seed.extractionProvider).toBe('zai-coding');
  });

  it('flag settings seed false when env is unset (dark by default)', () => {
    const seed = buildSystemSettingsSeed(createTestConfig());
    expect(seed.extractionEnabled).toBe(false);
    expect(seed.factsInPromptEnabled).toBe(false);
    expect(seed.zaiFreeTierEnabled).toBe(false);
  });

  it('floors seed the router aliases, ignoring env values (owner directives 7/8)', () => {
    const env = createTestConfig({
      DEFAULT_AI_MODEL: 'anthropic/claude-haiku-4.5',
      VISION_FALLBACK_MODEL: 'qwen/some-vision-model',
    });
    const seed = buildSystemSettingsSeed(env);
    expect(seed.fallbackTextModel).toBe(AUTO_ROUTER_MODEL);
    expect(seed.fallbackVisionModel).toBe(AUTO_ROUTER_MODEL);
    expect(seed.fallbackTextModelFree).toBe(FREE_ROUTER_MODEL);
    expect(seed.fallbackVisionModelFree).toBe(FREE_ROUTER_MODEL);
  });
});

describe('StoredSystemSettingsSchema (the stored bag)', () => {
  it('preserves unknown keys (rolling-deploy clobber protection)', () => {
    const parsed = StoredSystemSettingsSchema.parse({
      extractionEnabled: true,
      futureSettingFromNewerDeploy: 'kept',
    });
    expect(parsed).toHaveProperty('futureSettingFromNewerDeploy', 'kept');
  });

  it('accepts a partial bag', () => {
    expect(() => StoredSystemSettingsSchema.parse({ zaiHeadroomPercent: 50 })).not.toThrow();
  });

  it('rejects a known key with the wrong type', () => {
    const result = StoredSystemSettingsSchema.safeParse({ zaiHeadroomPercent: 'lots' });
    expect(result.success).toBe(false);
  });
});

describe('SystemSettingsSchema bounds (mirror the env schema ranges)', () => {
  const valid: SystemSettings = { ...SYSTEM_SETTINGS_FALLBACKS };

  it.each([
    ['extractionBatchThreshold', 0, 51],
    ['freeTierWindowMinutes', 0, 1441],
    ['zaiHeadroomPercent', 0, 100],
  ] as const)('%s rejects values outside its env-schema range', (key, below, above) => {
    expect(SystemSettingsSchema.safeParse({ ...valid, [key]: below }).success).toBe(false);
    expect(SystemSettingsSchema.safeParse({ ...valid, [key]: above }).success).toBe(false);
  });

  it.each([
    'freeTierGlobalDailyBudget',
    'freeTierMinPerWindow',
    'freeTierMaxPerWindow',
    'zaiGlobalDailyBudget',
    'publicRateLimitPerMin',
  ] as const)('%s rejects zero and non-integers', key => {
    expect(SystemSettingsSchema.safeParse({ ...valid, [key]: 0 }).success).toBe(false);
    expect(SystemSettingsSchema.safeParse({ ...valid, [key]: 1.5 }).success).toBe(false);
  });

  it('model fields reject empty strings (floors are never-empty by construction)', () => {
    for (const key of [
      'fallbackTextModel',
      'fallbackVisionModel',
      'fallbackTextModelFree',
      'fallbackVisionModelFree',
      'extractionModel',
    ] as const) {
      expect(SystemSettingsSchema.safeParse({ ...valid, [key]: '' }).success).toBe(false);
    }
  });
});

describe('UpdateSystemSettingsRequestSchema (wire contract)', () => {
  it('rejects unknown keys in the patch (a typo, not drift)', () => {
    const result = UpdateSystemSettingsRequestSchema.safeParse({
      expectedUpdatedAt: '2026-07-12T00:00:00.000Z',
      patch: { extractoinEnabled: true },
    });
    expect(result.success).toBe(false);
  });

  it('requires the optimistic-concurrency token', () => {
    const result = UpdateSystemSettingsRequestSchema.safeParse({
      patch: { extractionEnabled: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed (non-datetime) concurrency token', () => {
    const result = UpdateSystemSettingsRequestSchema.safeParse({
      expectedUpdatedAt: 'not-a-date',
      patch: { extractionEnabled: true },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a single-key patch with the token', () => {
    const result = UpdateSystemSettingsRequestSchema.safeParse({
      expectedUpdatedAt: '2026-07-12T00:00:00.000Z',
      patch: { zaiHeadroomPercent: 60 },
    });
    expect(result.success).toBe(true);
  });
});

describe('response wire contracts', () => {
  it('GetSystemSettingsResponseSchema carries the bag (unknown keys preserved) + token', () => {
    const parsed = GetSystemSettingsResponseSchema.parse({
      systemSettings: { zaiHeadroomPercent: 60, futureKey: 'preserved' },
      updatedAt: '2026-07-12T10:00:00.000Z',
    });
    expect(parsed.systemSettings).toHaveProperty('futureKey', 'preserved');
    expect(GetSystemSettingsResponseSchema.safeParse({ systemSettings: {} }).success).toBe(false);
  });

  it('UpdateSystemSettingsResponseSchema requires the warnings array', () => {
    const parsed = UpdateSystemSettingsResponseSchema.parse({
      systemSettings: { extractionEnabled: true },
      updatedAt: '2026-07-12T10:00:00.000Z',
      warnings: ['catalog unavailable'],
    });
    expect(parsed.warnings).toHaveLength(1);
    expect(
      UpdateSystemSettingsResponseSchema.safeParse({
        systemSettings: {},
        updatedAt: '2026-07-12T10:00:00.000Z',
      }).success
    ).toBe(false);
  });
});
