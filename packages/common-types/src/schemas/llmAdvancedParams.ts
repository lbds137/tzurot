/**
 * Advanced LLM Parameters Schema for OpenRouter
 *
 * OpenRouter normalizes parameters across all underlying models (OpenAI, Anthropic, Google, etc).
 * This schema validates JSONB from the LlmConfig.advancedParameters column.
 *
 * Key features:
 * - Unified `reasoning` object works across o1/o3, Claude, Gemini, DeepSeek R1
 * - Snake_case to match OpenRouter REST API (LangChain passes unknown params as-is)
 * - All fields optional to support partial configurations
 *
 * @see https://openrouter.ai/docs/api/reference/parameters
 * @see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
 */

import { z } from 'zod';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('llmAdvancedParams');

// ============================================
// SAMPLING PARAMETERS
// OpenRouter REST API uses snake_case. LangChain passes unknown params as-is.
// We store in snake_case to match what gets sent to the API.
// ============================================

/**
 * Sampling parameters that control response generation randomness.
 * Widely supported across most models.
 */
export const SamplingParamsSchema = z.object({
  /** Temperature for randomness (0 = deterministic, 2 = very random) */
  temperature: z.number().min(0).max(2).optional(),

  /** Nucleus sampling - consider tokens with top_p probability mass */
  top_p: z.number().min(0).max(1).optional(),

  /** Consider only top K tokens (0 = disabled) */
  top_k: z.number().int().min(0).optional(),

  /** Penalize tokens based on frequency in response (-2 to 2) */
  frequency_penalty: z.number().min(-2).max(2).optional(),

  /** Penalize tokens that have appeared at all (-2 to 2) */
  presence_penalty: z.number().min(-2).max(2).optional(),

  /** Alternative penalty method for open-source models (0 to 2) */
  repetition_penalty: z.number().min(0).max(2).optional(),

  /** Minimum probability threshold - tokens below this are excluded */
  min_p: z.number().min(0).max(1).optional(),

  /** Top-A sampling - consider tokens with probability >= (top_a * max_prob) */
  top_a: z.number().min(0).max(1).optional(),

  /** Random seed for reproducible generation */
  seed: z.number().int().optional(),
});

// ============================================
// REASONING PARAMETERS (Unified by OpenRouter)
// Works across: OpenAI o1/o3, Claude, Gemini, DeepSeek R1
// ============================================

/**
 * Reasoning token configuration for "thinking" models.
 * OpenRouter normalizes this across different providers.
 */
export const ReasoningConfigSchema = z.object({
  /**
   * Effort level - maps to approximate reasoning token budget:
   * - xhigh: ~95% of max_tokens (maximum thinking)
   * - high: ~80% of max_tokens
   * - medium: ~50% of max_tokens
   * - low: ~20% of max_tokens
   * - minimal: ~10% of max_tokens
   * - none: 0% (reasoning disabled)
   */
  effort: z.enum(['xhigh', 'high', 'medium', 'low', 'minimal', 'none']).optional(),

  /**
   * Direct token budget for reasoning (Anthropic, Gemini, Alibaba Qwen).
   * Constraints: min 1024, max 32000, must be < max_tokens
   */
  max_tokens: z.number().int().min(1024).max(32000).optional(),

  /** Whether to exclude reasoning from the response (default: false = include) */
  exclude: z.boolean().optional(),

  /** Enable/disable reasoning entirely (default: true for reasoning models) */
  enabled: z.boolean().optional(),
});

type ReasoningConfig = z.infer<typeof ReasoningConfigSchema>;

/**
 * Parameters containing reasoning configuration.
 */
export const ReasoningParamsSchema = z.object({
  /** Reasoning token configuration */
  reasoning: ReasoningConfigSchema.optional(),
});

// ============================================
// OUTPUT CONTROL PARAMETERS
// ============================================

/**
 * Parameters that control response output format and limits.
 */
export const OutputParamsSchema = z.object({
  /** Maximum tokens in the response (not including reasoning tokens) */
  max_tokens: z.number().int().positive().optional(),

  /** Stop sequences - generation stops when any of these are encountered */
  stop: z.array(z.string()).optional(),

  /** Logit bias - adjust probability of specific tokens (-100 to 100) */
  logit_bias: z.record(z.string(), z.number().min(-100).max(100)).optional(),

  /** Response format for structured output */
  response_format: z
    .object({
      type: z.enum(['text', 'json_object']),
    })
    .optional(),

  /**
   * Toggle for displaying <think> blocks to users.
   * When enabled, thinking content from reasoning models (DeepSeek R1, o1, Claude)
   * is extracted and shown as a separate message before the response.
   * Default: false (thinking content is hidden)
   */
  show_thinking: z.boolean().optional(),
});

// ============================================
// OPENROUTER-SPECIFIC PARAMETERS
// ============================================

/**
 * OpenRouter-specific routing and transform parameters.
 */
export const OpenRouterParamsSchema = z.object({
  /** Prompt transforms (e.g., 'middle-out' for long contexts) */
  transforms: z.array(z.string()).optional(),

  /** Provider routing strategy */
  route: z.enum(['fallback']).optional(),

  /** Response verbosity level */
  verbosity: z.enum(['low', 'medium', 'high']).optional(),
});

// ============================================
// COMBINED SCHEMA
// ============================================

/**
 * Complete advanced parameters schema for LlmConfig.advancedParameters.
 * Merges all parameter categories into a single validated structure.
 */
export const AdvancedParamsSchema = SamplingParamsSchema.merge(ReasoningParamsSchema)
  .merge(OutputParamsSchema)
  .merge(OpenRouterParamsSchema);

export type AdvancedParams = z.infer<typeof AdvancedParamsSchema>;

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate advancedParameters from database/user input.
 * Returns validated params or throws ZodError.
 *
 * Handles null/undefined from database JSONB by returning empty object.
 *
 * @param params - Raw params from database JSONB or user input
 * @returns Validated AdvancedParams
 * @throws ZodError if validation fails
 */
export function validateAdvancedParams(params: unknown): AdvancedParams {
  // Handle null/undefined from database JSONB
  if (params === null || params === undefined) {
    return {};
  }
  return AdvancedParamsSchema.parse(params);
}

/**
 * Safely validate advancedParameters, returning null on failure.
 * Logs validation errors at debug level.
 *
 * Handles null/undefined from database JSONB by returning empty object.
 *
 * @param params - Raw params from database JSONB or user input
 * @returns Validated AdvancedParams or null if invalid
 */
export function safeValidateAdvancedParams(params: unknown): AdvancedParams | null {
  // Handle null/undefined from database JSONB
  if (params === null || params === undefined) {
    return {};
  }
  const result = AdvancedParamsSchema.safeParse(params);
  if (!result.success) {
    logger.debug(
      { errors: result.error.flatten().fieldErrors },
      'Failed to validate advanced params'
    );
    return null;
  }
  return result.data;
}

/**
 * Check if reasoning is enabled for these params.
 * Used to apply constraints (e.g., max_tokens > reasoning.max_tokens).
 *
 * @param params - Validated AdvancedParams
 * @returns true if reasoning is configured and enabled
 */
export function hasReasoningEnabled(params: AdvancedParams): boolean {
  if (params.reasoning === undefined) {
    return false;
  }
  if (params.reasoning.enabled === false) {
    return false;
  }
  if (params.reasoning.effort === 'none') {
    return false;
  }
  return params.reasoning.effort !== undefined || params.reasoning.max_tokens !== undefined;
}

/**
 * Validate reasoning constraints against max_tokens.
 * Returns true if valid, false if reasoning.max_tokens >= max_tokens.
 *
 * @param params - Validated AdvancedParams
 * @returns true if constraints are satisfied
 */
export function validateReasoningConstraints(params: AdvancedParams): boolean {
  if (params.reasoning?.max_tokens === undefined) {
    return true;
  }
  if (params.max_tokens === undefined) {
    return true;
  }

  // reasoning.max_tokens must be less than max_tokens to leave room for response
  return params.reasoning.max_tokens < params.max_tokens;
}

// ============================================
// CONVERSION UTILITIES
// ============================================

/**
 * Reasoning configuration in camelCase format.
 * Matches the OpenRouter API shape for easy pass-through.
 */
export interface ConvertedReasoningConfig {
  /** Effort level: xhigh (~95%), high (~80%), medium (~50%), low (~20%), minimal (~10%), none */
  effort?: 'xhigh' | 'high' | 'medium' | 'low' | 'minimal' | 'none';
  /** Direct token budget for reasoning (different from top-level maxTokens) */
  maxTokens?: number;
  /** Whether to exclude reasoning from the response */
  exclude?: boolean;
  /** Enable/disable reasoning entirely */
  enabled?: boolean;
}

/**
 * Converted params in camelCase format for use in ResolvedLlmConfig.
 *
 * This interface represents ALL parameters from AdvancedParamsSchema,
 * converted from snake_case (OpenRouter API format) to camelCase (TypeScript convention).
 *
 * Parameter categories:
 * - Sampling (basic): temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty
 * - Sampling (advanced): minP, topA, seed
 * - Output: maxTokens, stop, logitBias, responseFormat, showThinking
 * - Reasoning: reasoning object (for thinking models)
 * - OpenRouter-specific: transforms, route, verbosity
 */
export interface ConvertedLlmParams {
  // Sampling (basic) - widely supported across models
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;

  // Sampling (advanced) - OpenRouter-specific
  minP?: number;
  topA?: number;
  seed?: number;

  // Output control
  maxTokens?: number;
  stop?: string[];
  logitBias?: Record<string, number>;
  responseFormat?: { type: 'text' | 'json_object' };
  showThinking?: boolean;

  // Reasoning (for thinking models: o1/o3, Claude, Gemini, DeepSeek R1)
  reasoning?: ConvertedReasoningConfig;

  // OpenRouter-specific routing/transform params
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
}

/**
 * Convert reasoning config from snake_case to camelCase.
 * Internal helper for advancedParamsToConfigFormat.
 */
function convertReasoningConfig(
  reasoning: ReasoningConfig | undefined
): ConvertedReasoningConfig | undefined {
  if (reasoning === undefined) {
    return undefined;
  }
  return {
    effort: reasoning.effort,
    maxTokens: reasoning.max_tokens,
    exclude: reasoning.exclude,
    enabled: reasoning.enabled,
  };
}

/**
 * Convert advancedParameters (snake_case) to ResolvedLlmConfig format (camelCase).
 *
 * The database stores LLM params in snake_case (matching OpenRouter API format),
 * but TypeScript code uses camelCase. This function bridges that gap.
 *
 * Used by LlmConfigResolver to extract params from JSONB for inference.
 *
 * @param params - Validated AdvancedParams from database JSONB
 * @returns Object with camelCase keys for use in ResolvedLlmConfig
 */
export function advancedParamsToConfigFormat(params: AdvancedParams): ConvertedLlmParams {
  return {
    // Sampling (basic) - widely supported
    temperature: params.temperature,
    topP: params.top_p,
    topK: params.top_k,
    frequencyPenalty: params.frequency_penalty,
    presencePenalty: params.presence_penalty,
    repetitionPenalty: params.repetition_penalty,

    // Sampling (advanced) - OpenRouter-specific
    minP: params.min_p,
    topA: params.top_a,
    seed: params.seed,

    // Output control
    maxTokens: params.max_tokens,
    stop: params.stop,
    logitBias: params.logit_bias,
    responseFormat: params.response_format,
    showThinking: params.show_thinking,

    // Reasoning (for thinking models)
    reasoning: convertReasoningConfig(params.reasoning),

    // OpenRouter-specific routing/transform params
    transforms: params.transforms,
    route: params.route,
    verbosity: params.verbosity,
  };
}

// ============================================
// RESOLVED CONFIG KEY CONSTANTS
// ============================================

/**
 * Keys that can be overridden via LLM config (preset or user override).
 *
 * These keys are copied from ResolvedLlmConfig to LoadedPersonality during
 * config resolution. Used by both LlmConfigResolver and ConfigStep for consistency.
 *
 * Categories:
 * - Core: visionModel
 * - Basic sampling: temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty
 * - Advanced sampling: minP, topA, seed
 * - Output control: maxTokens, stop, logitBias, responseFormat, showThinking
 * - Reasoning: reasoning (for thinking models)
 * - OpenRouter-specific: transforms, route, verbosity
 * - Memory/context: memoryScoreThreshold, memoryLimit, contextWindowTokens
 */
export const LLM_CONFIG_OVERRIDE_KEYS = [
  // Core model
  'visionModel',
  // Basic sampling
  'temperature',
  'topP',
  'topK',
  'frequencyPenalty',
  'presencePenalty',
  'repetitionPenalty',
  // Advanced sampling
  'minP',
  'topA',
  'seed',
  // Output control
  'maxTokens',
  'stop',
  'logitBias',
  'responseFormat',
  'showThinking',
  // Reasoning (for thinking models)
  'reasoning',
  // OpenRouter-specific
  'transforms',
  'route',
  'verbosity',
  // Context window (model-coupled, stays in LlmConfig)
  'contextWindowTokens',
  // Note: memoryScoreThreshold, memoryLimit, maxMessages, maxAge, maxImages
  // have been moved to ConfigOverrides cascade (Phase 3 cleanup).
  // They remain on the LlmConfig DB schema but are no longer read by the resolver.
] as const;

/**
 * Type for LLM config override keys.
 * Useful for type-safe iteration and validation.
 */
