import { describe, it, expect } from 'vitest';
import {
  SYSTEM_SETTINGS_REGISTRY,
  SYSTEM_SETTINGS_KEYS,
} from '@tzurot/common-types/schemas/api/systemSettings';
import {
  SYSTEM_SETTINGS_DEFINITIONS,
  SYSTEM_SETTINGS_PAGES,
  isSystemSettingId,
} from './systemSettingsConfig.js';
import { SettingType } from './types.js';

describe('SYSTEM_SETTINGS_DEFINITIONS (registry derivation)', () => {
  it('derives one definition per registry key, in registry order', () => {
    expect(SYSTEM_SETTINGS_DEFINITIONS.map(d => d.id)).toEqual([...SYSTEM_SETTINGS_KEYS]);
  });

  it('every definition is plainDisplay (non-cascading bag)', () => {
    for (const def of SYSTEM_SETTINGS_DEFINITIONS) {
      expect(def.plainDisplay, def.id).toBe(true);
    }
  });

  it('maps controls to the right SettingTypes', () => {
    const byId = new Map(SYSTEM_SETTINGS_DEFINITIONS.map(d => [d.id, d]));
    expect(byId.get('extractionEnabled')?.type).toBe(SettingType.BOOLEAN);
    expect(byId.get('extractionBatchThreshold')?.type).toBe(SettingType.NUMERIC);
    expect(byId.get('extractionProvider')?.type).toBe(SettingType.ENUM);
    expect(byId.get('fallbackTextModel')?.type).toBe(SettingType.TEXT);
  });

  it('integer definitions ALWAYS carry an explicit max (the modal parser defaults an absent max to 100)', () => {
    for (const def of SYSTEM_SETTINGS_DEFINITIONS) {
      if (def.type === SettingType.NUMERIC) {
        expect(def.min, def.id).toBeDefined();
        expect(def.max, def.id).toBeDefined();
      }
    }
    // Unbounded-above budgets must accept large values, not inherit the 100 default.
    const budget = SYSTEM_SETTINGS_DEFINITIONS.find(d => d.id === 'freeTierGlobalDailyBudget');
    expect(budget?.max).toBe(Number.MAX_SAFE_INTEGER);
    // Bounded entries mirror the registry (and thus, via the parity test, the schema).
    const headroom = SYSTEM_SETTINGS_DEFINITIONS.find(d => d.id === 'zaiHeadroomPercent');
    expect(headroom?.min).toBe(1);
    expect(headroom?.max).toBe(99);
  });

  it('enum choices come from the registry with no reserved values', () => {
    const provider = SYSTEM_SETTINGS_DEFINITIONS.find(d => d.id === 'extractionProvider');
    expect(provider?.choices?.map(c => c.value)).toEqual(['openrouter', 'zai-coding']);
    for (const choice of provider?.choices ?? []) {
      expect(['auto', 'true', 'false']).not.toContain(choice.value);
    }
  });

  it('model definitions carry validation-rule help text', () => {
    const freeFloor = SYSTEM_SETTINGS_DEFINITIONS.find(d => d.id === 'fallbackTextModelFree');
    expect(freeFloor?.type).toBe(SettingType.TEXT);
    expect(freeFloor?.helpText).toContain('free-route models only');
    const paidFloor = SYSTEM_SETTINGS_DEFINITIONS.find(d => d.id === 'fallbackTextModel');
    expect(paidFloor?.helpText).toContain('fails closed');
  });

  it('every registry key has a bespoke emoji and every enum choice a human label (the hand-maintained maps must not silently lag the registry)', () => {
    // The ⚙️/raw-value fallbacks are graceful-degradation paths, not a licence
    // to skip the maps when adding setting #18 — this pins the maps complete.
    for (const def of SYSTEM_SETTINGS_DEFINITIONS) {
      expect(def.emoji, `missing bespoke emoji for ${def.id}`).not.toBe('⚙️');
      if (def.type === SettingType.ENUM) {
        for (const choice of def.choices ?? []) {
          expect(choice.label, `missing human label for enum value ${choice.value}`).not.toBe(
            choice.value
          );
        }
      }
    }
  });
});

describe('SYSTEM_SETTINGS_PAGES', () => {
  it('renders four concern pages covering every registry key exactly once', () => {
    expect(SYSTEM_SETTINGS_PAGES.map(p => p.label)).toEqual([
      'System · Extraction',
      'System · Free Tier — Fair Share',
      'System · Free Tier — z.ai',
      'System · Models & Limits',
    ]);
    const allIds = SYSTEM_SETTINGS_PAGES.flatMap(p => p.settingIds);
    expect([...allIds].sort()).toEqual([...SYSTEM_SETTINGS_KEYS].sort());
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('every page id resolves against the registry group it names', () => {
    for (const page of SYSTEM_SETTINGS_PAGES) {
      for (const id of page.settingIds) {
        const meta = SYSTEM_SETTINGS_REGISTRY[id as keyof typeof SYSTEM_SETTINGS_REGISTRY];
        expect(page.id).toBe(`system-${meta.group}`);
      }
    }
  });

  it('every page stays within the design ceiling (≤6 settings per page)', () => {
    for (const page of SYSTEM_SETTINGS_PAGES) {
      expect(page.settingIds.length, page.label).toBeLessThanOrEqual(6);
    }
  });
});

describe('isSystemSettingId (dispatch membership)', () => {
  it('is true exactly for registry keys', () => {
    expect(isSystemSettingId('extractionEnabled')).toBe(true);
    expect(isSystemSettingId('fallbackVisionModelFree')).toBe(true);
    // Cascade ids and unknowns are NOT system settings.
    expect(isSystemSettingId('maxMessages')).toBe(false);
    expect(isSystemSettingId('voiceResponseMode')).toBe(false);
    expect(isSystemSettingId('nonexistent')).toBe(false);
  });
});
