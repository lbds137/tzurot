/**
 * Preset Dashboard Configuration
 *
 * Defines the structure and behavior of the preset editing dashboard.
 * Uses the Dashboard Framework pattern for consistent UX.
 */

import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { type LlmConfigUpdateInput } from '@tzurot/common-types/schemas/api/llm-config';
import {
  type AdvancedParams,
  type ThinkingLevel,
  THINKING_LEVELS,
} from '@tzurot/common-types/schemas/llmAdvancedParams';
import type { DashboardConfig, FieldDefinition } from '../../utils/dashboard/types.js';
import type { ActionButtonOptions } from '../../utils/dashboard/index.js';
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
    // Thinking param (canonical level)
    thinking: data.params.thinking ?? '',
    // Stored params the form cannot represent ride along untouched
    nonFormParamKeys: extractNonFormParamKeys(data.params),
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
export const NUMERIC_PARAMS = [
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

/** Numeric params the schema pins to whole numbers (z.number().int()); fractional values are blocked by the validator and dropped by the parser */
export const INTEGER_PARAMS: readonly NumericParamKey[] = ['top_k', 'max_tokens', 'seed'];

/** Param keys the dashboard form owns; every other stored param key passes through edits untouched */
const FORM_OWNED_PARAM_KEYS: ReadonlySet<string> = new Set<string>([...NUMERIC_PARAMS, 'thinking']);

/**
 * Strict decimal form value: optional sign, digits with an optional single
 * fractional part. Rejects hex, exponent notation, thousands separators and
 * trailing garbage ('0.7abc' fails here where parseFloat would silently
 * accept it, and the rejected exponent form keeps non-finite results out).
 */
const STRICT_DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Parse a form string as a strict decimal number.
 * Undefined when the value is blank after trimming or is not a plain decimal —
 * the same rule the save validator applies, so validation and persistence agree.
 */
export function parseStrictParamNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !STRICT_DECIMAL_RE.test(trimmed)) {
    return undefined;
  }
  return parseFloat(trimmed);
}

/**
 * True when input names a canonical thinking level (lowercase match against
 * THINKING_LEVELS — the same parity behavior the parser applies). Shared by
 * the parser and the save validator so the accepted set cannot drift.
 */
export function isThinkingLevel(input: string): boolean {
  const lowered = input.toLowerCase();
  return THINKING_LEVELS.some(level => level === lowered);
}

/**
 * Stored params the dashboard form cannot show (e.g. logit_bias, transforms,
 * verbosity): everything in `params` minus the form-owned keys. The rebuilt
 * advancedParameters object carries form fields only, so without this
 * passthrough a dashboard edit would drop these keys via the gateway's
 * wholesale replace. Values arrive schema-shaped: the gateway stores `params`
 * validated against AdvancedParamsSchema.
 */
function extractNonFormParamKeys(params: PresetData['params']): AdvancedParams {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !FORM_OWNED_PARAM_KEYS.has(key))
  );
}

/** Parse numeric params from flat data, dropping blank, unparseable or non-integer-where-required entries */
function parseNumericParams(
  flat: Partial<FlattenedPresetData>
): Partial<Record<NumericParamKey, number>> {
  const values: Partial<Record<NumericParamKey, number>> = {};
  for (const param of NUMERIC_PARAMS) {
    const num = parseStrictParamNumber(flat[param]);
    if (num === undefined) {
      continue;
    }
    if (INTEGER_PARAMS.includes(param) && !Number.isInteger(num)) {
      continue;
    }
    values[param] = num;
  }
  return values;
}

/**
 * Parse the thinking level from flat form data.
 *
 * The save validator blocks unrecognized levels before the payload is built;
 * the `null` return here is defense in depth for callers that reach the
 * payload builder without passing through validation (the level is left
 * unset rather than erroring). `THINKING_LEVELS` is imported so the modal's
 * accepted values and the schema enum cannot drift.
 */
function parseThinkingLevel(flat: Partial<FlattenedPresetData>): ThinkingLevel | null {
  if (flat.thinking === undefined || flat.thinking.trim().length === 0) {
    return null;
  }
  const input = flat.thinking.trim().toLowerCase();
  if (!isThinkingLevel(input)) {
    return null;
  }
  return THINKING_LEVELS.find(level => level === input) ?? null;
}

/** Parse optional integer field, returning undefined if invalid */
function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

/**
 * Build advancedParameters object from flattened data.
 *
 * Gate on PRESENCE, not on parsed values: a dashboard edit submits every
 * numeric/thinking field, so any such key present means the params were part
 * of this edit — the object is sent even when every value is empty or
 * unparseable, so the gateway's wholesale replace clears params the user
 * removed. Stored params the form cannot represent (`nonFormParamKeys`) ride
 * along unchanged, merged before the parsed form values — the key sets are
 * disjoint (pinned by the disjointness test in config.test.ts), so no form
 * value can be shadowed. `null` means no params field was part of the payload
 * at all (the create seed path and other synthetic callers); the gateway
 * leaves stored params untouched then. Pinned by the blank-clears and
 * untouched-no-op tests in config.test.ts.
 */
function buildAdvancedParameters(flat: Partial<FlattenedPresetData>): AdvancedParams | null {
  const anyParamPresent =
    NUMERIC_PARAMS.some(param => flat[param] !== undefined) || flat.thinking !== undefined;
  if (!anyParamPresent) {
    return null;
  }

  const samplingParams = parseNumericParams(flat);
  const thinking = parseThinkingLevel(flat);

  const advancedParameters: AdvancedParams = { ...flat.nonFormParamKeys, ...samplingParams };
  if (thinking !== null) {
    advancedParameters.thinking = thinking;
  }
  return advancedParameters;
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
