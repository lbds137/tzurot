/**
 * AI-related Constants
 *
 * AI model configuration, providers, defaults, and endpoints.
 */

import type { ModelCapabilities } from '../types/ai.js';

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
   * Memory floor under history contention, as a ratio of the shared
   * memory+history space. When fetched history alone would consume that
   * space, memories keep this floor and history absorbs the squeeze —
   * recency yields to identity at the margin (persona identity lives in
   * long-term memories; history is truncated downstream anyway).
   */
  MEMORY_CONTENTION_FLOOR_RATIO: 0.1,
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
   * The effective budget is automatically capped against the model's real
   * context length at both config-save time (gateway validation) and
   * generation time (worker runtime clamp) — see utils/contextWindowCap.ts
   * for the formula and the rationale (output headroom + tokenizer mismatch).
   * Operators don't need to derate this value manually.
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
  /**
   * Mistral API base URL — Voxtral TTS + STT live under `/v1/audio/*`.
   * Same key authorizes voice cloning, speech synthesis, and transcription;
   * see `audioProviderKeys` map shape in `ResolvedAuth`.
   */
  MISTRAL_BASE_URL: 'https://api.mistral.ai/v1',
} as const;

/** Primary free multimodal model — shared between vision fallback and guest mode */
const FREE_MULTIMODAL_MODEL = 'google/gemma-4-31b-it:free';

/**
 * OpenRouter's free-model router — a meta-model that routes to an available free
 * model. It is free to use, but its ID does NOT carry the `:free` suffix, so
 * `isFreeModel` must recognize it explicitly (otherwise it's wrongly excluded
 * from free-tier defaults, guest-mode eligibility, and free-model badges).
 */
export const FREE_ROUTER_MODEL = 'openrouter/free';

/**
 * OpenRouter's paid auto-router — a meta-model that routes each request to an
 * available model chosen by OpenRouter. Maximally resilient against
 * single-model deprecation/outage, which is why it seeds the paid fallback
 * floors (`fallbackTextModel`/`fallbackVisionModel`); the accepted trade is
 * per-request model variance and routed-cost unpredictability.
 */
export const AUTO_ROUTER_MODEL = 'openrouter/auto';

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
  /**
   * Vision fallback for free-tier users (no BYOK) — the dynamic free-model router
   * (vision-capable per OpenRouter's catalog), so it survives individual free
   * models being rate-limited or rotated out rather than pinning one model.
   */
  VISION_FALLBACK_FREE: FREE_ROUTER_MODEL,
  /**
   * Fixed cheap system model for async fact extraction (memory Phase 2).
   * NEVER the personality's model — extraction cost must stay decoupled from
   * user-facing model choice. Runs on the system OpenRouter key with
   * response_format json_object, like the vision fallback.
   */
  FACT_EXTRACTION: 'anthropic/claude-haiku-4.5',

  /**
   * Local embedding model (not configurable via env)
   * Uses @tzurot/embeddings package with 384-dimensional vectors.
   * Replaces OpenAI's text-embedding-3-small (1536 dims) for cost savings.
   */
  EMBEDDING: 'Xenova/bge-small-en-v1.5',
} as const;

/**
 * Model-slot selector: which of a target's two model assignments an operation
 * addresses. Personalities, user defaults, and the admin global/free defaults each
 * carry a text-model slot and a vision-model slot (separate FK columns / pointer
 * columns); the slot is always the CALLER's choice on the request, never a property
 * of the config row — any preset can occupy either slot, gated only by model
 * capability at assignment time (`ensureVisionCapableModel`).
 *
 * Single source of truth for the wire `?slot=` query param, the slash-command
 * `slot` choices, and every switch on a `ModelSlot`.
 */
export const MODEL_SLOTS = ['text', 'vision'] as const;
export type ModelSlot = (typeof MODEL_SLOTS)[number];

/**
 * Max length for an LlmConfig/TtsConfig `name`. Single source for the `.max()` in
 * both config schemas AND the promote-normalization util, so they can't drift.
 * Lives here with the other config-domain constants (`MODEL_SLOTS` etc.).
 */
export const CONFIG_NAME_MAX_LENGTH = 100;

/** Default slot when an operation doesn't specify one — the text (chat) slot. */
export const DEFAULT_MODEL_SLOT: ModelSlot = 'text';

/**
 * Narrow a string (e.g. a slash-command option value) to a {@link ModelSlot}.
 * Option choices are compile-time constrained to the slot values, so this normally
 * just narrows the type; an unrecognized value floors to the default (text) slot.
 */
export function toModelSlot(value: string): ModelSlot {
  return (MODEL_SLOTS as readonly string[]).includes(value)
    ? (value as ModelSlot)
    : DEFAULT_MODEL_SLOT;
}

/**
 * Shared description for the `slot` slash-command option (Chat | Vision) across the
 * preset/settings setter commands. Single source so the user-facing label can't
 * silently diverge between `/preset` and `/settings preset`. The option NAME +
 * required flag stay inline at each call site because the command-types codegen
 * reads them as string literals (it does not read the description). The encoded
 * choice values stay `text`/`vision` (the gateway's `?slot=` wire contract); only
 * the user-facing labels are Chat/Vision.
 */
export const CONFIG_SLOT_OPTION_DESCRIPTION = 'Which slot to target: Chat (default) or Vision';

/**
 * Voice naming prefix for Tzurot-managed clones across all TTS providers.
 *
 * Cross-service contract: both ai-worker (clone creation) and api-gateway
 * (voice management routes) must agree on the prefix used to identify
 * Tzurot-cloned voices in a user's provider account. Both providers store
 * cloned voices as `tzurot-{personality_slug}`.
 */
export const TTS_VOICE_NAME_PREFIX = 'tzurot-';

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
 * (`api.z.ai/api/coding/paas/v4`). Single source of truth for three things:
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
 *    link there instead.
 *
 * 3. **Context length** — `getZaiCodingPlanContextLength()` reads the
 *    `contextLength` for the context-window cap. This is load-bearing: when a
 *    request routes to z.ai-direct (the user has a z.ai key + the model is
 *    promoted), the model runs on z.ai, so its real limit is z.ai's documented
 *    one — NOT OpenRouter's, which differs (e.g. OpenRouter lists glm-5.1 at
 *    202752, but z.ai documents 200K). The catalog is also the ONLY source for
 *    z.ai-only models (`glm-5.2`, absent from OpenRouter). Keyless requests
 *    fall through to OpenRouter and are capped from the OpenRouter cache
 *    instead (gateway validation gates on the z.ai key; the runtime resolver
 *    gates on the effective provider).
 *
 *    Values are z.ai's own documented `Context Length` capability-card numbers
 *    (docs.z.ai/guides/llm/<model>), read as decimal for consistency: "200K" →
 *    200_000, "128K" → 128_000, "1M" → 1_000_000. Decimal (not binary 131_072
 *    etc.) is the right convention here — z.ai's displayed figure is itself a
 *    rounded-down label (OpenRouter's card for glm-5.1 is 202752, z.ai shows
 *    "200K"), so the decimal reading sits at or below the real served limit,
 *    which is the safe direction for a cap. glm-5/5.1/5-turbo/4.7 = 200K,
 *    glm-4.5-air = 128K, glm-5.2 = 1M. (z.ai documents 128K max output for the
 *    GLM-5 family and 5-turbo, 96K for glm-4.5-air — output headroom the cap
 *    formula reserves automatically; recorded here so the next audit has it.)
 *
 * Source of truth for membership: docs.z.ai/devpack/overview. Source of truth
 * for context lengths + docs URLs: the per-model pages under
 * docs.z.ai/guides/llm (indexed in docs.z.ai/llms.txt). Keys must stay
 * lowercase to match the case-normalized lookups; user-typed preset configs
 * may use any case so callers normalize before lookup.
 */
// `released` (ISO date) is only consumed for z.ai-EXCLUSIVE models: it becomes
// the synthetic catalog entry's `created` so `/models` can sort them by recency.
// Models that also live on OpenRouter take OpenRouter's `created` via the merge,
// so `released` is optional and only worth setting for z.ai-only entries.
// Modality flags are OPTIONAL and omitted = false (text-only). Every current
// z.ai coding-plan model is text-only, so none set them; the fields exist so a
// future z.ai vision/audio model is a one-line value change, not a schema
// change. `zaiCodingPlanModelCapabilities` reads them with `?? false`.
const ZAI_MODEL_CATALOG: Readonly<
  Record<
    string,
    {
      docsUrl: string;
      contextLength: number;
      released?: string;
      supportsVision?: boolean;
      supportsImageGeneration?: boolean;
      supportsAudioInput?: boolean;
      supportsAudioOutput?: boolean;
    }
  >
> = {
  'glm-5': { docsUrl: 'https://docs.z.ai/guides/llm/glm-5', contextLength: 200_000 },
  'glm-5.1': { docsUrl: 'https://docs.z.ai/guides/llm/glm-5.1', contextLength: 200_000 },
  // glm-5.2 is z.ai's flagship and is NOT on OpenRouter — the catalog is its
  // only source for context length AND release date (so `/models` can rank it
  // by recency). The docs URL follows z.ai's established per-model pattern.
  'glm-5.2': {
    docsUrl: 'https://docs.z.ai/guides/llm/glm-5.2',
    contextLength: 1_000_000,
    released: '2026-06-13',
  },
  'glm-5-turbo': { docsUrl: 'https://docs.z.ai/guides/llm/glm-5-turbo', contextLength: 200_000 },
  'glm-4.7': { docsUrl: 'https://docs.z.ai/guides/llm/glm-4.7', contextLength: 200_000 },
  // glm-4.5-air uses the parent family page — z.ai docs the Air variant on
  // the same page as the regular glm-4.5; no per-model URL exists.
  'glm-4.5-air': { docsUrl: 'https://docs.z.ai/guides/llm/glm-4.5', contextLength: 128_000 },
};

/**
 * Prefix that marks an OpenRouter model as belonging to the z.ai namespace
 * (e.g. `z-ai/glm-5`). Both runtime routing (`ProviderRouter`) and config
 * validation key off this prefix to decide whether a model is a z.ai
 * coding-plan candidate — the `provider` field is not present in the
 * llm-config request schemas, so the prefix is the only signal available at
 * validation time.
 */
export const ZAI_MODEL_PREFIX = 'z-ai/';

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
 * input and strips an optional `z-ai/` prefix — preset configs are user-typed
 * strings that may use any case and either the routable slug (`z-ai/glm-5`)
 * or the bare catalog form (`glm-5`), same tolerance as every other catalog
 * accessor in this file.
 */
export function isZaiCodingPlanModel(model: string): boolean {
  const lower = model.toLowerCase();
  const bare = lower.startsWith(ZAI_MODEL_PREFIX) ? lower.slice(ZAI_MODEL_PREFIX.length) : lower;
  return bare in ZAI_MODEL_CATALOG;
}

/**
 * Look up a z.ai coding-plan model's context length from the catalog, in
 * tokens. Strips an optional `z-ai/` prefix (validation and runtime both pass
 * the prefixed form `z-ai/glm-5`, while ProviderRouter promotes to the bare
 * `glm-5`) and case-normalizes before lookup. Returns `null` for any model not
 * in the catalog — callers treat that as "not a z.ai coding-plan model" and
 * fall back to their OpenRouter-based context source.
 *
 * This is the cap source for z.ai-only models (e.g. `glm-5.2`) that never
 * appear in the OpenRouter model cache: without it they'd be saved and run
 * with no context-window clamp.
 */
export function getZaiCodingPlanContextLength(model: string): number | null {
  const lower = model.toLowerCase();
  const bare = lower.startsWith(ZAI_MODEL_PREFIX) ? lower.slice(ZAI_MODEL_PREFIX.length) : lower;
  return ZAI_MODEL_CATALOG[bare]?.contextLength ?? null;
}

/** One z.ai coding-plan model with its catalog metadata. */
export interface ZaiCodingPlanModelInfo {
  /** Bare catalog key, e.g. `glm-5.2` (no `z-ai/` prefix). */
  model: string;
  docsUrl: string;
  contextLength: number;
  /** ISO release date; only set for z.ai-exclusive models (see catalog comment). */
  released?: string;
  // Modality capabilities. Each is OPTIONAL: omitted = false (text-only). Set a
  // field per-model only when a z.ai model gains that capability. Read these via
  // `zaiCodingPlanModelCapabilities()`, which normalizes undefined → false;
  // direct field access sees `undefined`, not `false`.
  /** Accepts image input (vision). Omitted = false. */
  supportsVision?: boolean;
  /** Produces image output. Omitted = false. */
  supportsImageGeneration?: boolean;
  /** Accepts audio input. Omitted = false. */
  supportsAudioInput?: boolean;
  /** Produces audio output. Omitted = false. */
  supportsAudioOutput?: boolean;
}

/**
 * Resolve a z.ai coding-plan model's modality capabilities into the unified,
 * provider-agnostic {@link ModelCapabilities} shape. Strips an optional `z-ai/`
 * prefix and case-normalizes (same lookup contract as
 * {@link getZaiCodingPlanContextLength}). Returns `null` for any model not in
 * the catalog — callers treat that as "not a z.ai coding-plan model."
 *
 * z.ai coding-plan models are text-only today, so the catalog's modality flags
 * are optional and read as `false` when omitted. A `kind='vision'` config on a
 * z.ai model therefore fails closed (no confirmed vision support) until a z.ai
 * vision model is explicitly flagged in the catalog.
 */
export function zaiCodingPlanModelCapabilities(model: string): ModelCapabilities | null {
  const lower = model.toLowerCase();
  const bare = lower.startsWith(ZAI_MODEL_PREFIX) ? lower.slice(ZAI_MODEL_PREFIX.length) : lower;
  const entry = ZAI_MODEL_CATALOG[bare];
  if (entry === undefined) {
    return null;
  }
  return {
    supportsVision: entry.supportsVision ?? false,
    supportsImageGeneration: entry.supportsImageGeneration ?? false,
    supportsAudioInput: entry.supportsAudioInput ?? false,
    supportsAudioOutput: entry.supportsAudioOutput ?? false,
    contextLength: entry.contextLength,
    source: 'zai',
  };
}

/**
 * The full z.ai coding-plan lineup, for surfaces that enumerate the catalog
 * rather than look up a single model — notably the `/models` browser, which
 * merges these into the OpenRouter list so z.ai-only models (e.g. `glm-5.2`,
 * never present in the OpenRouter cache) are still discoverable. Returns bare
 * catalog keys; prefix with `ZAI_MODEL_PREFIX` for the routable slug form.
 */
export function listZaiCodingPlanModels(): ZaiCodingPlanModelInfo[] {
  return Object.entries(ZAI_MODEL_CATALOG).map(([model, meta]) => ({ model, ...meta }));
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
    // Strip the `z-ai/` namespace prefix before the catalog lookup: the catalog
    // keys are bare (`glm-5.2`), but a prefixed `z-ai/glm-5.2` can reach here
    // (e.g. an auto-promotion fallback whose model retains the prefix). Mirrors
    // `getZaiCodingPlanContextLength`'s prefix tolerance so the docs link
    // resolves instead of falling back to the generic overview page.
    const lower = model.toLowerCase();
    const bare = lower.startsWith(ZAI_MODEL_PREFIX) ? lower.slice(ZAI_MODEL_PREFIX.length) : lower;
    return ZAI_MODEL_CATALOG[bare]?.docsUrl ?? ZAI_CODING_OVERVIEW_URL;
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
   * Mistral direct API. Authorizes both `/v1/audio/speech` (Voxtral TTS)
   * and `/v1/audio/transcriptions` (Voxtral STT). Same key for both endpoints — see
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
   * Last-resort free model for guest users when no free-default config is set
   * (AuthStep prefers a configured free default over this). The OpenRouter
   * free-model router (dynamic) rather than a single pinned model, so it survives
   * individual free models being rate-limited or rotated out — whatever free
   * models are in rotation, the router resolves one.
   */
  DEFAULT_MODEL: FREE_ROUTER_MODEL,

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
 * Check if a model ID is a free model.
 *
 * Two shapes count as free: OpenRouter models whose ID ends with ':free', and
 * the OpenRouter free-model router ('openrouter/free'), which has no suffix but
 * routes to a free model.
 *
 * @param modelId - The model ID to check (e.g., 'x-ai/grok-4.1-fast:free')
 * @returns true if the model is free
 */
export function isFreeModel(modelId: string): boolean {
  return modelId === FREE_ROUTER_MODEL || modelId.endsWith(GUEST_MODE.FREE_MODEL_SUFFIX);
}

/**
 * The ONE coding-plan model shareable with free users (the z.ai free-tier
 * piggyback): GLM-4.5-Air bills at the plan's cheapest 1x multiplier. Scope
 * is deliberately a single model — widening it is an owner decision, not a
 * config knob.
 */
export const ZAI_FREE_TIER_MODEL = 'glm-4.5-air';

/** True for the piggyback model in bare or `z-ai/`-prefixed form. */
export function isZaiFreeTierModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  const bare = lower.startsWith(ZAI_MODEL_PREFIX) ? lower.slice(ZAI_MODEL_PREFIX.length) : lower;
  return bare === ZAI_FREE_TIER_MODEL;
}

/**
 * May this model serve FREE-tier users? True OpenRouter-free models always;
 * the z.ai piggyback model too, because the guest path upgrades it to the
 * system coding-plan key when admitted and degrades to the FREE_ROUTER_MODEL
 * dynamic router otherwise — it is never billed as a paid OpenRouter model.
 * Gates the free-default preset pickers (gateway validation + autocomplete).
 */
export function isFreeTierEligibleModel(modelId: string): boolean {
  return isFreeModel(modelId) || isZaiFreeTierModel(modelId);
}

/**
 * May this model serve THIS user for free? Guests (no active key) get the
 * conditionally-free piggyback model — admission decides at runtime and a
 * denial degrades to the free router — so it presents as free to them.
 * Key-holders are billed on their own key (OpenRouter or z.ai coding plan),
 * so only literally-free models qualify. Use this for audience-facing
 * presentation (badges, counts, filters); use isFreeTierEligibleModel for
 * pure eligibility gates and isFreeModel for system-key runtime checks.
 */
export function isFreeModelForUser(modelId: string, isGuestMode: boolean): boolean {
  return isGuestMode ? isFreeTierEligibleModel(modelId) : isFreeModel(modelId);
}
