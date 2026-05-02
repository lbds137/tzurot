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
  /**
   * Max tokens scaling for reasoning models by effort level.
   *
   * Reasoning models (o1, Claude 3.7+, DeepSeek R1, Kimi K2, etc.) generate
   * extended thinking content that can easily exceed the standard 4096 token limit.
   * These scaled limits ensure thinking isn't truncated.
   *
   * Effort levels map to OpenRouter's reasoning.effort parameter:
   * - xhigh: Maximum reasoning depth, allocate generous token budget
   * - high: Deep reasoning, substantial token budget
   * - medium: Balanced reasoning, moderate token budget
   * - low: Light reasoning, still needs more than standard
   * - minimal: Minimal reasoning, slight increase over standard
   * - none: Reasoning disabled, use standard limit
   *
   * These are only applied when:
   * 1. Model is detected as a reasoning model (isReasoningModel)
   * 2. User hasn't explicitly set maxTokens (user override wins)
   *
   * @see https://openrouter.ai/docs/parameters#reasoning-effort
   */
  REASONING_MODEL_MAX_TOKENS: {
    // Scaling: base (4096) * multiplier
    // Based on observed thinking token usage from DeepSeek R1/o1 models:
    // - Extended thinking can use 10k-30k tokens before response
    // - Higher effort = more thinking = more output capacity needed
    xhigh: 65536, // 16x - Maximum reasoning depth
    high: 32768, // 8x - Deep reasoning
    medium: 16384, // 4x - Balanced (MCP council recommended)
    low: 8192, // 2x - Light reasoning
    minimal: 6144, // 1.5x - Minimal reasoning
    none: 4096, // 1x - Reasoning disabled, standard limit
  } as const,
  /** Temperature for vision models (lower = more deterministic) */
  VISION_TEMPERATURE: 0.3,
  /** Default memory score threshold for retrieval (0.0-1.0, higher = stricter matching) */
  MEMORY_SCORE_THRESHOLD: 0.5,
  /** Default number of memories to retrieve */
  MEMORY_LIMIT: 20,
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
  /** ElevenLabs API base URL (voice synthesis/cloning) */
  ELEVENLABS_BASE_URL: 'https://api.elevenlabs.io/v1',
  /**
   * z.ai Coding Plan API base URL — distinct from pay-as-you-go (`/api/paas/v4`).
   * Subscription-tier endpoint that draws from the user's monthly quota instead
   * of per-token billing. See https://z.ai/subscribe for plan details.
   */
  ZAI_CODING_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
} as const;

/** Primary free multimodal model — shared between vision fallback and guest mode */
const FREE_MULTIMODAL_MODEL = 'google/gemma-3-27b-it:free';

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
  /** Vision fallback for BYOK users (paid) — natively multimodal */
  VISION_FALLBACK: 'qwen/qwen3.5-397b-a17b',
  /** Vision fallback for free tier users (no BYOK) — 131k context, multimodal */
  VISION_FALLBACK_FREE: FREE_MULTIMODAL_MODEL,
  /**
   * Local embedding model (not configurable via env)
   * Uses @tzurot/embeddings package with 384-dimensional vectors.
   * Replaces OpenAI's text-embedding-3-small (1536 dims) for cost savings.
   */
  EMBEDDING: 'Xenova/bge-small-en-v1.5',
} as const;

/**
 * ElevenLabs voice cloning constants
 *
 * Cross-service contract: both ai-worker (clone creation) and api-gateway
 * (voice management routes) must agree on the prefix used to identify
 * Tzurot-cloned voices in a user's ElevenLabs account.
 */
export const ELEVENLABS_VOICE_NAME_PREFIX = 'tzurot-';

/**
 * Smallest model in z.ai's coding-plan model catalog — used as the probe
 * model when validating z.ai-coding API keys (minimal latency, single-token
 * response budget). Kept in one place so api-gateway and ai-worker validators
 * stay synchronized when z.ai's catalog changes.
 *
 * Per z.ai's GLM Coding Plan documentation (docs.z.ai/devpack/overview),
 * available models are GLM-5.1, GLM-5-Turbo, GLM-4.7, and GLM-4.5-Air.
 * GLM-4.5-Air is the Haiku-equivalent tier with 1× quota multiplier — the
 * cheapest probe option.
 */
export const ZAI_VALIDATION_MODEL = 'glm-4.5-air';

/**
 * Catalog of models served by z.ai's GLM Coding Plan endpoint
 * (`api.z.ai/api/coding/paas/v4`). Single source of truth for two things:
 *
 * 1. **Membership** — `isZaiCodingPlanModel()` checks if a model exists on
 *    the plan. Used by `ProviderRouter` as a guardrail before auto-promoting
 *    an OpenRouter `z-ai/<model>` request to z.ai-direct: if the bare model
 *    isn't here, promotion would 404, so the request stays on OpenRouter.
 *
 * 2. **Model docs URL** — `buildModelInfoUrl()` (z.ai branch) reads the
 *    `docsUrl` for the response footer link. Most models have a dedicated
 *    docs page at `docs.z.ai/guides/llm/<model>`; `glm-4.5-air` is the
 *    exception — z.ai docs that variant on the parent `glm-4.5` page, so we
 *    link there instead. (Confirmed 2026-04-28 via z.ai docs check.)
 *
 * Source of truth for membership: docs.z.ai/devpack/overview. Source of
 * truth for docs URLs: docs.z.ai/llms.txt. Keys must stay lowercase to
 * match the case-normalized lookups; user-typed preset configs may use any
 * case so callers normalize before lookup.
 */
const ZAI_MODEL_CATALOG: Readonly<Record<string, { docsUrl: string }>> = {
  'glm-5.1': { docsUrl: 'https://docs.z.ai/guides/llm/glm-5.1' },
  'glm-5-turbo': { docsUrl: 'https://docs.z.ai/guides/llm/glm-5-turbo' },
  'glm-4.7': { docsUrl: 'https://docs.z.ai/guides/llm/glm-4.7' },
  // glm-4.5-air uses the parent family page — z.ai docs the Air variant on
  // the same page as the regular glm-4.5; no per-model URL exists.
  'glm-4.5-air': { docsUrl: 'https://docs.z.ai/guides/llm/glm-4.5' },
};

/**
 * Fallback URL for z.ai-coding requests where the model name isn't in the
 * catalog (defensive — should never fire for promoted routes since promotion
 * itself requires catalog membership, but covers ConversationalRAGService
 * receiving a stale/manual `provider: 'zai-coding'` config). Points to the
 * coding-plan overview page so the user at least lands somewhere meaningful.
 */
const ZAI_CODING_OVERVIEW_URL = 'https://docs.z.ai/devpack/overview';

/**
 * Membership check for the z.ai coding-plan catalog. Case-normalizes the
 * input — preset configs are user-typed strings and may use any case.
 */
export function isZaiCodingPlanModel(model: string): boolean {
  return model.toLowerCase() in ZAI_MODEL_CATALOG;
}

/**
 * Build a model-info URL for the response footer based on which provider
 * was actually used. For z.ai-coding direct routes, link to z.ai's docs
 * page for the model (or the parent family page when no per-model page
 * exists, e.g., glm-4.5-air); for OpenRouter (including z.ai fallthrough
 * where ProviderRouter rewrote the model to `z-ai/<model>`), link to
 * OpenRouter's model card page.
 *
 * `provider` is the *effective* provider — i.e., the one that actually
 * served the request, post-ProviderRouter — which is the value plumbed
 * through `LLMGenerationResponse.metadata.providerUsed`.
 */
export function buildModelInfoUrl(model: string, provider: string | undefined): string {
  // Compare against the enum constant rather than the bare string so future
  // renames break at compile time. AIProvider is declared further down in this
  // module; the forward reference is safe because regular TypeScript enums
  // compile to a hoisted `var` plus an IIFE initializer that runs during
  // module evaluation — by the time any consumer calls this function, the
  // enum is fully populated.
  if (provider === AIProvider.ZaiCoding) {
    return ZAI_MODEL_CATALOG[model.toLowerCase()]?.docsUrl ?? ZAI_CODING_OVERVIEW_URL;
  }
  // OpenRouter (and any unknown provider — falls through to OpenRouter as
  // the historical default; ElevenLabs is voice-only and never hits this
  // path because the model footer is built from LLM responses).
  //
  // Encode each path segment individually so that `/` between namespace and
  // model name (e.g. `z-ai/glm-5.1`, `anthropic/claude-sonnet-4`) stays a
  // literal `/` — OpenRouter's path-based routing rejects %2F. Segment-internal
  // unsafe characters (spaces, brackets, etc.) still get escaped via
  // `encodeOpenRouterPathSegment`, which also handles `.`/`..` traversal
  // segments that `encodeURIComponent` would otherwise leave intact (per
  // `00-critical.md` SSRF defense-in-depth rule).
  const safePath = model.split('/').map(encodeOpenRouterPathSegment).join('/');
  return `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${safePath}`;
}

/**
 * Encode a single segment of an OpenRouter model URL path. Wraps
 * `encodeURIComponent` with explicit handling for `.` and `..` segments —
 * `encodeURIComponent('..')` returns `..` unchanged because dot is a URL-safe
 * character, but a literal `..` segment in a path is a traversal vector. We
 * escape the dots to `%2E%2E` so the URL can't be interpreted as climbing
 * the path hierarchy.
 */
function encodeOpenRouterPathSegment(segment: string): string {
  if (segment === '.' || segment === '..') {
    return segment.replace(/\./g, '%2E');
  }
  return encodeURIComponent(segment);
}

/**
 * AI provider identifiers
 *
 * OpenRouter: LLM chat/generation (BYOK for model access)
 * ElevenLabs: Voice synthesis, cloning, and STT (BYOK for premium features)
 * ZaiCoding: z.ai Coding Plan subscription endpoint for GLM models (BYOK)
 */
export enum AIProvider {
  OpenRouter = 'openrouter',
  ElevenLabs = 'elevenlabs',
  ZaiCoding = 'zai-coding',
  /**
   * Mistral direct API. Authorizes both `/v1/audio/speech` (Voxtral TTS, used
   * in TTS Engine Upgrade Phase 1) and `/v1/audio/transcriptions` (Voxtral
   * STT, used in Phase 3). Same key for both endpoints — see
   * `audioProviderKeys` map shape in `ResolvedAuth`.
   */
  Mistral = 'mistral',
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
   * Gemma 3 27B: 131k context window, multimodal, excellent for conversational AI
   */
  DEFAULT_MODEL: FREE_MULTIMODAL_MODEL,

  /**
   * Alternative free models (for failover or user choice)
   * Ordered by preference for chat/roleplay use cases.
   * Verified against OpenRouter /api/v1/models (2026-04-04).
   */
  FREE_MODELS: [
    FREE_MULTIMODAL_MODEL, // 131k context, multimodal, balanced quality/speed
    'nvidia/nemotron-nano-12b-v2-vl:free', // 128k context, vision+video
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
