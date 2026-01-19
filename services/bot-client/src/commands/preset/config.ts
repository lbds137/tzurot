/**
 * Preset Dashboard Configuration
 *
 * Defines the structure and behavior of the preset editing dashboard.
 * Uses the Dashboard Framework pattern for consistent UX.
 */

import type { EntityPermissions } from '@tzurot/common-types';
import type { DashboardConfig, SectionDefinition } from '../../utils/dashboard/types.js';
import { SectionStatus } from '../../utils/dashboard/types.js';

/**
 * Preset data structure returned by API
 * Includes all LLM configuration params from advancedParameters
 */
export interface PresetData {
  id: string;
  name: string;
  description: string | null;
  provider: string;
  model: string;
  visionModel: string | null;
  isGlobal: boolean;
  isDefault?: boolean;
  isFreeDefault?: boolean;
  isOwned: boolean;
  /** Server-computed permissions for the requesting user */
  permissions: EntityPermissions;
  maxReferencedMessages: number;
  params: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    seed?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    min_p?: number;
    top_a?: number;
    reasoning?: {
      effort?: 'high' | 'medium' | 'low' | 'minimal' | 'none';
      max_tokens?: number;
      exclude?: boolean;
      enabled?: boolean;
    };
  };
}

/**
 * Flattened preset data for modal editing
 * Converts nested params to flat string values for Discord modals
 * Index signature allows usage with generic Record<string, unknown> types
 */
export interface FlattenedPresetData {
  [key: string]: string | boolean;
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  visionModel: string;
  isGlobal: boolean;
  isOwned: boolean;
  maxReferencedMessages: string;
  // Sampling params
  temperature: string;
  top_p: string;
  top_k: string;
  max_tokens: string;
  seed: string;
  // Penalty params
  frequency_penalty: string;
  presence_penalty: string;
  repetition_penalty: string;
  min_p: string;
  top_a: string;
  // Reasoning params
  reasoning_effort: string;
  reasoning_max_tokens: string;
  reasoning_exclude: string;
  reasoning_enabled: string;
}

/**
 * Convert API response to flattened form data
 * Complexity is inherent to mapping many fields - no nested logic, just field extraction
 */
// eslint-disable-next-line complexity
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
  };
}

/**
 * Convert flattened form data back to API update payload
 * Complexity is inherent to parsing many optional fields - straightforward conditionals
 */
// eslint-disable-next-line complexity
export function unflattenPresetData(flat: Partial<FlattenedPresetData>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Basic fields
  if (flat.name !== undefined && flat.name.length > 0) {
    result.name = flat.name;
  }
  if (flat.description !== undefined) {
    result.description = flat.description.length > 0 ? flat.description : null;
  }
  if (flat.provider !== undefined && flat.provider.length > 0) {
    result.provider = flat.provider;
  }
  if (flat.model !== undefined && flat.model.length > 0) {
    result.model = flat.model;
  }
  if (flat.visionModel !== undefined) {
    result.visionModel = flat.visionModel.length > 0 ? flat.visionModel : null;
  }
  if (flat.maxReferencedMessages !== undefined && flat.maxReferencedMessages.length > 0) {
    const num = parseInt(flat.maxReferencedMessages, 10);
    if (!isNaN(num)) {
      result.maxReferencedMessages = num;
    }
  }

  // Build advancedParameters
  const advancedParameters: Record<string, unknown> = {};
  let hasAdvancedParams = false;

  // Sampling params
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

  for (const param of numericParams) {
    const value = flat[param];
    if (value !== undefined && value.length > 0) {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        advancedParameters[param] = num;
        hasAdvancedParams = true;
      }
    }
  }

  // Reasoning params - check each field explicitly for non-empty values
  const reasoning: Record<string, unknown> = {};
  let hasReasoning = false;

  if (flat.reasoning_effort !== undefined && flat.reasoning_effort.length > 0) {
    const validEfforts = ['high', 'medium', 'low', 'minimal', 'none'];
    const effort = flat.reasoning_effort.toLowerCase();
    if (validEfforts.includes(effort)) {
      reasoning.effort = effort;
      hasReasoning = true;
    }
  }

  if (flat.reasoning_max_tokens !== undefined && flat.reasoning_max_tokens.length > 0) {
    const num = parseInt(flat.reasoning_max_tokens, 10);
    if (!isNaN(num)) {
      reasoning.max_tokens = num;
      hasReasoning = true;
    }
  }

  if (flat.reasoning_exclude !== undefined && flat.reasoning_exclude.length > 0) {
    reasoning.exclude = flat.reasoning_exclude.toLowerCase() === 'true';
    hasReasoning = true;
  }

  if (flat.reasoning_enabled !== undefined && flat.reasoning_enabled.length > 0) {
    reasoning.enabled = flat.reasoning_enabled.toLowerCase() === 'true';
    hasReasoning = true;
  }

  if (hasReasoning) {
    advancedParameters.reasoning = reasoning;
    hasAdvancedParams = true;
  }

  if (hasAdvancedParams) {
    result.advancedParameters = advancedParameters;
  }

  return result;
}

// --- Section Definitions ---

const basicInfoSection: SectionDefinition<FlattenedPresetData> = {
  id: 'basic',
  label: '📝 Basic Info',
  description: 'Name and description',
  fieldIds: ['name', 'description'],
  fields: [
    {
      id: 'name',
      label: 'Preset Name',
      placeholder: 'My Custom Preset',
      required: true,
      style: 'short',
      maxLength: 100,
    },
    {
      id: 'description',
      label: 'Description',
      placeholder: 'Optimized for creative writing tasks',
      required: false,
      style: 'paragraph',
      maxLength: 500,
    },
  ],
  getStatus: data => {
    if (!data.name) {
      return SectionStatus.EMPTY;
    }
    return data.description ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.name) {
      parts.push(`**Name:** ${data.name}`);
    }
    if (data.description) {
      parts.push(`**Description:** ${data.description.slice(0, 50)}...`);
    }
    return parts.length > 0 ? parts.join('\n') : '_Not configured_';
  },
};

const modelSection: SectionDefinition<FlattenedPresetData> = {
  id: 'model',
  label: '🤖 Model',
  description: 'Provider and model settings',
  fieldIds: ['provider', 'model', 'visionModel'],
  fields: [
    {
      id: 'provider',
      label: 'Provider',
      placeholder: 'openrouter',
      required: false,
      style: 'short',
      maxLength: 50,
    },
    {
      id: 'model',
      label: 'Model ID',
      placeholder: 'anthropic/claude-sonnet-4',
      required: true,
      style: 'short',
      maxLength: 200,
    },
    {
      id: 'visionModel',
      label: 'Vision Model (optional)',
      placeholder: 'anthropic/claude-sonnet-4',
      required: false,
      style: 'short',
      maxLength: 200,
    },
  ],
  getStatus: data => {
    if (!data.model) {
      return SectionStatus.EMPTY;
    }
    return SectionStatus.COMPLETE;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.provider) {
      parts.push(`**Provider:** ${data.provider}`);
    }
    if (data.model) {
      parts.push(`**Model:** \`${data.model}\``);
    }
    if (data.visionModel) {
      parts.push(`**Vision:** \`${data.visionModel}\``);
    }
    return parts.length > 0 ? parts.join('\n') : '_Not configured_';
  },
};

const coreSamplingSection: SectionDefinition<FlattenedPresetData> = {
  id: 'sampling',
  label: '🎛️ Core Sampling',
  description: 'Temperature, top_p, top_k, max_tokens, seed',
  fieldIds: ['temperature', 'top_p', 'top_k', 'max_tokens', 'seed'],
  fields: [
    {
      id: 'temperature',
      label: 'Temperature (0.0 - 2.0)',
      placeholder: '0.7',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'top_p',
      label: 'Top P (0.0 - 1.0)',
      placeholder: '0.9',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'top_k',
      label: 'Top K (integer)',
      placeholder: '40',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'max_tokens',
      label: 'Max Tokens',
      placeholder: '4096',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'seed',
      label: 'Seed (for reproducibility)',
      placeholder: '42',
      required: false,
      style: 'short',
      maxLength: 15,
    },
  ],
  getStatus: data => {
    const hasAny = data.temperature || data.top_p || data.top_k || data.max_tokens || data.seed;
    return hasAny ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.temperature) {
      parts.push(`temp=${data.temperature}`);
    }
    if (data.top_p) {
      parts.push(`top_p=${data.top_p}`);
    }
    if (data.top_k) {
      parts.push(`top_k=${data.top_k}`);
    }
    if (data.max_tokens) {
      parts.push(`max=${data.max_tokens}`);
    }
    if (data.seed) {
      parts.push(`seed=${data.seed}`);
    }
    return parts.length > 0 ? parts.join(', ') : '_Using defaults_';
  },
};

const penaltiesSection: SectionDefinition<FlattenedPresetData> = {
  id: 'penalties',
  label: '⚖️ Penalties',
  description: 'Frequency, presence, repetition penalties, min_p, top_a',
  fieldIds: ['frequency_penalty', 'presence_penalty', 'repetition_penalty', 'min_p', 'top_a'],
  fields: [
    {
      id: 'frequency_penalty',
      label: 'Frequency Penalty (-2.0 to 2.0)',
      placeholder: '0.0',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'presence_penalty',
      label: 'Presence Penalty (-2.0 to 2.0)',
      placeholder: '0.0',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'repetition_penalty',
      label: 'Repetition Penalty (0.0 to 2.0)',
      placeholder: '1.0',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'min_p',
      label: 'Min P (0.0 to 1.0)',
      placeholder: '0.0',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'top_a',
      label: 'Top A (0.0 to 1.0)',
      placeholder: '0.0',
      required: false,
      style: 'short',
      maxLength: 10,
    },
  ],
  getStatus: data => {
    const hasAny =
      data.frequency_penalty ||
      data.presence_penalty ||
      data.repetition_penalty ||
      data.min_p ||
      data.top_a;
    return hasAny ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.frequency_penalty) {
      parts.push(`freq=${data.frequency_penalty}`);
    }
    if (data.presence_penalty) {
      parts.push(`pres=${data.presence_penalty}`);
    }
    if (data.repetition_penalty) {
      parts.push(`rep=${data.repetition_penalty}`);
    }
    if (data.min_p) {
      parts.push(`min_p=${data.min_p}`);
    }
    if (data.top_a) {
      parts.push(`top_a=${data.top_a}`);
    }
    return parts.length > 0 ? parts.join(', ') : '_Using defaults_';
  },
};

const reasoningSection: SectionDefinition<FlattenedPresetData> = {
  id: 'reasoning',
  label: '🧠 Reasoning',
  description: 'Extended thinking configuration',
  fieldIds: ['reasoning_effort', 'reasoning_max_tokens', 'reasoning_exclude', 'reasoning_enabled'],
  fields: [
    {
      id: 'reasoning_effort',
      label: 'Effort (high/medium/low/minimal/none)',
      placeholder: 'medium',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'reasoning_max_tokens',
      label: 'Max Reasoning Tokens',
      placeholder: '10000',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'reasoning_exclude',
      label: 'Exclude from response (true/false)',
      placeholder: 'false',
      required: false,
      style: 'short',
      maxLength: 5,
    },
    {
      id: 'reasoning_enabled',
      label: 'Enabled (true/false)',
      placeholder: 'true',
      required: false,
      style: 'short',
      maxLength: 5,
    },
  ],
  getStatus: data => {
    const hasAny =
      data.reasoning_effort ||
      data.reasoning_max_tokens ||
      data.reasoning_exclude ||
      data.reasoning_enabled;
    return hasAny ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.reasoning_enabled === 'true' || data.reasoning_enabled === 'false') {
      parts.push(`enabled=${data.reasoning_enabled}`);
    }
    if (data.reasoning_effort) {
      parts.push(`effort=${data.reasoning_effort}`);
    }
    if (data.reasoning_max_tokens) {
      parts.push(`max=${data.reasoning_max_tokens}`);
    }
    if (data.reasoning_exclude) {
      parts.push(`exclude=${data.reasoning_exclude}`);
    }
    return parts.length > 0 ? parts.join(', ') : '_Using defaults_';
  },
};

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
  sections: [
    basicInfoSection,
    modelSection,
    coreSamplingSection,
    penaltiesSection,
    reasoningSection,
  ],
  actions: [{ id: 'refresh', label: 'Refresh', description: 'Reload preset data', emoji: '🔄' }],
  getFooter: () => 'Select a section to edit • Changes save automatically',
  color: 0x5865f2, // Discord blurple
};
