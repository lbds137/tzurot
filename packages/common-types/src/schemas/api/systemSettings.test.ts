import { describe, it, expect } from 'vitest';
import {
  SystemSettingsSchema,
  StoredSystemSettingsSchema,
  GetSystemSettingsResponseSchema,
  UpdateSystemSettingsRequestSchema,
  UpdateSystemSettingsResponseSchema,
  type SystemSettings,
} from './systemSettings.js';
import { SYSTEM_SETTINGS_FALLBACKS } from './systemSettingsRegistry.js';

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

  it('round-trips archiveSplitRenderPersonalities as a string array', () => {
    const result = StoredSystemSettingsSchema.safeParse({
      archiveSplitRenderPersonalities: ['a', 'b'],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.archiveSplitRenderPersonalities).toEqual(['a', 'b']);
  });

  it('enforces the slug character set on archiveSplitRenderPersonalities', () => {
    expect(
      StoredSystemSettingsSchema.safeParse({ archiveSplitRenderPersonalities: ['abc-1'] }).success
    ).toBe(true);
    expect(
      StoredSystemSettingsSchema.safeParse({ archiveSplitRenderPersonalities: ['MyPersona'] })
        .success
    ).toBe(false);
    expect(
      StoredSystemSettingsSchema.safeParse({ archiveSplitRenderPersonalities: [''] }).success
    ).toBe(false);
  });
});

describe('SystemSettingsSchema bounds (mirror the env schema ranges)', () => {
  const valid: SystemSettings = { ...SYSTEM_SETTINGS_FALLBACKS };

  it.each([
    ['extractionBatchThreshold', 0, 51],
    ['freeTierWindowMinutes', 0, 1441],
    ['zaiHeadroomPercent', 0, 100],
    ['nightlySyncHourUtc', -1, 24],
    ['multiTagMaxCharacters', 0, 11],
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

  it('archiveSplitRenderPersonalities rejects an empty-string entry', () => {
    expect(
      SystemSettingsSchema.safeParse({ ...valid, archiveSplitRenderPersonalities: [''] }).success
    ).toBe(false);
  });

  it('archiveSplitRenderPersonalities accepts an empty array', () => {
    expect(
      SystemSettingsSchema.safeParse({ ...valid, archiveSplitRenderPersonalities: [] }).success
    ).toBe(true);
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

  it('accepts archiveSplitRenderPersonalities in the patch', () => {
    const result = UpdateSystemSettingsRequestSchema.safeParse({
      expectedUpdatedAt: '2026-07-12T00:00:00.000Z',
      patch: { archiveSplitRenderPersonalities: ['nova', 'echo'] },
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
