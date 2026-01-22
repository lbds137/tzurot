/**
 * Preset Dashboard Section Definitions
 *
 * Extracted from config.ts to keep file under 500 lines.
 * Contains the UI configuration for each section of the preset dashboard.
 */

import { SectionStatus, type SectionDefinition } from '../../utils/dashboard/types.js';
import type { FlattenedPresetData } from './types.js';

// --- Section Definitions ---

/**
 * Identity section - combines name/description with model settings
 * (5 fields, maximum for a Discord modal)
 */
export const identitySection: SectionDefinition<FlattenedPresetData> = {
  id: 'identity',
  label: '📝 Identity',
  description: 'Name, description, and model',
  fieldIds: ['name', 'description', 'provider', 'model', 'visionModel'],
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
      style: 'short', // Changed to short to fit 5 fields better
      maxLength: 200,
    },
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
    if (!data.name || !data.model) {
      return SectionStatus.EMPTY;
    }
    return data.description ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.name) {
      parts.push(`**Name:** ${data.name}`);
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

export const coreSamplingSection: SectionDefinition<FlattenedPresetData> = {
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

export const advancedSection: SectionDefinition<FlattenedPresetData> = {
  id: 'advanced',
  label: '🔧 Advanced',
  description: 'Penalties and advanced sampling (min_p, top_a)',
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

export const reasoningSection: SectionDefinition<FlattenedPresetData> = {
  id: 'reasoning',
  label: '🧠 Reasoning',
  description: 'Extended thinking configuration',
  fieldIds: [
    'reasoning_effort',
    'reasoning_max_tokens',
    'reasoning_exclude',
    'reasoning_enabled',
    'show_thinking',
  ],
  fields: [
    {
      id: 'reasoning_effort',
      label: 'Effort (xhigh/high/medium/low/minimal/none)',
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
    {
      id: 'show_thinking',
      label: 'Show Thinking (true/false)',
      placeholder: 'false',
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
      data.reasoning_enabled ||
      data.show_thinking;
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
    if (data.show_thinking === 'true') {
      parts.push('💭 show thinking');
    }
    return parts.length > 0 ? parts.join(', ') : '_Using defaults_';
  },
};
