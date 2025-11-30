/**
 * AI-related Constants
 *
 * AI model configuration, providers, defaults, and endpoints.
 */

/**
 * AI model default configuration
 */
export const AI_DEFAULTS = {
  /** Default temperature for LLM generation (0.0-2.0, higher = more creative) */
  TEMPERATURE: 0.7,
  /** Default maximum tokens for LLM responses */
  MAX_TOKENS: 4096,
  /** Temperature for vision models (lower = more deterministic) */
  VISION_TEMPERATURE: 0.3,
  /** Default language for Whisper transcription */
  WHISPER_LANGUAGE: 'en',
  /** Default memory score threshold for retrieval */
  MEMORY_SCORE_THRESHOLD: 0.15,
  /** Default number of memories to retrieve */
  MEMORY_LIMIT: 15,
  /**
   * Default context window token budget (128k tokens)
   *
   * GUIDELINE: Set contextWindowTokens to ~50% of model's advertised max for safety.
   * - 50% = Very conservative, always safe (recommended default)
   * - 75% = Generally safe for well-tested, non-reasoning models
   * - 90% = Aggressive, only if tested at that load
   *
   * Why not use 100%?
   * - Token counting (tiktoken) may differ from provider's actual counting
   * - Many models degrade in quality near their context limit ("lost in the middle")
   * - Reasoning models (o1, Claude thinking) use tokens for internal reasoning
   * - Leaves headroom for output tokens on shared-limit models
   */
  CONTEXT_WINDOW_TOKENS: 131072,
  /**
   * Time buffer (in milliseconds) to prevent STM/LTM overlap
   * Excludes LTM memories within this time window of the oldest STM message
   * 10 seconds = 10000ms
   */
  STM_LTM_BUFFER_MS: 10000,
  /**
   * Channel-scoped memory budget ratio for waterfall LTM retrieval
   * When user references channels, this fraction of the memory limit is allocated
   * to channel-scoped memories, with the remainder going to global semantic search.
   * 0.5 = 50% channel-scoped, 50% global backfill
   */
  CHANNEL_MEMORY_BUDGET_RATIO: 0.5,
  /**
   * Number of prior conversation turns to include in LTM search query
   * This solves the "pronoun problem" where users say "what about that?" -
   * without recent context, LTM can't find relevant memories.
   * 3 turns = 6 messages (3 user + 3 assistant)
   */
  LTM_SEARCH_HISTORY_TURNS: 3,
  /**
   * Max characters per message in LTM search history window
   * Larger than LOG_PREVIEW (150) to preserve semantic context for search.
   * 500 chars ≈ 125 tokens, so 6 messages ≈ 750 tokens (well under embedding limit)
   */
  LTM_SEARCH_MESSAGE_PREVIEW: 500,
} as const;

/**
 * AI Provider API endpoints
 */
export const AI_ENDPOINTS = {
  /** OpenRouter API base URL */
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  /** OpenRouter model card base URL (for model info links) */
  OPENROUTER_MODEL_CARD_URL: 'https://openrouter.ai',
} as const;

/**
 * Centralized Model Configuration
 *
 * Single source of truth for all AI model defaults.
 * This prevents inconsistencies across services and makes it easy to change defaults.
 */
export const MODEL_DEFAULTS = {
  // Main generation model (used when no model specified)
  DEFAULT_MODEL: 'anthropic/claude-haiku-4.5',

  // Specialized models
  WHISPER: 'whisper-1',
  /** Vision fallback for BYOK users (paid) */
  VISION_FALLBACK: 'qwen/qwen3-vl-235b-a22b-instruct',
  /** Vision fallback for free tier users (no BYOK) */
  VISION_FALLBACK_FREE: 'google/gemma-3-27b-it:free',
  EMBEDDING: 'text-embedding-3-small',
} as const;

/**
 * Model name type derived from defaults
 */
export type DefaultModelName = (typeof MODEL_DEFAULTS)[keyof typeof MODEL_DEFAULTS];

/**
 * AI provider identifiers
 */
export enum AIProvider {
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
}

/**
 * Free Model Guest Mode Configuration
 *
 * Used when a user has no BYOK API key and the system fallback is unavailable.
 * Guest users are restricted to free-tier models only.
 */
export const GUEST_MODE = {
  /**
   * Default free model for guest users
   * Grok 4.1 Fast: 2M context window, vision support, excellent for conversational AI
   */
  DEFAULT_MODEL: 'x-ai/grok-4.1-fast:free',

  /**
   * Alternative free models (for failover or user choice)
   * Ordered by preference for chat/roleplay use cases
   */
  FREE_MODELS: [
    'x-ai/grok-4.1-fast:free', // 2M context, vision support
    'nvidia/nemotron-nano-12b-v2-vl:free', // 128k context, vision support
    'tngtech/tng-r1t-chimera:free', // 164k context, creative storytelling
  ] as const,

  /**
   * Free model suffix used by OpenRouter
   * Models ending with this suffix are free to use
   */
  FREE_MODEL_SUFFIX: ':free',

  /**
   * Message footer for guest mode responses
   */
  FOOTER_MESSAGE: '🆓 Using free model (no API key required)',
} as const;

/**
 * Check if a model ID is a free model
 * Free models on OpenRouter end with ':free'
 *
 * @param modelId - The model ID to check (e.g., 'x-ai/grok-4.1-fast:free')
 * @returns true if the model is free
 */
export function isFreeModel(modelId: string): boolean {
  return modelId.endsWith(GUEST_MODE.FREE_MODEL_SUFFIX);
}
