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
   * Maximum fraction of context window to allocate for memories
   *
   * When memories would exceed this budget, lowest-relevance memories are dropped.
   * This prevents huge memories (e.g., pasted conversation logs) from consuming
   * the entire context window and leaving no room for conversation history.
   *
   * 0.25 = 25% of context window (~32k tokens of 128k)
   *
   * Why 25%?
   * - Leaves ~75% for: system prompt (~5-10k), current message (~1-5k), history (~50-60k)
   * - 32k tokens is enormous (~150 pages of text) - if AI needs more background, query is too broad
   * - Chosen based on production incident where 77% memory usage left no room for history
   * - Conversation history (recency) is often more valuable than LTM (semantic)
   */
  MEMORY_TOKEN_BUDGET_RATIO: 0.25,
  /**
   * Safety margin fraction reserved for response generation
   *
   * When calculating available context budget, this fraction is reserved to ensure
   * there's room for the model's response tokens.
   *
   * 0.05 = 5% of context window (~6.4k tokens of 128k)
   */
  RESPONSE_SAFETY_MARGIN_RATIO: 0.05,
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
  /**
   * In-memory cache TTL for model capability lookups (5 minutes)
   * Model capabilities rarely change, so longer TTL reduces Redis calls.
   * Short enough to pick up OpenRouter model updates within a session.
   */
  MODEL_CAPABILITY_CACHE_TTL_MS: 5 * 60 * 1000,
  /**
   * Maximum tokens for embedding input (text-embedding-3-small limit is 8191)
   * This is a hard limit from OpenAI's embedding API.
   */
  EMBEDDING_MAX_TOKENS: 8191,
  /**
   * Safe token limit for memory chunking (leaves headroom below EMBEDDING_MAX_TOKENS)
   * We use 7500 to leave ~700 token buffer for edge cases in token counting.
   * Memories exceeding this limit will be split into chunks.
   */
  EMBEDDING_CHUNK_LIMIT: 7500,
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
  /** Vision fallback for free tier users (no BYOK) - ~30k context window */
  VISION_FALLBACK_FREE: 'qwen/qwen-2.5-vl-7b-instruct:free',
  /**
   * Local embedding model (not configurable via env)
   * Uses @tzurot/embeddings package with 384-dimensional vectors.
   * Replaces OpenAI's text-embedding-3-small (1536 dims) for cost savings.
   */
  EMBEDDING: 'Xenova/bge-small-en-v1.5',
} as const;

/**
 * Model name type derived from defaults
 */
export type DefaultModelName = (typeof MODEL_DEFAULTS)[keyof typeof MODEL_DEFAULTS];

/**
 * AI provider identifiers
 *
 * Note: Only OpenRouter is supported for user-facing BYOK. The system still uses
 * OPENAI_API_KEY internally for embeddings and Whisper transcription, but users
 * cannot select OpenAI as a provider for chat/generation.
 */
export enum AIProvider {
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
   * Gemma 3 27B: 96k context window, excellent for conversational AI
   */
  DEFAULT_MODEL: 'google/gemma-3-27b-it:free',

  /**
   * Alternative free models (for failover or user choice)
   * Ordered by preference for chat/roleplay use cases
   */
  FREE_MODELS: [
    'google/gemma-3-27b-it:free', // 96k context, balanced quality/speed
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
