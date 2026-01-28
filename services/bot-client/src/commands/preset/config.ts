/**
 * Preset Dashboard Configuration
 *
 * Defines the structure and behavior of the preset editing dashboard.
 * Uses the Dashboard Framework pattern for consistent UX.
 */

import type { DashboardConfig } from '../../utils/dashboard/types.js';
import type { PresetData, FlattenedPresetData } from './types.js';

// Re-export types for backward compatibility
export type { PresetData, FlattenedPresetData } from './types.js';

/**
 * Convert API response to flattened form data
 */
// eslint-disable-next-line complexity -- Inherent complexity from mapping ~20 optional fields from nested API response to flat form data. No conditional logic, just null coalescing and type conversion.
export function flattenPresetData(data: PresetData): FlattenedPresetData {
  return {
    id: data.id,
    name: data.name,
    description: data.description ?? '',
    provider: data.provider,
    model: data.model,
    visionModel: data.visionModel ?? '',
    isGlobal: data.isGlobal,
    isOwned: data.isOwned,
    canEdit: data.permissions.canEdit,
    maxReferencedMessages: String(data.maxReferencedMessages),
    // Sampling params
    temperature: data.params.temperature?.toString() ?? '',
    top_p: data.params.top_p?.toString() ?? '',
    top_k: data.params.top_k?.toString() ?? '',
    max_tokens: data.params.max_tokens?.toString() ?? '',
    seed: data.params.seed?.toString() ?? '',
    // Penalty params
    frequency_penalty: data.params.frequency_penalty?.toString() ?? '',
    presence_penalty: data.params.presence_penalty?.toString() ?? '',
    repetition_penalty: data.params.repetition_penalty?.toString() ?? '',
    min_p: data.params.min_p?.toString() ?? '',
    top_a: data.params.top_a?.toString() ?? '',
    // Reasoning params
    reasoning_effort: data.params.reasoning?.effort ?? '',
    reasoning_max_tokens: data.params.reasoning?.max_tokens?.toString() ?? '',
    reasoning_exclude: data.params.reasoning?.exclude?.toString() ?? '',
    reasoning_enabled: data.params.reasoning?.enabled?.toString() ?? '',
    // Output params
    show_thinking: data.params.show_thinking?.toString() ?? '',
  };
}

/** Add string field to result if non-empty */
function addStringField(
  result: Record<string, unknown>,
  key: string,
  value: string | undefined,
  nullable = false
): void {
  if (value === undefined) {
    return;
  }
  result[key] = value.length > 0 ? value : nullable ? null : undefined;
  if (result[key] === undefined) {
    delete result[key];
  }
}

/** Parse numeric params from flat data */
function parseNumericParams(
  flat: Partial<FlattenedPresetData>,
  params: readonly string[]
): { values: Record<string, number>; hasAny: boolean } {
  const values: Record<string, number> = {};
  let hasAny = false;
  for (const param of params) {
    const value = flat[param as keyof FlattenedPresetData] as string | undefined;
    if (value !== undefined && value.length > 0) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        values[param] = num;
        hasAny = true;
      }
    }
  }
  return { values, hasAny };
}

/** Parse reasoning params from flat data */
function parseReasoningParams(flat: Partial<FlattenedPresetData>): Record<string, unknown> | null {
  const reasoning: Record<string, unknown> = {};
  const validEfforts = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];

  if (flat.reasoning_effort !== undefined && flat.reasoning_effort.length > 0) {
    const effort = flat.reasoning_effort.toLowerCase();
    if (validEfforts.includes(effort)) {
      reasoning.effort = effort;
    }
  }
  if (flat.reasoning_max_tokens !== undefined && flat.reasoning_max_tokens.length > 0) {
    const num = parseInt(flat.reasoning_max_tokens, 10);
    if (!isNaN(num)) {
      reasoning.max_tokens = num;
    }
  }
  if (flat.reasoning_exclude !== undefined && flat.reasoning_exclude.length > 0) {
    reasoning.exclude = flat.reasoning_exclude.toLowerCase() === 'true';
  }
  if (flat.reasoning_enabled !== undefined && flat.reasoning_enabled.length > 0) {
    reasoning.enabled = flat.reasoning_enabled.toLowerCase() === 'true';
  }
  return Object.keys(reasoning).length > 0 ? reasoning : null;
}

/** Convert flattened form data back to API update payload */
export function unflattenPresetData(flat: Partial<FlattenedPresetData>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Basic fields
  addStringField(result, 'name', flat.name);
  addStringField(result, 'description', flat.description, true);
  addStringField(result, 'provider', flat.provider);
  addStringField(result, 'model', flat.model);
  addStringField(result, 'visionModel', flat.visionModel, true);

  if (flat.maxReferencedMessages !== undefined && flat.maxReferencedMessages.length > 0) {
    const num = parseInt(flat.maxReferencedMessages, 10);
    if (!isNaN(num)) {
      result.maxReferencedMessages = num;
    }
  }

  // Build advancedParameters
  const numericParams = [
    'temperature',
    'top_p',
    'top_k',
    'max_tokens',
    'seed',
    'frequency_penalty',
    'presence_penalty',
    'repetition_penalty',
    'min_p',
    'top_a',
  ] as const;

  const { values: samplingParams, hasAny: hasSampling } = parseNumericParams(flat, numericParams);
  const reasoning = parseReasoningParams(flat);

  const advancedParameters: Record<string, unknown> = { ...samplingParams };
  if (reasoning !== null) {
    advancedParameters.reasoning = reasoning;
  }
  if (flat.show_thinking !== undefined && flat.show_thinking.length > 0) {
    advancedParameters.show_thinking = flat.show_thinking.toLowerCase() === 'true';
  }

  if (hasSampling || reasoning !== null || advancedParameters.show_thinking !== undefined) {
    result.advancedParameters = advancedParameters;
  }

  return result;
}

// Import section definitions from separate file to keep under 500 lines
import {
  identitySection,
  coreSamplingSection,
  advancedSection,
  reasoningSection,
} from './presetSections.js';

// Re-export for tests
export { reasoningSection };

// --- Dashboard Config ---

export const PRESET_DASHBOARD_CONFIG: DashboardConfig<FlattenedPresetData> = {
  entityType: 'preset',
  getTitle: data => `⚙️ Preset: ${data.name}`,
  getDescription: data => {
    const badges: string[] = [];
    if (data.isGlobal) {
      badges.push('🌐 Global');
    }
    if (data.isOwned) {
      badges.push('👤 Owned');
    }
    return badges.length > 0 ? badges.join(' • ') : '';
  },
  sections: [identitySection, coreSamplingSection, advancedSection, reasoningSection],
  actions: [], // Refresh button already exists - no need for dropdown entry
  getFooter: () => 'Select a section to edit • Changes save automatically',
  color: 0x5865f2, // Discord blurple
};

/**
 * Seed modal field definitions for creating a new preset
 * Minimal fields required to create a preset - user can configure more via dashboard
 */
export const presetSeedFields = [
  {
    id: 'name',
    label: 'Preset Name',
    placeholder: 'e.g., Claude Fast, GPT Creative',
    required: true,
    style: 'short' as const,
    maxLength: 100,
  },
  {
    id: 'model',
    label: 'Model ID',
    placeholder: 'e.g., anthropic/claude-sonnet-4',
    required: true,
    style: 'short' as const,
    maxLength: 255,
  },
];
