/**
 * Tests for Preset Dashboard Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  flattenPresetData,
  unflattenPresetData,
  PRESET_DASHBOARD_CONFIG,
  NUMERIC_PARAMS,
  INTEGER_PARAMS,
  type PresetData,
  type FlattenedPresetData,
} from './config.js';
import { SectionStatus } from '../../utils/dashboard/types.js';
import {
  type AdvancedParams,
  AdvancedParamsSchema,
} from '@tzurot/common-types/schemas/llmAdvancedParams';
import { presetConfigValidator } from './presetValidation.js';
import { canProceed } from '../../utils/configValidation.js';

describe('flattenPresetData', () => {
  it('should flatten basic preset data', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: 'A test preset',
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: {},
    };

    const result = flattenPresetData(preset);

    expect(result.id).toBe('preset-123');
    expect(result.name).toBe('My Preset');
    expect(result.description).toBe('A test preset');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('anthropic/claude-sonnet-4');
    expect(result.isGlobal).toBe(false);
    expect(result.isOwned).toBe(true);
    expect(result.contextWindowTokens).toBe('8192');
  });

  it('should handle null description', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: true,
      isOwned: false,
      permissions: { canEdit: false, canDelete: false },
      contextWindowTokens: 8192,
      params: {},
    };

    const result = flattenPresetData(preset);

    expect(result.description).toBe('');
  });

  it('should flatten sampling params', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 50,
        max_tokens: 4096,
        seed: 42,
      },
    };

    const result = flattenPresetData(preset);

    expect(result.temperature).toBe('0.7');
    expect(result.top_p).toBe('0.9');
    expect(result.top_k).toBe('50');
    expect(result.max_tokens).toBe('4096');
    expect(result.seed).toBe('42');
  });

  it('should flatten penalty params', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: {
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        repetition_penalty: 1.1,
        min_p: 0.1,
        top_a: 0.2,
      },
    };

    const result = flattenPresetData(preset);

    expect(result.frequency_penalty).toBe('0.5');
    expect(result.presence_penalty).toBe('0.3');
    expect(result.repetition_penalty).toBe('1.1');
    expect(result.min_p).toBe('0.1');
    expect(result.top_a).toBe('0.2');
  });

  it('should flatten the thinking level', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: {
        thinking: 'high',
      },
    };

    const result = flattenPresetData(preset);

    expect(result.thinking).toBe('high');
  });

  it('should handle missing params as empty strings', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: {},
    };

    const result = flattenPresetData(preset);

    expect(result.temperature).toBe('');
    expect(result.top_p).toBe('');
    expect(result.frequency_penalty).toBe('');
    expect(result.thinking).toBe('');
  });

  it('should carry non-form params into nonFormParams (form keys excluded)', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: {
        temperature: 0.7,
        thinking: 'high',
        verbosity: 'high',
        logit_bias: { token1: -5 },
        response_format: { type: 'json_object' },
        transforms: ['middle-out'],
        route: 'fallback',
      },
    };

    const result = flattenPresetData(preset);

    expect(result.nonFormParams).toEqual({
      verbosity: 'high',
      logit_bias: { token1: -5 },
      response_format: { type: 'json_object' },
      transforms: ['middle-out'],
      route: 'fallback',
    });
  });

  it('should leave nonFormParams empty when no non-form params are stored', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      contextWindowTokens: 8192,
      params: { temperature: 0.7 },
    };

    expect(flattenPresetData(preset).nonFormParams).toEqual({});
  });

  it('should pass requiresZaiKey through for the dashboard badge', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'GLM Preset',
      description: null,
      model: 'z-ai/glm-5.2',
      provider: 'openrouter',
      isGlobal: true,
      isOwned: false,
      permissions: { canEdit: false, canDelete: false },
      contextWindowTokens: 8192,
      requiresZaiKey: true,
      params: {},
    };

    expect(flattenPresetData(preset).requiresZaiKey).toBe(true);

    // Absent on the source → absent on the flattened data (no badge).
    const { requiresZaiKey: _omit, ...withoutFlag } = preset;
    expect(flattenPresetData(withoutFlag).requiresZaiKey).toBeUndefined();
  });
});

describe('flattenPresetData — exponent-form round trip', () => {
  const exponentPreset: PresetData = {
    id: 'preset-123',
    name: 'Tiny And Big',
    description: null,
    model: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    isGlobal: false,
    isOwned: true,
    permissions: { canEdit: true, canDelete: true },
    contextWindowTokens: 8192,
    params: { min_p: 5e-7, seed: 1e21 },
  };

  it('flatten writes plain decimal strings for exponent-form stored values', () => {
    const result = flattenPresetData(exponentPreset);

    expect(result.min_p).toBe('0.0000005');
    expect(result.seed).toBe('1000000000000000000000');
  });

  it.each([
    { param: 'min_p', value: 1.5e-7, expected: '0.00000015' },
    { param: 'frequency_penalty', value: -5e-7, expected: '-0.0000005' },
    { param: 'seed', value: 1.2345e21, expected: '1234500000000000000000' },
  ] as const)(
    'flattens exponent-form $param ($value) to the plain decimal $expected',
    ({ param, value, expected }) => {
      const preset: PresetData = {
        ...exponentPreset,
        params: { [param]: value } as PresetData['params'],
      };

      expect(flattenPresetData(preset)[param]).toBe(expected);
    }
  );

  it('the flattened form validates with no edits (tiny decimal + big integer)', () => {
    // Number#toString emits exponent notation for these magnitudes; the form
    // strings must stay inside what the strict parser accepts, or every save
    // (name-only edits included) would fail on fields the user never touched.
    const flat = flattenPresetData(exponentPreset);

    const result = presetConfigValidator.validate(flat);

    expect(canProceed(result)).toBe(true);
  });

  it('a JSON null numeric param flattens to the blank form value and validates', () => {
    // The gateway's schema-validated detail cannot emit null (optional ≠
    // nullable, whole-blob fallback), so this pins the defensive branch:
    // flatten must treat null exactly like absent, or any null that reaches
    // it through session/fixture data makes the save path throw on fields
    // the user never touched.
    const nullPreset: PresetData = {
      ...exponentPreset,
      params: { min_p: null as unknown as number },
    };

    const flat = flattenPresetData(nullPreset);

    expect(flat.min_p).toBe('');
    expect(canProceed(presetConfigValidator.validate(flat))).toBe(true);
  });
});

describe('unflattenPresetData', () => {
  it('should unflatten basic fields', () => {
    const flat: Partial<FlattenedPresetData> = {
      name: 'Updated Name',
      description: 'Updated description',
      model: 'anthropic/claude-opus-4',
      provider: 'openrouter',
    };

    const result = unflattenPresetData(flat);

    expect(result.name).toBe('Updated Name');
    expect(result.description).toBe('Updated description');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('anthropic/claude-opus-4');
  });

  it('should set description to null when empty', () => {
    const flat: Partial<FlattenedPresetData> = {
      description: '',
    };

    const result = unflattenPresetData(flat);

    expect(result.description).toBeNull();
  });

  it('should unflatten numeric sampling params', () => {
    const flat: Partial<FlattenedPresetData> = {
      temperature: '0.8',
      top_p: '0.95',
      top_k: '40',
      max_tokens: '8192',
      seed: '123',
    };

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toEqual({
      temperature: 0.8,
      top_p: 0.95,
      top_k: 40,
      max_tokens: 8192,
      seed: 123,
    });
  });

  it('should unflatten penalty params', () => {
    const flat: Partial<FlattenedPresetData> = {
      frequency_penalty: '0.6',
      presence_penalty: '0.4',
      repetition_penalty: '1.2',
      min_p: '0.05',
      top_a: '0.15',
    };

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toEqual({
      frequency_penalty: 0.6,
      presence_penalty: 0.4,
      repetition_penalty: 1.2,
      min_p: 0.05,
      top_a: 0.15,
    });
  });

  it('should unflatten the thinking level', () => {
    const flat: Partial<FlattenedPresetData> = { thinking: 'medium' };

    const result = unflattenPresetData(flat);

    const advParams = result.advancedParameters as Record<string, unknown>;
    expect(advParams.thinking).toBe('medium');
  });

  it('should unflatten the xhigh level (newest enum member, pinned explicitly)', () => {
    const flat: Partial<FlattenedPresetData> = { thinking: 'xhigh' };

    const advParams = unflattenPresetData(flat).advancedParameters as Record<string, unknown>;
    expect(advParams.thinking).toBe('xhigh');
  });

  it('should unflatten an explicit off level (off is not absent)', () => {
    const flat: Partial<FlattenedPresetData> = { thinking: 'off' };

    const advParams = unflattenPresetData(flat).advancedParameters as Record<string, unknown>;
    expect(advParams.thinking).toBe('off');
  });

  it('should send an empty object for an unrecognized thinking level (key present)', () => {
    const flat: Partial<FlattenedPresetData> = {
      thinking: 'invalid',
    };

    const result = unflattenPresetData(flat);

    // The thinking key was submitted, so the object is still sent (wholesale
    // replace clears); the unparseable level itself is dropped.
    expect(result.advancedParameters).toEqual({});
  });

  it('should send an empty object when numeric params are blanked', () => {
    const flat: Partial<FlattenedPresetData> = {
      name: '',
      temperature: '',
      top_p: '',
    };

    const result = unflattenPresetData(flat);

    expect(result.name).toBeUndefined();
    expect(result.advancedParameters).toEqual({});
  });

  it('should drop unparseable numeric values but still send the object', () => {
    const flat: Partial<FlattenedPresetData> = {
      temperature: 'not-a-number',
    };

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toEqual({});
  });

  it('should handle mixed valid and invalid values', () => {
    const flat: Partial<FlattenedPresetData> = {
      name: 'Valid Name',
      temperature: '0.7',
      top_p: 'invalid',
      max_tokens: '4096',
    };

    const result = unflattenPresetData(flat);

    expect(result.name).toBe('Valid Name');
    expect(result.advancedParameters).toEqual({
      temperature: 0.7,
      max_tokens: 4096,
    });
  });

  it('should unflatten contextWindowTokens', () => {
    const flat: Partial<FlattenedPresetData> = {
      contextWindowTokens: '131072',
    };

    const result = unflattenPresetData(flat);

    expect(result.contextWindowTokens).toBe(131072);
  });

  it('should not include contextWindowTokens when undefined', () => {
    const flat: Partial<FlattenedPresetData> = {
      name: 'Test',
    };

    const result = unflattenPresetData(flat);

    expect(result.contextWindowTokens).toBeUndefined();
  });
});

describe('unflattenPresetData — blanked params clear (wholesale replace)', () => {
  const basePreset: PresetData = {
    id: 'preset-123',
    name: 'My Preset',
    description: null,
    model: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    isGlobal: false,
    isOwned: true,
    permissions: { canEdit: true, canDelete: true },
    contextWindowTokens: 8192,
    params: {},
  };

  it('blanking the only advanced param sends advancedParameters: {}', () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it('blanking one of several numeric params keeps only the survivors', () => {
    const flat: Partial<FlattenedPresetData> = {
      temperature: '0.7',
      top_p: '',
      top_k: '40',
    };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({ temperature: 0.7, top_k: 40 });
  });

  it('an identity edit round-trips the stored params unchanged (no-op under replace)', () => {
    const preset: PresetData = { ...basePreset, params: { temperature: 0.7, thinking: 'high' } };

    const result = unflattenPresetData(flattenPresetData(preset));

    expect(result.advancedParameters).toEqual({ temperature: 0.7, thinking: 'high' });
  });

  it('a no-params identity edit still sends advancedParameters: {} (no observable change)', () => {
    const result = unflattenPresetData(flattenPresetData(basePreset));

    expect(result.advancedParameters).toEqual({});
  });

  it('blanking a set thinking level clears it while numeric survivors ride along', () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '0.7', thinking: '' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({ temperature: 0.7 });
  });

  it('the create seed path omits advancedParameters entirely', () => {
    const flat: Partial<FlattenedPresetData> = { name: 'Seed Preset', model: 'gpt-4' };

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toBeUndefined();
    expect(Object.hasOwn(result, 'advancedParameters')).toBe(false);
  });

  it('form-owned keys and non-form passthrough keys are disjoint (schema-derived)', () => {
    // The merge spreads nonFormParams BEFORE the parsed form values, so a
    // collision would silently shadow a parsed value; the type system cannot
    // see the key sets, so pin the disjointness here — derived from the
    // schema itself, so the test fails when AdvancedParamsSchema changes
    // rather than mirroring a hand-written list.
    // One sample value per schema key; the Record<keyof AdvancedParams, _>
    // annotation makes a schema change a compile error on this literal.
    const SAMPLE_VALUES: Record<keyof AdvancedParams, unknown> = {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      repetition_penalty: 1.1,
      min_p: 0.1,
      top_a: 0.2,
      seed: 42,
      thinking: 'high',
      max_tokens: 4096,
      logit_bias: { token1: -5 },
      response_format: { type: 'json_object' },
      transforms: ['middle-out'],
      route: 'fallback',
      verbosity: 'high',
    };

    const schemaKeys = Object.keys(AdvancedParamsSchema.shape);
    const formOwnedKeys = new Set<string>([...NUMERIC_PARAMS, 'thinking']);

    // Every schema key carries a sample value, so the flattened fixture is
    // fully populated and no key silently vanishes.
    expect(schemaKeys.filter(key => !(key in SAMPLE_VALUES))).toEqual([]);

    const fullParams = Object.fromEntries(
      schemaKeys.map(key => [key, SAMPLE_VALUES[key as keyof AdvancedParams]])
    ) as AdvancedParams;
    const preset: PresetData = { ...basePreset, params: fullParams };
    const flat = flattenPresetData(preset);

    // (i) no form-owned key leaks into nonFormParams
    expect(Object.keys(flat.nonFormParams ?? {}).filter(key => formOwnedKeys.has(key))).toEqual([]);
    // (ii) nonFormParams' key set equals exactly the schema's non-form members
    expect(Object.keys(flat.nonFormParams ?? {}).sort()).toEqual(
      schemaKeys.filter(key => !formOwnedKeys.has(key)).sort()
    );

    expect(INTEGER_PARAMS.every(key => formOwnedKeys.has(key))).toBe(true);
  });
});

describe('unflattenPresetData — non-form param passthrough', () => {
  const verbosityPreset: PresetData = {
    id: 'preset-123',
    name: 'My Preset',
    description: null,
    model: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    isGlobal: false,
    isOwned: true,
    permissions: { canEdit: true, canDelete: true },
    contextWindowTokens: 8192,
    params: { temperature: 0.7, verbosity: 'high' },
  };

  it('an identity edit of a preset whose params include verbosity preserves it', () => {
    const result = unflattenPresetData(flattenPresetData(verbosityPreset));

    expect(result.advancedParameters).toEqual({ temperature: 0.7, verbosity: 'high' });
  });

  it('a stored non-form key survives a param blanking edit', () => {
    const flat = flattenPresetData(verbosityPreset);
    flat.temperature = '';

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toEqual({ verbosity: 'high' });
  });

  it('the clone path carries the source passthrough (unflatten over session data)', () => {
    // dashboardButtons clone flow calls unflattenPresetData(sourceData) with
    // the session's flattened data — the same seam this pins.
    const flat = flattenPresetData(verbosityPreset);
    flat.top_k = '40';

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toEqual({ verbosity: 'high', top_k: 40, temperature: 0.7 });
  });
});

describe('unflattenPresetData — strict numeric parsing', () => {
  it("' 0.7' parses as 0.7 (trim before parse)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: ' 0.7' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({ temperature: 0.7 });
  });

  it('a whitespace-only numeric value is treated as blank (clears)', () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '   ' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'0.7abc' is dropped but the object still sends (wholesale replace clears)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '0.7abc' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'1,5' is dropped (thousands separator / comma decimal)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '1,5' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'1e999' is dropped (exponent form rejected, no Infinity)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '1e999' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'40.5' on an integer param is dropped", () => {
    const flat: Partial<FlattenedPresetData> = { top_k: '40.5' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'40' on an integer param parses (top_k)", () => {
    const flat: Partial<FlattenedPresetData> = { top_k: '40' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({ top_k: 40 });
  });

  it("'.9' parses as 0.9 (leading-point shorthand)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '.9' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({ temperature: 0.9 });
  });

  it("'.9' passes validation on temperature", () => {
    const result = presetConfigValidator.validate({ temperature: '.9' } as FlattenedPresetData);

    expect(canProceed(result)).toBe(true);
  });

  it("'5.' parses as 5 on an integer param (top_k)", () => {
    const flat: Partial<FlattenedPresetData> = { top_k: '5.' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({ top_k: 5 });
  });

  it("'5.' passes validation on an integer param (top_k)", () => {
    const result = presetConfigValidator.validate({ top_k: '5.' } as FlattenedPresetData);

    expect(canProceed(result)).toBe(true);
  });

  it("'5.5.5' is dropped (second point is garbage)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '5.5.5' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'5.5.5' blocks validation", () => {
    const result = presetConfigValidator.validate({ temperature: '5.5.5' } as FlattenedPresetData);

    expect(canProceed(result)).toBe(false);
  });

  it("'.e5' is dropped (no digits around the point)", () => {
    const flat: Partial<FlattenedPresetData> = { temperature: '.e5' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });

  it("'.e5' blocks validation", () => {
    const result = presetConfigValidator.validate({ temperature: '.e5' } as FlattenedPresetData);

    expect(canProceed(result)).toBe(false);
  });
});

describe('unflattenPresetData — thinking level parsing', () => {
  it("' high' parses as high (trim before match)", () => {
    const flat: Partial<FlattenedPresetData> = { thinking: ' high' };

    const advParams = unflattenPresetData(flat).advancedParameters as Record<string, unknown>;
    expect(advParams.thinking).toBe('high');
  });

  it('a whitespace-only thinking value is treated as blank (clears)', () => {
    const flat: Partial<FlattenedPresetData> = { thinking: '  ' };

    expect(unflattenPresetData(flat).advancedParameters).toEqual({});
  });
});

describe('PRESET_DASHBOARD_CONFIG', () => {
  it('should have correct entity type', () => {
    expect(PRESET_DASHBOARD_CONFIG.entityType).toBe('preset');
  });

  it('should have 5 sections', () => {
    expect(PRESET_DASHBOARD_CONFIG.sections).toHaveLength(5);
  });

  it('should have correct section IDs', () => {
    const sectionIds = PRESET_DASHBOARD_CONFIG.sections.map(s => s.id);
    expect(sectionIds).toEqual(['identity', 'sampling', 'advanced', 'contextWindow', 'reasoning']);
  });

  describe('getTitle', () => {
    it('should return formatted title with preset name', () => {
      const data = { name: 'My Preset' } as FlattenedPresetData;
      expect(PRESET_DASHBOARD_CONFIG.getTitle(data)).toBe('⚙️ Preset: My Preset');
    });
  });

  describe('getDescription', () => {
    it('should show global badge for global presets', () => {
      const data = { isGlobal: true, isOwned: false } as FlattenedPresetData;
      expect(PRESET_DASHBOARD_CONFIG.getDescription!(data)).toBe('🌐 Global');
    });

    it('should show owned badge for owned presets', () => {
      const data = { isGlobal: false, isOwned: true } as FlattenedPresetData;
      expect(PRESET_DASHBOARD_CONFIG.getDescription!(data)).toBe('👤 Owned');
    });

    it('should show both badges when applicable', () => {
      const data = { isGlobal: true, isOwned: true } as FlattenedPresetData;
      expect(PRESET_DASHBOARD_CONFIG.getDescription!(data)).toBe('🌐 Global • 👤 Owned');
    });

    it('should show private badge when not owned and not global (admin viewing)', () => {
      const data = { isGlobal: false, isOwned: false } as FlattenedPresetData;
      expect(PRESET_DASHBOARD_CONFIG.getDescription!(data)).toBe('🔒 Private (another user)');
    });
  });

  describe('Identity section (merged basic + model)', () => {
    const identitySection = PRESET_DASHBOARD_CONFIG.sections[0];

    it('should have correct fields', () => {
      expect(identitySection.fields).toHaveLength(4);
      const keys = identitySection.fields.map(f => f.id);
      expect(keys).toEqual(['name', 'description', 'provider', 'model']);
    });

    it('should return EMPTY status when no name or model', () => {
      const data = { name: '', model: '' } as FlattenedPresetData;
      expect(identitySection.getStatus(data)).toBe(SectionStatus.EMPTY);
    });

    it('should return COMPLETE status when name, model, and description set', () => {
      const data = {
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        description: 'A description',
      } as FlattenedPresetData;
      expect(identitySection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should return DEFAULT status when name and model set but no description', () => {
      const data = {
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        provider: 'openrouter',
        description: '',
      } as FlattenedPresetData;
      expect(identitySection.getStatus(data)).toBe(SectionStatus.DEFAULT);
    });
  });

  describe('Core Sampling section', () => {
    const samplingSection = PRESET_DASHBOARD_CONFIG.sections[1];

    it('should have correct fields', () => {
      expect(samplingSection.fields).toHaveLength(5);
      const keys = samplingSection.fields.map(f => f.id);
      expect(keys).toEqual(['temperature', 'top_p', 'top_k', 'max_tokens', 'seed']);
    });

    it('should return DEFAULT status when no params set', () => {
      const data = {} as FlattenedPresetData;
      expect(samplingSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
    });

    it('should return COMPLETE status when any param is set', () => {
      const data = { temperature: '0.7' } as FlattenedPresetData;
      expect(samplingSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should show preview with set params', () => {
      const data = { temperature: '0.7', top_p: '0.9' } as FlattenedPresetData;
      expect(samplingSection.getPreview(data)).toBe('temp=0.7, top_p=0.9');
    });

    it('should show default message when no params', () => {
      const data = {} as FlattenedPresetData;
      expect(samplingSection.getPreview(data)).toBe('_Using defaults_');
    });
  });

  describe('Advanced section (renamed from penalties)', () => {
    const advancedSection = PRESET_DASHBOARD_CONFIG.sections[2];

    it('should have correct fields', () => {
      expect(advancedSection.fields).toHaveLength(5);
      const keys = advancedSection.fields.map(f => f.id);
      expect(keys).toEqual([
        'frequency_penalty',
        'presence_penalty',
        'repetition_penalty',
        'min_p',
        'top_a',
      ]);
    });

    it('should return DEFAULT status when no params set', () => {
      const data = {} as FlattenedPresetData;
      expect(advancedSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
    });

    it('should return COMPLETE status when any param is set', () => {
      const data = { frequency_penalty: '0.5' } as FlattenedPresetData;
      expect(advancedSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });
  });

  describe('Reasoning section', () => {
    const reasoningSection = PRESET_DASHBOARD_CONFIG.sections[4];

    it('should have correct fields', () => {
      expect(reasoningSection.fields).toHaveLength(1);
      const keys = reasoningSection.fields.map(f => f.id);
      expect(keys).toEqual(['thinking']);
    });

    it('should return DEFAULT status when no params set', () => {
      const data = {} as FlattenedPresetData;
      expect(reasoningSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
    });

    it('should return COMPLETE status when any param is set', () => {
      const data = { thinking: 'high' } as FlattenedPresetData;
      expect(reasoningSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should show preview with the thinking level', () => {
      const data = { thinking: 'high' } as FlattenedPresetData;
      expect(reasoningSection.getPreview(data)).toBe('thinking=high');
    });
  });
});
