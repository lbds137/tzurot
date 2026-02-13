/**
 * Preset Dashboard Section Definitions
 *
 * Extracted from config.ts to keep file under 500 lines.
 * Contains the UI configuration for each section of the preset dashboard.
 */

import { SectionStatus, type SectionDefinition } from '../../utils/dashboard/types.js';
import type { FlattenedPresetData } from './types.js';

/** Common separator for preview fields */
const PREVIEW_SEPARATOR = ', ';
/** Default preview message when no custom values set */
const DEFAULT_PREVIEW = '_Using defaults_';

// Context section defaults
const DEFAULT_MAX_MESSAGES = '50';
const DEFAULT_MAX_IMAGES = '10';
const DEFAULT_CONTEXT_WINDOW = '131072';

// Time conversion constants
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;

/** Format context window tokens with optional model cap info */
function formatContextWindow(data: FlattenedPresetData): string | null {
  if (!data.contextWindowTokens) {
    return null;
  }
  const t = parseInt(data.contextWindowTokens, 10);
  if (isNaN(t)) {
    return null;
  }
  const ctxK = Math.round(t / 1000);
  if (data.contextWindowCap === undefined) {
    return `ctx=${ctxK}K`;
  }
  const capK = Math.round(data.contextWindowCap / 1000);
  if (t > data.contextWindowCap) {
    return `ctx=${ctxK}K (max ${capK}K ⚠️)`;
  }
  const modelK = Math.round((data.modelContextLength ?? 0) / 1000);
  return `ctx=${ctxK}K / ${modelK}K`;
}

/** Format seconds as human-readable duration (e.g., "2d", "6h", "300s") */
function formatAge(seconds: number): string {
  if (seconds >= SECONDS_PER_DAY) {
    return `${Math.floor(seconds / SECONDS_PER_DAY)}d`;
  }
  if (seconds >= SECONDS_PER_HOUR) {
    return `${Math.floor(seconds / SECONDS_PER_HOUR)}h`;
  }
  return `${seconds}s`;
}

/** Shorthand for creating a modal field definition (most fields share required=false, style=short) */
function f(
  id: string,
  label: string,
  placeholder: string,
  maxLength: number,
  required = false
): {
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
  style: 'short';
  maxLength: number;
} {
  return { id, label, placeholder, required, style: 'short' as const, maxLength };
}

// --- Section Definitions ---

export const identitySection: SectionDefinition<FlattenedPresetData> = {
  id: 'identity',
  label: '📝 Identity',
  description: 'Name, description, and model',
  fieldIds: ['name', 'description', 'provider', 'model', 'visionModel'],
  fields: [
    f('name', 'Preset Name', 'My Custom Preset', 100, true),
    f('description', 'Description', 'Optimized for creative writing tasks', 200),
    f('provider', 'Provider', 'openrouter', 50),
    f('model', 'Model ID', 'anthropic/claude-sonnet-4', 200, true),
    f('visionModel', 'Vision Model (optional)', 'anthropic/claude-sonnet-4', 200),
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
    f('temperature', 'Temperature (0.0 - 2.0)', '0.7', 10),
    f('top_p', 'Top P (0.0 - 1.0)', '0.9', 10),
    f('top_k', 'Top K (integer)', '40', 10),
    f('max_tokens', 'Max Tokens', '4096', 10),
    f('seed', 'Seed (for reproducibility)', '42', 15),
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
    return parts.length > 0 ? parts.join(PREVIEW_SEPARATOR) : DEFAULT_PREVIEW;
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
    return parts.length > 0 ? parts.join(PREVIEW_SEPARATOR) : DEFAULT_PREVIEW;
  },
};

export const contextSection: SectionDefinition<FlattenedPresetData> = {
  id: 'context',
  label: '📜 Context',
  description: 'History limits and context window budget',
  fieldIds: ['maxMessages', 'maxAge', 'maxImages', 'contextWindowTokens', 'memoryScoreThreshold'],
  fields: [
    {
      id: 'maxMessages',
      label: 'Max Messages (1-100)',
      placeholder: '50',
      required: false,
      style: 'short',
      maxLength: 3,
    },
    {
      id: 'maxAge',
      label: 'Max Age (seconds, empty = no limit)',
      placeholder: '86400 (24 hours)',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'maxImages',
      label: 'Max Images (0-20, 0 = disabled)',
      placeholder: '10',
      required: false,
      style: 'short',
      maxLength: 2,
    },
    {
      id: 'contextWindowTokens',
      label: 'Context Window Tokens (max 50% of model)',
      placeholder: '131072',
      required: false,
      style: 'short',
      maxLength: 10,
    },
    {
      id: 'memoryScoreThreshold',
      label: 'Memory Score Threshold (0.0-1.0)',
      placeholder: '0.5',
      required: false,
      style: 'short',
      maxLength: 5,
    },
  ],
  getStatus: data => {
    const isSet = (val: string | undefined, def?: string): boolean =>
      val !== undefined && val !== '' && val !== def;
    const hasCustom =
      isSet(data.maxMessages, DEFAULT_MAX_MESSAGES) ||
      isSet(data.maxAge) ||
      isSet(data.maxImages, DEFAULT_MAX_IMAGES) ||
      isSet(data.contextWindowTokens, DEFAULT_CONTEXT_WINDOW) ||
      isSet(data.memoryScoreThreshold);
    return hasCustom ? SectionStatus.COMPLETE : SectionStatus.DEFAULT;
  },
  getPreview: data => {
    const parts: string[] = [];
    if (data.maxMessages) {
      parts.push(`msgs=${data.maxMessages}`);
    }
    if (data.maxAge) {
      const s = parseInt(data.maxAge, 10);
      if (!isNaN(s)) {
        parts.push(`age=${formatAge(s)}`);
      }
    }
    if (data.maxImages) {
      parts.push(`imgs=${data.maxImages}`);
    }
    const ctxLabel = formatContextWindow(data);
    if (ctxLabel !== null) {
      parts.push(ctxLabel);
    }
    if (data.memoryScoreThreshold) {
      parts.push(`mem≥${data.memoryScoreThreshold}`);
    }
    return parts.length > 0
      ? parts.join(PREVIEW_SEPARATOR)
      : `_Using defaults (${DEFAULT_MAX_MESSAGES} msgs, no limit, ${DEFAULT_MAX_IMAGES} imgs)_`;
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
    return parts.length > 0 ? parts.join(PREVIEW_SEPARATOR) : DEFAULT_PREVIEW;
  },
};
