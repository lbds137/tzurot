/**
 * Tests for Preset Dashboard Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  flattenPresetData,
  unflattenPresetData,
  PRESET_DASHBOARD_CONFIG,
  type PresetData,
  type FlattenedPresetData,
} from './config.js';
import { SectionStatus } from '../../utils/dashboard/types.js';

describe('flattenPresetData', () => {
  it('should flatten basic preset data', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: 'A test preset',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      visionModel: 'anthropic/claude-sonnet-4',
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      maxReferencedMessages: 10,
      contextWindowTokens: 8192,
      memoryScoreThreshold: null,
      memoryLimit: null,
      params: {},
    };

    const result = flattenPresetData(preset);

    expect(result.id).toBe('preset-123');
    expect(result.name).toBe('My Preset');
    expect(result.description).toBe('A test preset');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('anthropic/claude-sonnet-4');
    expect(result.visionModel).toBe('anthropic/claude-sonnet-4');
    expect(result.isGlobal).toBe(false);
    expect(result.isOwned).toBe(true);
    expect(result.maxReferencedMessages).toBe('10');
  });

  it('should handle null description and visionModel', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      visionModel: null,
      isGlobal: true,
      isOwned: false,
      permissions: { canEdit: false, canDelete: false },
      maxReferencedMessages: 5,
      contextWindowTokens: 8192,
      memoryScoreThreshold: null,
      memoryLimit: null,
      params: {},
    };

    const result = flattenPresetData(preset);

    expect(result.description).toBe('');
    expect(result.visionModel).toBe('');
  });

  it('should flatten sampling params', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      visionModel: null,
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      maxReferencedMessages: 10,
      contextWindowTokens: 8192,
      memoryScoreThreshold: null,
      memoryLimit: null,
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
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      visionModel: null,
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      maxReferencedMessages: 10,
      contextWindowTokens: 8192,
      memoryScoreThreshold: null,
      memoryLimit: null,
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

  it('should flatten reasoning params', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      visionModel: null,
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      maxReferencedMessages: 10,
      contextWindowTokens: 8192,
      memoryScoreThreshold: null,
      memoryLimit: null,
      params: {
        reasoning: {
          effort: 'high',
          max_tokens: 8000,
          exclude: false,
          enabled: true,
        },
      },
    };

    const result = flattenPresetData(preset);

    expect(result.reasoning_effort).toBe('high');
    expect(result.reasoning_max_tokens).toBe('8000');
    expect(result.reasoning_exclude).toBe('false');
    expect(result.reasoning_enabled).toBe('true');
  });

  it('should handle missing params as empty strings', () => {
    const preset: PresetData = {
      id: 'preset-123',
      name: 'My Preset',
      description: null,
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      visionModel: null,
      isGlobal: false,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
      maxReferencedMessages: 10,
      contextWindowTokens: 8192,
      memoryScoreThreshold: null,
      memoryLimit: null,
      params: {},
    };

    const result = flattenPresetData(preset);

    expect(result.temperature).toBe('');
    expect(result.top_p).toBe('');
    expect(result.frequency_penalty).toBe('');
    expect(result.reasoning_effort).toBe('');
    expect(result.reasoning_enabled).toBe('');
  });
});

describe('unflattenPresetData', () => {
  it('should unflatten basic fields', () => {
    const flat: Partial<FlattenedPresetData> = {
      name: 'Updated Name',
      description: 'Updated description',
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4',
      visionModel: 'anthropic/claude-sonnet-4',
      maxReferencedMessages: '15',
    };

    const result = unflattenPresetData(flat);

    expect(result.name).toBe('Updated Name');
    expect(result.description).toBe('Updated description');
    expect(result.provider).toBe('openrouter');
    expect(result.model).toBe('anthropic/claude-opus-4');
    expect(result.visionModel).toBe('anthropic/claude-sonnet-4');
    expect(result.maxReferencedMessages).toBe(15);
  });

  it('should set description to null when empty', () => {
    const flat: Partial<FlattenedPresetData> = {
      description: '',
    };

    const result = unflattenPresetData(flat);

    expect(result.description).toBeNull();
  });

  it('should set visionModel to null when empty', () => {
    const flat: Partial<FlattenedPresetData> = {
      visionModel: '',
    };

    const result = unflattenPresetData(flat);

    expect(result.visionModel).toBeNull();
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

  it('should unflatten reasoning params', () => {
    const flat: Partial<FlattenedPresetData> = {
      reasoning_effort: 'medium',
      reasoning_max_tokens: '10000',
      reasoning_exclude: 'true',
      reasoning_enabled: 'true',
    };

    const result = unflattenPresetData(flat);

    const advParams = result.advancedParameters as Record<string, unknown>;
    expect(advParams.reasoning).toEqual({
      effort: 'medium',
      max_tokens: 10000,
      exclude: true,
      enabled: true,
    });
  });

  it('should handle invalid reasoning effort values', () => {
    const flat: Partial<FlattenedPresetData> = {
      reasoning_effort: 'invalid',
    };

    const result = unflattenPresetData(flat);

    // Invalid effort should not be included
    expect(result.advancedParameters).toBeUndefined();
  });

  it('should ignore empty string values', () => {
    const flat: Partial<FlattenedPresetData> = {
      name: '',
      temperature: '',
      top_p: '',
    };

    const result = unflattenPresetData(flat);

    expect(result.name).toBeUndefined();
    expect(result.advancedParameters).toBeUndefined();
  });

  it('should ignore invalid numeric values', () => {
    const flat: Partial<FlattenedPresetData> = {
      temperature: 'not-a-number',
      maxReferencedMessages: 'invalid',
    };

    const result = unflattenPresetData(flat);

    expect(result.advancedParameters).toBeUndefined();
    expect(result.maxReferencedMessages).toBeUndefined();
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
    expect(sectionIds).toEqual(['identity', 'sampling', 'advanced', 'context', 'reasoning']);
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

    it('should return empty string when neither badge applies', () => {
      const data = { isGlobal: false, isOwned: false } as FlattenedPresetData;
      expect(PRESET_DASHBOARD_CONFIG.getDescription!(data)).toBe('');
    });
  });

  describe('Identity section (merged basic + model)', () => {
    const identitySection = PRESET_DASHBOARD_CONFIG.sections[0];

    it('should have correct fields', () => {
      expect(identitySection.fields).toHaveLength(5);
      const keys = identitySection.fields.map(f => f.id);
      expect(keys).toEqual(['name', 'description', 'provider', 'model', 'visionModel']);
    });

    it('should return EMPTY status when no name or model', () => {
      const data = { name: '', model: '' } as FlattenedPresetData;
      expect(identitySection.getStatus(data)).toBe(SectionStatus.EMPTY);
    });

    it('should return COMPLETE status when name, model, and description set', () => {
      const data = {
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
        description: 'A description',
      } as FlattenedPresetData;
      expect(identitySection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should return DEFAULT status when name and model set but no description', () => {
      const data = {
        name: 'Test',
        model: 'anthropic/claude-sonnet-4',
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
      expect(reasoningSection.fields).toHaveLength(5);
      const keys = reasoningSection.fields.map(f => f.id);
      expect(keys).toEqual([
        'reasoning_effort',
        'reasoning_max_tokens',
        'reasoning_exclude',
        'reasoning_enabled',
        'show_thinking',
      ]);
    });

    it('should return DEFAULT status when no params set', () => {
      const data = {} as FlattenedPresetData;
      expect(reasoningSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
    });

    it('should return COMPLETE status when any param is set', () => {
      const data = { reasoning_enabled: 'true' } as FlattenedPresetData;
      expect(reasoningSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should show preview with enabled status', () => {
      const data = { reasoning_enabled: 'true', reasoning_effort: 'high' } as FlattenedPresetData;
      expect(reasoningSection.getPreview(data)).toBe('enabled=true, effort=high');
    });
  });
});
