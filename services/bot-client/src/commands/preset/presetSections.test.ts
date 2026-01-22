/**
 * Tests for Preset Dashboard Section Definitions
 */

import { describe, it, expect } from 'vitest';
import {
  identitySection,
  coreSamplingSection,
  advancedSection,
  reasoningSection,
} from './presetSections.js';
import { SectionStatus } from '../../utils/dashboard/types.js';
import type { FlattenedPresetData } from './types.js';

describe('identitySection', () => {
  it('should have correct id and label', () => {
    expect(identitySection.id).toBe('identity');
    expect(identitySection.label).toBe('📝 Identity');
  });

  it('should have correct fields (merged basic + model = 5)', () => {
    expect(identitySection.fields).toHaveLength(5);
    const keys = identitySection.fields.map(f => f.id);
    expect(keys).toEqual(['name', 'description', 'provider', 'model', 'visionModel']);
  });

  it('should return EMPTY status when no name or model', () => {
    const data = { name: '', model: '' } as FlattenedPresetData;
    expect(identitySection.getStatus(data)).toBe(SectionStatus.EMPTY);
  });

  it('should return EMPTY status when name set but no model', () => {
    const data = { name: 'Test', model: '' } as FlattenedPresetData;
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

  it('should show name and model in preview', () => {
    const data = {
      name: 'My Preset',
      model: 'anthropic/claude-sonnet-4',
      description: '',
    } as FlattenedPresetData;
    const preview = identitySection.getPreview(data);
    expect(preview).toContain('**Name:** My Preset');
    expect(preview).toContain('**Model:** `anthropic/claude-sonnet-4`');
  });

  it('should show all fields in preview when set', () => {
    const data = {
      name: 'My Preset',
      model: 'anthropic/claude-sonnet-4',
      visionModel: 'gpt-4-vision',
      description: '',
    } as FlattenedPresetData;
    const preview = identitySection.getPreview(data);
    expect(preview).toContain('**Name:** My Preset');
    expect(preview).toContain('**Model:** `anthropic/claude-sonnet-4`');
    expect(preview).toContain('**Vision:** `gpt-4-vision`');
  });

  it('should show not configured when empty', () => {
    const data = { name: '', model: '', description: '' } as FlattenedPresetData;
    expect(identitySection.getPreview(data)).toBe('_Not configured_');
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

describe('advancedSection', () => {
  it('should have correct id and label', () => {
    expect(advancedSection.id).toBe('advanced');
    expect(advancedSection.label).toBe('🔧 Advanced');
  });

  it('should have correct fields (penalties + advanced sampling)', () => {
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

  it('should show preview with set params', () => {
    const data = { frequency_penalty: '0.5', presence_penalty: '0.3' } as FlattenedPresetData;
    expect(advancedSection.getPreview(data)).toBe('freq=0.5, pres=0.3');
  });

  it('should show all params in preview', () => {
    const data = {
      frequency_penalty: '0.5',
      presence_penalty: '0.3',
      repetition_penalty: '1.1',
      min_p: '0.05',
      top_a: '0.1',
    } as FlattenedPresetData;
    expect(advancedSection.getPreview(data)).toBe(
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
