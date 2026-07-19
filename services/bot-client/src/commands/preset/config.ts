/**
 * Preset Dashboard Configuration
 *
 * Defines the structure and behavior of the preset editing dashboard.
 * Uses the Dashboard Framework pattern for consistent UX.
 */

import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type LlmConfigUpdateInput } from '@tzurot/common-types/schemas/api/llm-config';
import { type AdvancedParams } from '@tzurot/common-types/schemas/llmAdvancedParams';
import type { DashboardConfig, FieldDefinition } from '../../utils/dashboard/types.js';
import type { ActionButtonOptions } from '../../utils/dashboard/index.js';
import type { PresetData, FlattenedPresetData } from './types.js';

type ReasoningConfig = NonNullable<AdvancedParams['reasoning']>;

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
    isGlobal: data.isGlobal,
    isOwned: data.isOwned,
    canEdit: data.permissions.canEdit,
    canDelete: data.permissions.canDelete,
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
    // Context window (model-coupled, stays in LlmConfig)
    contextWindowTokens: String(data.contextWindowTokens),
    // Model context info (display-only, not editable)
    modelContextLength: data.modelContextLength,
    contextWindowCap: data.contextWindowCap,
    requiresZaiKey: data.requiresZaiKey,
  };
}

/** Form fields where empty string means "preserve existing value" (omit from payload) */
const OMIT_WHEN_EMPTY_FIELDS = ['name', 'provider', 'model'] as const;

/** Form fields where empty string means "clear the value" (send null) */
const NULL_WHEN_EMPTY_FIELDS = ['description'] as const;

/** Numeric sampling/output params; FlattenedPresetData holds them as form strings */
const NUMERIC_PARAMS = [
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

type NumericParamKey = (typeof NUMERIC_PARAMS)[number];

/** Parse numeric params from flat data */
function parseNumericParams(flat: Partial<FlattenedPresetData>): {
  values: Partial<Record<NumericParamKey, number>>;
  hasAny: boolean;
} {
  const values: Partial<Record<NumericParamKey, number>> = {};
  let hasAny = false;
  for (const param of NUMERIC_PARAMS) {
    const value = flat[param];
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

const VALID_EFFORTS: readonly NonNullable<ReasoningConfig['effort']>[] = [
  'xhigh',
  'high',
  'medium',
  'low',
  'minimal',
  'none',
];

/** Parse reasoning params from flat data */
function parseReasoningParams(flat: Partial<FlattenedPresetData>): ReasoningConfig | null {
  const reasoning: ReasoningConfig = {};

  if (flat.reasoning_effort !== undefined && flat.reasoning_effort.length > 0) {
    const effortInput = flat.reasoning_effort.toLowerCase();
    const effort = VALID_EFFORTS.find(e => e === effortInput);
    if (effort !== undefined) {
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

/** Parse optional integer field, returning undefined if invalid */
function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

/** Build advancedParameters object from flattened data */
function buildAdvancedParameters(flat: Partial<FlattenedPresetData>): AdvancedParams | null {
  const { values: samplingParams, hasAny: hasSampling } = parseNumericParams(flat);
  const reasoning = parseReasoningParams(flat);

  const advancedParameters: AdvancedParams = { ...samplingParams };
  if (reasoning !== null) {
    advancedParameters.reasoning = reasoning;
  }
  if (flat.show_thinking !== undefined && flat.show_thinking.length > 0) {
    advancedParameters.show_thinking = flat.show_thinking.toLowerCase() === 'true';
  }

  const hasAdvanced =
    hasSampling || reasoning !== null || advancedParameters.show_thinking !== undefined;
  return hasAdvanced ? advancedParameters : null;
}

/** Convert flattened form data back to API update payload */
export function unflattenPresetData(flat: Partial<FlattenedPresetData>): LlmConfigUpdateInput {
  const result: LlmConfigUpdateInput = {};

  // Basic fields — empty string preserves the existing value (field omitted)
  for (const key of OMIT_WHEN_EMPTY_FIELDS) {
    const value = flat[key];
    if (value !== undefined && value.length > 0) {
      result[key] = value;
    }
  }

  // Nullable fields — empty string clears the value (send null)
  for (const key of NULL_WHEN_EMPTY_FIELDS) {
    const value = flat[key];
    if (value !== undefined) {
      result[key] = value.length > 0 ? value : null;
    }
  }

  // Context window (model-coupled, stays in LlmConfig)
  const contextWindowTokens = parseOptionalInt(flat.contextWindowTokens);
  if (contextWindowTokens !== undefined) {
    result.contextWindowTokens = contextWindowTokens;
  }

  // Build advancedParameters
  const advancedParameters = buildAdvancedParameters(flat);
  if (advancedParameters !== null) {
    result.advancedParameters = advancedParameters;
  }

  return result;
}

// Import section definitions from separate file to keep under 500 lines
import {
  identitySection,
  coreSamplingSection,
  advancedSection,
  contextWindowSection,
  reasoningSection,
} from './presetSections.js';

// Re-export for tests
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
    } else if (!data.isGlobal) {
      badges.push('🔒 Private (another user)');
    }
    return badges.join(' • ');
  },
  sections: [
    identitySection,
    coreSamplingSection,
    advancedSection,
    contextWindowSection,
    reasoningSection,
  ],
  actions: [], // Refresh button already exists - no need for dropdown entry
  getFooter: () => 'Select a section to edit • Changes save automatically',
  color: DISCORD_COLORS.BLURPLE,
};

/**
 * Build dashboard button options including toggle-global and delete for owned presets.
 * Shows back button when opened from browse; no Close (D18 — native dismiss).
 */
export function buildPresetDashboardOptions(data: FlattenedPresetData): ActionButtonOptions {
  const hasBrowseContext = data.browseContext !== undefined;
  return {
    showBack: hasBrowseContext,
    showRefresh: true,
    showClone: true,
    // Use server-computed canDelete so bot-owner/admin can delete any preset,
    // not just their own. canDelete is symmetric with canEdit — both true for
    // creator OR isBotOwner (see computeLlmConfigPermissions).
    showDelete: data.canDelete,
    toggleGlobal: {
      isGlobal: data.isGlobal,
      isOwned: data.isOwned,
    },
  };
}

/**
 * Seed modal field definitions for creating a new preset
 * Minimal fields required to create a preset - user can configure more via dashboard
 */
export const presetSeedFields: FieldDefinition[] = [
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
