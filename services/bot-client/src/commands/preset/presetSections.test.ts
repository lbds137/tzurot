/**
 * Tests for Preset Dashboard Section Definitions
 */

import { describe, it, expect } from 'vitest';
import {
  basicInfoSection,
  modelSection,
  coreSamplingSection,
  penaltiesSection,
  reasoningSection,
} from './presetSections.js';
import { SectionStatus } from '../../utils/dashboard/types.js';
import type { FlattenedPresetData } from './types.js';

describe('basicInfoSection', () => {
  it('should have correct id and label', () => {
    expect(basicInfoSection.id).toBe('basic');
    expect(basicInfoSection.label).toBe('📝 Basic Info');
  });

  it('should have correct fields', () => {
    expect(basicInfoSection.fields).toHaveLength(2);
    expect(basicInfoSection.fields[0].id).toBe('name');
    expect(basicInfoSection.fields[1].id).toBe('description');
  });

  it('should return EMPTY status when no name', () => {
    const data = { name: '' } as FlattenedPresetData;
    expect(basicInfoSection.getStatus(data)).toBe(SectionStatus.EMPTY);
  });

  it('should return COMPLETE status when description is set', () => {
    const data = { name: 'Test', description: 'A description' } as FlattenedPresetData;
    expect(basicInfoSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
  });

  it('should return DEFAULT status when name set but no description', () => {
    const data = { name: 'Test', description: '' } as FlattenedPresetData;
    expect(basicInfoSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
  });

  it('should show name in preview', () => {
    const data = { name: 'My Preset', description: '' } as FlattenedPresetData;
    expect(basicInfoSection.getPreview(data)).toBe('**Name:** My Preset');
  });

  it('should show name and description in preview', () => {
    const data = {
      name: 'My Preset',
      description: 'A long description that should be truncated in preview',
    } as FlattenedPresetData;
    expect(basicInfoSection.getPreview(data)).toContain('**Name:** My Preset');
    expect(basicInfoSection.getPreview(data)).toContain('**Description:**');
  });

  it('should show not configured when empty', () => {
    const data = { name: '', description: '' } as FlattenedPresetData;
    expect(basicInfoSection.getPreview(data)).toBe('_Not configured_');
  });
});

describe('modelSection', () => {
  it('should have correct id and label', () => {
    expect(modelSection.id).toBe('model');
    expect(modelSection.label).toBe('🤖 Model');
  });

  it('should have correct fields', () => {
    expect(modelSection.fields).toHaveLength(3);
    expect(modelSection.fields[0].id).toBe('provider');
    expect(modelSection.fields[1].id).toBe('model');
    expect(modelSection.fields[2].id).toBe('visionModel');
  });

  it('should return EMPTY status when no model', () => {
    const data = { model: '' } as FlattenedPresetData;
    expect(modelSection.getStatus(data)).toBe(SectionStatus.EMPTY);
  });

  it('should return COMPLETE status when model is set', () => {
    const data = { model: 'anthropic/claude-sonnet-4' } as FlattenedPresetData;
    expect(modelSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
  });

  it('should show model in preview', () => {
    const data = {
      model: 'anthropic/claude-sonnet-4',
      provider: '',
      visionModel: '',
    } as FlattenedPresetData;
    expect(modelSection.getPreview(data)).toBe('**Model:** `anthropic/claude-sonnet-4`');
  });

  it('should show all fields in preview when set', () => {
    const data = {
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      visionModel: 'gpt-4-vision',
    } as FlattenedPresetData;
    const preview = modelSection.getPreview(data);
    expect(preview).toContain('**Provider:** openrouter');
    expect(preview).toContain('**Model:** `anthropic/claude-sonnet-4`');
    expect(preview).toContain('**Vision:** `gpt-4-vision`');
  });
});

describe('coreSamplingSection', () => {
  it('should have correct id and label', () => {
    expect(coreSamplingSection.id).toBe('sampling');
    expect(coreSamplingSection.label).toBe('🎛️ Core Sampling');
  });

  it('should have correct fields', () => {
    expect(coreSamplingSection.fields).toHaveLength(5);
    const keys = coreSamplingSection.fields.map(f => f.id);
    expect(keys).toEqual(['temperature', 'top_p', 'top_k', 'max_tokens', 'seed']);
  });

  it('should return DEFAULT status when no params set', () => {
    const data = {} as FlattenedPresetData;
    expect(coreSamplingSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
  });

  it('should return COMPLETE status when any param is set', () => {
    const data = { temperature: '0.7' } as FlattenedPresetData;
    expect(coreSamplingSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
  });

  it('should show preview with set params', () => {
    const data = { temperature: '0.7', top_p: '0.9' } as FlattenedPresetData;
    expect(coreSamplingSection.getPreview(data)).toBe('temp=0.7, top_p=0.9');
  });

  it('should show default message when no params', () => {
    const data = {} as FlattenedPresetData;
    expect(coreSamplingSection.getPreview(data)).toBe('_Using defaults_');
  });

  it('should show all params in preview', () => {
    const data = {
      temperature: '0.7',
      top_p: '0.9',
      top_k: '40',
      max_tokens: '4096',
      seed: '42',
    } as FlattenedPresetData;
    expect(coreSamplingSection.getPreview(data)).toBe(
      'temp=0.7, top_p=0.9, top_k=40, max=4096, seed=42'
    );
  });
});

describe('penaltiesSection', () => {
  it('should have correct id and label', () => {
    expect(penaltiesSection.id).toBe('penalties');
    expect(penaltiesSection.label).toBe('⚖️ Penalties');
  });

  it('should have correct fields', () => {
    expect(penaltiesSection.fields).toHaveLength(5);
    const keys = penaltiesSection.fields.map(f => f.id);
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
    expect(penaltiesSection.getStatus(data)).toBe(SectionStatus.DEFAULT);
  });

  it('should return COMPLETE status when any param is set', () => {
    const data = { frequency_penalty: '0.5' } as FlattenedPresetData;
    expect(penaltiesSection.getStatus(data)).toBe(SectionStatus.COMPLETE);
  });

  it('should show preview with set params', () => {
    const data = { frequency_penalty: '0.5', presence_penalty: '0.3' } as FlattenedPresetData;
    expect(penaltiesSection.getPreview(data)).toBe('freq=0.5, pres=0.3');
  });

  it('should show all penalty params in preview', () => {
    const data = {
      frequency_penalty: '0.5',
      presence_penalty: '0.3',
      repetition_penalty: '1.1',
      min_p: '0.05',
      top_a: '0.1',
    } as FlattenedPresetData;
    expect(penaltiesSection.getPreview(data)).toBe(
      'freq=0.5, pres=0.3, rep=1.1, min_p=0.05, top_a=0.1'
    );
  });
});

describe('reasoningSection', () => {
  it('should have correct id and label', () => {
    expect(reasoningSection.id).toBe('reasoning');
    expect(reasoningSection.label).toBe('🧠 Reasoning');
  });

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

  it('should show show_thinking indicator when enabled', () => {
    const data = { show_thinking: 'true' } as FlattenedPresetData;
    expect(reasoningSection.getPreview(data)).toBe('💭 show thinking');
  });

  it('should show all reasoning params in preview', () => {
    const data = {
      reasoning_enabled: 'true',
      reasoning_effort: 'high',
      reasoning_max_tokens: '10000',
      reasoning_exclude: 'false',
      show_thinking: 'true',
    } as FlattenedPresetData;
    const preview = reasoningSection.getPreview(data);
    expect(preview).toContain('enabled=true');
    expect(preview).toContain('effort=high');
    expect(preview).toContain('max=10000');
    expect(preview).toContain('exclude=false');
    expect(preview).toContain('💭 show thinking');
  });

  it('should handle enabled=false in preview', () => {
    const data = { reasoning_enabled: 'false' } as FlattenedPresetData;
    expect(reasoningSection.getPreview(data)).toBe('enabled=false');
  });
});
