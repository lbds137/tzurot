/**
 * LLM Config Fields Metadata - Single Source of Truth
 *
 * This module defines metadata for all LLM configuration fields in one place.
 * Adding a new field requires only updating this file - all derived types,
 * keys, and conversion functions are generated from this metadata.
 *
 * Each field has:
 * - schema: Zod validation schema
 * - default: Default value (undefined if no default)
 * - category: Grouping for organization
 * - dbKey: Snake_case key used in database JSONB (undefined for non-JSONB fields)
 *
 * @see https://openrouter.ai/docs/api/reference/parameters
 */

import { z } from 'zod';

// ============================================
// FIELD CATEGORIES
// ============================================

/**
 * Categories for LLM config fields.
 * Used for grouping fields in UI and organizing defaults.
 */
export type LlmConfigCategory =
  | 'core' // Model identifiers
  | 'sampling' // Temperature, top_p, etc.
  | 'sampling_advanced' // min_p, top_a, seed
  | 'output' // max_tokens, stop, response_format
  | 'reasoning' // Reasoning/thinking config
  | 'openrouter' // OpenRouter-specific params
  | 'memory' // Memory retrieval config
  | 'context'; // Context window config

// ============================================
// FIELD METADATA TYPE
// ============================================

/**
 * Metadata for a single LLM config field.
 * The generic T represents the Zod schema's inferred type.
 */
export interface LlmConfigFieldMeta<T = unknown> {
  /** Zod schema for validation */
  schema: z.ZodType<T>;
  /** Default value (undefined if no default) */
  default?: T;
  /** Category for grouping */
  category: LlmConfigCategory;
  /** Snake_case key in database JSONB (undefined for non-JSONB fields) */
  dbKey?: string;
  /** Human-readable description */
  description: string;
}

// ============================================
// REASONING SUB-SCHEMA
// ============================================

/**
 * Reasoning configuration schema (nested object).
 * Matches OpenRouter's unified reasoning parameter.
 */
export const reasoningSchema = z
  .object({
    effort: z.enum(['xhigh', 'high', 'medium', 'low', 'minimal', 'none']).optional(),
    maxTokens: z.number().int().min(1024).max(32000).optional(),
    exclude: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .optional();

export type ReasoningConfigValue = z.infer<typeof reasoningSchema>;

// ============================================
// FIELD DEFINITIONS
// ============================================

/**
 * All LLM config fields with their metadata.
 *
 * This is the SINGLE SOURCE OF TRUTH for LLM configuration.
 * All keys, types, and conversion logic are derived from this.
 */
export const LLM_CONFIG_FIELDS = {
  // ----------------------------------------
  // Core model fields (not in advancedParameters JSONB)
  // ----------------------------------------
  visionModel: {
    schema: z.string().optional(),
    default: undefined,
    category: 'core' as const,
    dbKey: undefined, // Not in JSONB - separate column
    description: 'Model for vision/image processing',
  },

  // ----------------------------------------
  // Basic sampling parameters
  // ----------------------------------------
  temperature: {
    schema: z.number().min(0).max(2).optional(),
    default: 0.7,
    category: 'sampling' as const,
    dbKey: 'temperature',
    description: 'Randomness (0 = deterministic, 2 = very random)',
  },
  topP: {
    schema: z.number().min(0).max(1).optional(),
    default: undefined,
    category: 'sampling' as const,
    dbKey: 'top_p',
    description: 'Nucleus sampling - consider tokens with top_p probability mass',
  },
  topK: {
    schema: z.number().int().min(0).optional(),
    default: undefined,
    category: 'sampling' as const,
    dbKey: 'top_k',
    description: 'Consider only top K tokens (0 = disabled)',
  },
  frequencyPenalty: {
    schema: z.number().min(-2).max(2).optional(),
    default: undefined,
    category: 'sampling' as const,
    dbKey: 'frequency_penalty',
    description: 'Penalize tokens based on frequency in response',
  },
  presencePenalty: {
    schema: z.number().min(-2).max(2).optional(),
    default: undefined,
    category: 'sampling' as const,
    dbKey: 'presence_penalty',
    description: 'Penalize tokens that have appeared at all',
  },
  repetitionPenalty: {
    schema: z.number().min(0).max(2).optional(),
    default: undefined,
    category: 'sampling' as const,
    dbKey: 'repetition_penalty',
    description: 'Alternative penalty method for open-source models',
  },

  // ----------------------------------------
  // Advanced sampling parameters
  // ----------------------------------------
  minP: {
    schema: z.number().min(0).max(1).optional(),
    default: undefined,
    category: 'sampling_advanced' as const,
    dbKey: 'min_p',
    description: 'Minimum probability threshold - tokens below are excluded',
  },
  topA: {
    schema: z.number().min(0).max(1).optional(),
    default: undefined,
    category: 'sampling_advanced' as const,
    dbKey: 'top_a',
    description: 'Top-A sampling - consider tokens with probability >= (top_a * max_prob)',
  },
  seed: {
    schema: z.number().int().optional(),
    default: undefined,
    category: 'sampling_advanced' as const,
    dbKey: 'seed',
    description: 'Random seed for reproducible generation',
  },

  // ----------------------------------------
  // Output control parameters
  // ----------------------------------------
  maxTokens: {
    schema: z.number().int().positive().optional(),
    default: 2000,
    category: 'output' as const,
    dbKey: 'max_tokens',
    description: 'Maximum tokens in the response',
  },
  stop: {
    schema: z.array(z.string()).optional(),
    default: undefined,
    category: 'output' as const,
    dbKey: 'stop',
    description: 'Stop sequences - generation stops when encountered',
  },
  logitBias: {
    schema: z.record(z.string(), z.number().min(-100).max(100)).optional(),
    default: undefined,
    category: 'output' as const,
    dbKey: 'logit_bias',
    description: 'Adjust probability of specific tokens',
  },
  responseFormat: {
    schema: z.object({ type: z.enum(['text', 'json_object']) }).optional(),
    default: undefined,
    category: 'output' as const,
    dbKey: 'response_format',
    description: 'Response format for structured output',
  },
  showThinking: {
    schema: z.boolean().optional(),
    default: undefined,
    category: 'output' as const,
    dbKey: 'show_thinking',
    description: 'Display <think> blocks to users',
  },

  // ----------------------------------------
  // Reasoning configuration
  // ----------------------------------------
  reasoning: {
    schema: reasoningSchema,
    default: undefined,
    category: 'reasoning' as const,
    dbKey: 'reasoning',
    description: 'Reasoning token configuration for thinking models',
  },

  // ----------------------------------------
  // OpenRouter-specific parameters
  // ----------------------------------------
  transforms: {
    schema: z.array(z.string()).optional(),
    default: undefined,
    category: 'openrouter' as const,
    dbKey: 'transforms',
    description: 'Prompt transforms (e.g., middle-out for long contexts)',
  },
  route: {
    schema: z.enum(['fallback']).optional(),
    default: undefined,
    category: 'openrouter' as const,
    dbKey: 'route',
    description: 'Provider routing strategy',
  },
  verbosity: {
    schema: z.enum(['low', 'medium', 'high']).optional(),
    default: undefined,
    category: 'openrouter' as const,
    dbKey: 'verbosity',
    description: 'Response verbosity level',
  },

  // ----------------------------------------
  // Memory configuration (not in JSONB)
  // ----------------------------------------
  memoryScoreThreshold: {
    schema: z.number().min(0).max(1).optional(),
    default: undefined,
    category: 'memory' as const,
    dbKey: undefined, // Not in JSONB - separate column
    description: 'Minimum similarity score for memory retrieval',
  },
  memoryLimit: {
    schema: z.number().int().positive().optional(),
    default: undefined,
    category: 'memory' as const,
    dbKey: undefined, // Not in JSONB - separate column
    description: 'Maximum number of memories to retrieve',
  },

  // ----------------------------------------
  // Context window configuration (not in JSONB)
  // ----------------------------------------
  contextWindowTokens: {
    schema: z.number().int().positive().optional(),
    default: 16000,
    category: 'context' as const,
    dbKey: undefined, // Not in JSONB - separate column
    description: 'Context window size in tokens',
  },
} as const satisfies Record<string, LlmConfigFieldMeta>;

// ============================================
// DERIVED TYPES AND CONSTANTS
// ============================================

/**
 * All LLM config override key names.
 * Derived from LLM_CONFIG_FIELDS - no separate maintenance required.
 */
export const LLM_CONFIG_OVERRIDE_KEYS = Object.keys(LLM_CONFIG_FIELDS) as LlmConfigOverrideKey[];

/**
 * Type for valid LLM config override keys.
 */
export type LlmConfigOverrideKey = keyof typeof LLM_CONFIG_FIELDS;

/**
 * Fields that are stored in the advancedParameters JSONB column.
 * These have a dbKey defined in their metadata.
 */
export const LLM_CONFIG_JSONB_KEYS = Object.entries(LLM_CONFIG_FIELDS)
  .filter(([, meta]) => meta.dbKey !== undefined)
  .map(([key]) => key) as LlmConfigOverrideKey[];

/**
 * Fields that are NOT in JSONB (stored as separate columns).
 */
export const LLM_CONFIG_COLUMN_KEYS = Object.entries(LLM_CONFIG_FIELDS)
  .filter(([, meta]) => meta.dbKey === undefined)
  .map(([key]) => key) as LlmConfigOverrideKey[];

/**
 * Mapping from camelCase keys to snake_case DB keys.
 * Only includes fields that are in the JSONB column.
 */
export const CAMEL_TO_SNAKE_MAP = Object.fromEntries(
  Object.entries(LLM_CONFIG_FIELDS)
    .filter(([, meta]) => meta.dbKey !== undefined)
    .map(([key, meta]) => [key, meta.dbKey as string])
) as Record<string, string>;

/**
 * Reverse mapping from snake_case DB keys to camelCase keys.
 */
export const SNAKE_TO_CAMEL_MAP = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE_MAP).map(([camel, snake]) => [snake, camel])
) as Record<string, string>;

/**
 * Get fields by category.
 */
export function getFieldsByCategory(category: LlmConfigCategory): LlmConfigOverrideKey[] {
  return Object.entries(LLM_CONFIG_FIELDS)
    .filter(([, meta]) => meta.category === category)
    .map(([key]) => key) as LlmConfigOverrideKey[];
}

/**
 * Get default value for a field.
 */
export function getFieldDefault<K extends LlmConfigOverrideKey>(
  key: K
): (typeof LLM_CONFIG_FIELDS)[K]['default'] {
  return LLM_CONFIG_FIELDS[key].default;
}

/**
 * Get all defaults as an object.
 */
export function getAllDefaults(): Partial<Record<LlmConfigOverrideKey, unknown>> {
  return Object.fromEntries(
    Object.entries(LLM_CONFIG_FIELDS)
      .filter(([, meta]) => meta.default !== undefined)
      .map(([key, meta]) => [key, meta.default])
  );
}
