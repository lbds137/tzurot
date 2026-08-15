/**
 * Advanced LLM Parameters Schema for OpenRouter
 *
 * OpenRouter normalizes parameters across all underlying models (OpenAI, Anthropic, Google, etc).
 * This schema validates JSONB from the LlmConfig.advancedParameters column.
 *
 * Key features:
 * - One canonical `thinking` level, translated per provider at request-build
 *   time (OpenRouter `reasoning.effort`, z.ai `thinking`/`reasoning_effort`)
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
// THINKING (extended-reasoning) PARAMETER
// One canonical level, translated per provider at request-build time.
// ============================================

/**
 * The canonical thinking levels — our own vocabulary, deliberately
 * provider-neutral so each provider builder can translate FROM it
 * (OpenRouter `reasoning.effort`, z.ai `thinking` + `reasoning_effort`).
 *
 * Ordered weakest-to-strongest after `off`. Budget shares are approximate and
 * are what `AI_DEFAULTS.REASONING_MODEL_MAX_TOKENS` encodes.
 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'max'] as const;

/** The thinking-level union, for consumers that need the type without the tuple. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * The single extended-thinking knob.
 *
 * ABSENT is distinct from `'off'`: absent means "send nothing, take the
 * provider default", while `'off'` explicitly asks the provider to disable
 * reasoning. Configs that carry no thinking key must keep behaving exactly as
 * they did before this field existed.
 */
export const ThinkingParamsSchema = z.object({
  /**
   * Extended-thinking level:
   * - off: reasoning disabled
   * - minimal: ~10% of max_tokens
   * - low: ~20% of max_tokens
   * - medium: ~50% of max_tokens
   * - high: ~80% of max_tokens
   * - max: maximum thinking the provider offers
   *
   * Omit the key entirely to take the provider default.
   */
  thinking: z.enum(THINKING_LEVELS).optional(),
});

// ============================================
// LEGACY `reasoning` UPGRADE
// ============================================

/** The retired effort names that map 1:1 onto a canonical level. */
const LEGACY_EFFORT_TO_LEVEL: Readonly<Record<string, ThinkingLevel>> = {
  none: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'max',
};

/** The retired 4-knob object, as it may still appear in an on-disk export file. */
interface LegacyReasoningShape {
  effort?: unknown;
  max_tokens?: unknown;
  exclude?: unknown;
  enabled?: unknown;
}

/**
 * Map one legacy `reasoning` object onto a canonical level, in precedence
 * order. Returns `undefined` when the object expresses no level at all
 * (empty, `exclude`-only, or `enabled: true` with no budget) — such a payload
 * gets NO `thinking` key, which preserves "take the provider default".
 *
 * This mapping is duplicated as a SQL `CASE` in
 * `prisma/migrations/20260814120000_collapse_reasoning_to_thinking/migration.sql`.
 * `llmAdvancedParams.test.ts` pins THIS half against a table; nothing executes
 * the SQL to compare, so the two are kept in step by convention — change them
 * together. The migration's header records where they deliberately differ.
 */
function legacyReasoningToLevel(reasoning: LegacyReasoningShape): ThinkingLevel | undefined {
  // Explicit off wins over any effort — the two encodings of "no reasoning"
  // that prod data actually carries ({enabled:false} and {effort:'none'})
  // must land on the same level.
  if (reasoning.enabled === false) {
    return 'off';
  }
  if (typeof reasoning.effort === 'string') {
    const mapped = LEGACY_EFFORT_TO_LEVEL[reasoning.effort];
    if (mapped !== undefined) {
      return mapped;
    }
  }
  // A bare token budget expressed intent without a level. Fixed mapping, not
  // proportional to the number: the retired schema documented `high` as ~80%
  // of max_tokens, so it is the level whose DOCUMENTED meaning matches "a
  // budget was set" — a 1024-token budget lands on `high` the same as a
  // 32000-token one.
  if (typeof reasoning.max_tokens === 'number') {
    return 'high';
  }
  return undefined;
}

/**
 * Upgrade an inbound `advancedParameters` payload that still carries the
 * retired 4-knob `reasoning` object into the canonical `thinking` level.
 *
 * Non-object input, and input without a `reasoning` object, pass through
 * untouched. A `thinking` key already carrying a VALUE wins — a payload
 * holding both is treated as already-canonical with a stale leftover. An
 * explicit `thinking: null` does not win, since it expresses no level.
 *
 * Exported so the same mapping is available to any validation boundary; wired
 * in via `AdvancedParamsInputSchema`.
 */
export function upgradeLegacyReasoningShape(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return params;
  }
  const record = params as Record<string, unknown>;
  const { reasoning } = record;
  if (typeof reasoning !== 'object' || reasoning === null || Array.isArray(reasoning)) {
    return params;
  }

  const { reasoning: _dropped, ...rest } = record;
  // Both nullish forms fall through, not just `undefined`: an explicit
  // `thinking: null` expresses no level, so the legacy object must still be
  // mapped. Short-circuiting on it would hand a null to the enum, which
  // accepts `undefined` but rejects `null` — turning a payload we can upgrade
  // into a rejected request. Spelled out rather than `!= null` because
  // `eqeqeq` bans the loose form.
  if (rest.thinking !== undefined && rest.thinking !== null) {
    return rest;
  }
  const level = legacyReasoningToLevel(reasoning);
  return level === undefined ? rest : { ...rest, thinking: level };
}

// ============================================
// OUTPUT CONTROL PARAMETERS
// ============================================

/**
 * Parameters that control response output format and limits.
 */
export const OutputParamsSchema = z.object({
  /** Maximum tokens in the response (not including reasoning tokens) */
  max_tokens: z.number().int().positive().optional(),

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
export const AdvancedParamsSchema = SamplingParamsSchema.merge(ThinkingParamsSchema)
  .merge(OutputParamsSchema)
  .merge(OpenRouterParamsSchema);

export type AdvancedParams = z.infer<typeof AdvancedParamsSchema>;

/**
 * The same shape, but tolerant of the retired 4-knob `reasoning` object on the
 * way in. Use this for any INBOUND payload that may predate the collapse
 * (preset JSON import, an old client) — plain `AdvancedParamsSchema` strips an
 * unknown `reasoning` key silently, which would drop the user's setting with
 * no error.
 *
 * Accepted tradeoff: `z.preprocess` makes `z.input<>` of this schema `unknown`,
 * because the preprocess function itself takes `unknown`. Any route typing its
 * parameter off `z.input` therefore loses compile-time shape-checking of
 * `advancedParameters` — a `{ thnking: 'high' }` typo becomes a runtime Zod
 * rejection rather than a type error. That is the price of accepting the legacy
 * shape at all; `z.infer` (the OUTPUT type) is unaffected and still exact.
 */
export const AdvancedParamsInputSchema = z.preprocess(
  upgradeLegacyReasoningShape,
  AdvancedParamsSchema
);

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Safely validate advancedParameters, returning null on failure.
 * Logs validation errors at debug level.
 *
 * Handles null/undefined from database JSONB by returning empty object.
 *
 * Parses through `AdvancedParamsInputSchema`, so a stored row still carrying
 * the retired `reasoning` object is UPGRADED on read rather than stripped.
 * That matters in the window between deploying this code and running the data
 * migration in a given environment: plain strip-mode would make the config's
 * level appear to vanish from the dashboard and `/inspect` until the migration
 * lands. The upgrade is idempotent, so a migrated row is unaffected.
 *
 * @param params - Raw params from database JSONB or user input
 * @returns Validated AdvancedParams or null if invalid
 */
export function safeValidateAdvancedParams(params: unknown): AdvancedParams | null {
  // Handle null/undefined from database JSONB
  if (params === null || params === undefined) {
    return {};
  }
  const result = AdvancedParamsInputSchema.safeParse(params);
  if (!result.success) {
    logger.debug(
      { errors: result.error.flatten().fieldErrors },
      'Failed to validate advanced params'
    );
    return null;
  }
  return result.data;
}

// ============================================
// CONVERSION UTILITIES
// ============================================

/**
 * Converted params in camelCase format for use in ResolvedLlmConfig.
 *
 * This interface represents ALL parameters from AdvancedParamsSchema,
 * converted from snake_case (OpenRouter API format) to camelCase (TypeScript convention).
 *
 * Parameter categories:
 * - Sampling (basic): temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty
 * - Sampling (advanced): minP, topA, seed
 * - Output: maxTokens, logitBias, responseFormat, showThinking
 * - Thinking: thinking level (for reasoning models)
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
  logitBias?: Record<string, number>;
  responseFormat?: { type: 'text' | 'json_object' };
  showThinking?: boolean;

  // Thinking level (for reasoning models: o1/o3, Claude, Gemini, DeepSeek R1, GLM)
  thinking?: ThinkingLevel;

  // OpenRouter-specific routing/transform params
  transforms?: string[];
  route?: 'fallback';
  verbosity?: 'low' | 'medium' | 'high';
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
    logitBias: params.logit_bias,
    responseFormat: params.response_format,
    showThinking: params.show_thinking,

    // Thinking level (same name both sides — no snake/camel split)
    thinking: params.thinking,

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
 * - Basic sampling: temperature, topP, topK, frequencyPenalty, presencePenalty, repetitionPenalty
 * - Advanced sampling: minP, topA, seed
 * - Output control: maxTokens, logitBias, responseFormat, showThinking
 * - Thinking: thinking (canonical level for reasoning models)
 * - OpenRouter-specific: transforms, route, verbosity
 * - Memory/context: memoryScoreThreshold, memoryLimit, contextWindowTokens
 */
export const LLM_CONFIG_OVERRIDE_KEYS = [
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
  'logitBias',
  'responseFormat',
  'showThinking',
  // Thinking (canonical level for reasoning models)
  'thinking',
  // OpenRouter-specific
  'transforms',
  'route',
  'verbosity',
  // Context window (model-coupled, stays in LlmConfig)
  'contextWindowTokens',
  // Note: memoryScoreThreshold, memoryLimit, maxMessages, maxAge, maxImages
  // have been moved to ConfigOverrides cascade.
  // They remain on the LlmConfig DB schema but are no longer read by the resolver.
] as const;

/**
 * Type for LLM config override keys.
 * Useful for type-safe iteration and validation.
 */
export type LlmConfigOverrideKey = (typeof LLM_CONFIG_OVERRIDE_KEYS)[number];

/** Any object carrying some subset of the override keys (a LoadedPersonality, a mapped/resolved config). */
type LlmOverrideSource = Readonly<Partial<Record<LlmConfigOverrideKey, unknown>>>;

/**
 * THE shared `LLM_CONFIG_OVERRIDE_KEYS` copy loop — the one place that decides
 * how override-key values move between configs and personalities, so the
 * resolver/stamp/fallback call sites cannot drift on the same question.
 *
 * Three modes, each preserving its call site's exact semantics:
 * - **plain** (no options): copy `primary[key]` onto `target`, skipping
 *   `undefined` — an absent key never clobbers what `target` carries
 *   (resolver `extractFromPersonality`, gateway stamp `applyResolvedConfig`).
 * - **fallback**: per-key `primary[key] ?? fallback[key]`, skipping
 *   `undefined` (resolver `mergeWithPersonality` — override wins, personality
 *   fills gaps).
 * - **clearAbsent**: assign `primary[key] ?? undefined` unconditionally — a
 *   key absent from `primary` CLEARS `target`'s value (quota fallback: the
 *   fallback config replaces the preset wholesale; the preset's sampling
 *   params must not survive onto the fallback model).
 *
 * Mutates and returns `target` (every call site builds `target` fresh).
 */
export function applyLlmOverrideParams<T extends object>(
  target: T,
  primary: LlmOverrideSource,
  options?: { fallback?: LlmOverrideSource; clearAbsent?: boolean }
): T {
  const sink = target as Record<LlmConfigOverrideKey, unknown>;
  for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
    if (options?.clearAbsent === true) {
      sink[key] = primary[key] ?? undefined;
      continue;
    }
    const value =
      options?.fallback === undefined ? primary[key] : (primary[key] ?? options.fallback[key]);
    if (value !== undefined) {
      sink[key] = value;
    }
  }
  return target;
}
