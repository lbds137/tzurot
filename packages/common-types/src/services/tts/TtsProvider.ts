/**
 * TtsProvider — Generic interface for TTS providers
 *
 * The TTS Engine Upgrade abstraction. Each concrete provider
 * (`SelfHostedTtsProvider`, `ElevenLabsTtsProvider`, `MistralTtsProvider`)
 * implements this interface; the `TtsDispatcher` walks a fallback chain of
 * providers determined by `TtsConfigResolver`.
 *
 * Design notes (from three-council reconciled review):
 *
 *   - **`PreparedTts` is opaque + branded** — discriminated union unifies
 *     stateful (voice-id) and stateless (inline-audio) providers under one
 *     handle type. Without this, the dispatcher ends up with
 *     `if (provider instanceof X)` branches that destroy the abstraction.
 *
 *   - **`capabilities` object** — dispatcher dispatches on `requiresPrepare`
 *     (skip eager prepare for stateless providers, do it for cloning).
 *     Without this, dispatcher hardcodes provider-specific knowledge.
 *
 *   - **`isAvailable(ctx)` predicate** — clean provider gating without
 *     auth-error-catch at synthesize time.
 *
 *   - **No `Symbol.asyncDispose`** — no current provider needs cleanup;
 *     `await using` would tax every call site for hypothetical future
 *     benefit. Optional `dispose?()` method is non-breaking to add later.
 *
 *   - **Buffer return type, not streaming** — add separate `synthesizeStream()`
 *     method later if Discord ever supports streaming voice uploads.
 */

// Forward reference; subclass returns will conform once ResolvedTtsConfig exists.
// Using a placeholder type here keeps this file self-contained.
export interface ResolvedTtsConfig {
  provider: TtsProviderId;
  modelId: string | null;
  advancedParameters: TtsAdvancedParams;
  source: 'user-personality' | 'user-default' | 'personality' | 'free-default' | 'hardcoded';
  configName?: string;
}

/** Provider-specific knobs. Opaque to the dispatcher; validated per-provider. */
export type TtsAdvancedParams = Record<string, unknown>;

/**
 * Stable provider id strings — persisted to DB in `tts_configs.provider`.
 * Single source of truth: the type, the runtime guard, and any Zod
 * validators all derive from this tuple, so adding a new provider is a
 * one-line change here.
 */
export const TTS_PROVIDER_IDS = ['self-hosted', 'elevenlabs', 'mistral'] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

/** Type guard for runtime narrowing of DB-sourced provider strings. */
export function isTtsProviderId(value: string): value is TtsProviderId {
  return (TTS_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * True when the provider runs self-hosted (no per-user API key needed).
 *
 * Accepts arbitrary `string` so call sites can use it directly on DB-sourced
 * values without a prior `isTtsProviderId` narrowing step. Use this at call
 * sites instead of comparing to the literal `'self-hosted'` — semantic intent
 * ("is this self-hosted?") survives if a second self-hosted variant is ever
 * added; literal comparisons would silently fail on the new variant.
 */
export function isSelfHostedTtsProvider(value: string): boolean {
  return value === 'self-hosted';
}

/**
 * Static introspection of what a provider supports.
 *
 * The dispatcher uses these to make routing decisions WITHOUT inspecting
 * provider class types — keeps the dispatcher clean of provider-specific
 * conditionals.
 */
export interface TtsCapabilities {
  /** Maximum text length per synthesis call. Provider should chunk longer inputs. */
  maxCharacters: number;
  /**
   * Whether `prepare()` does meaningful work (clone voice, fetch reference,
   * cache lookup). False for stateless providers that pack reference audio
   * into every `synthesize()` request.
   */
  requiresPrepare: boolean;
  /** Whether the provider supports zero-shot voice cloning from reference audio. */
  supportsReferenceAudio: boolean;
  /**
   * Output audio format the provider returns. Output-side normalization in
   * TTSStep handles cross-provider format/loudness harmonization.
   */
  outputFormat: 'mp3' | 'wav' | 'pcm' | 'opus';
}

/**
 * Per-call context for TTS operations. Passed through `prepare()` and
 * `synthesize()` so providers can resolve auth, voice references, etc.
 */
export interface TtsContext {
  /**
   * Personality slug — always required. Acts as cache key (in-memory provider
   * caches) AND as the lookup handle for the gateway's voice-references endpoint.
   */
  slug: string;
  /**
   * BYOK API key if the provider needs it (ElevenLabs, Mistral). Undefined
   * for self-hosted (which uses VOICE_ENGINE_URL infra config instead).
   */
  byokKey?: string;
  /** Optional model override from the resolved tts_config row. */
  modelId?: string;
  /**
   * Cooperative-cancellation signal from the caller's outer time budget
   * (TTSStep's 300s race). Checked between chunk batches (self-hosted
   * chunker) and between fallback-chain attempts (dispatcher) so that work
   * whose result is already discarded stops dispatching NEW requests — the
   * voice-engine's 2-slot inference semaphore is shared with STT, and a
   * post-timeout fallback attempt would spend BYOK quota for nothing.
   * In-flight HTTP requests are deliberately NOT aborted: server-side
   * inference runs in an executor thread a socket close cannot interrupt,
   * so aborting them frees nothing.
   */
  signal?: AbortSignal;
}

/**
 * Opaque, branded handle returned by `prepare()`. Discriminated union
 * unifies stateful (voice-id) and stateless (inline-audio) providers
 * under one interface.
 *
 * The `_brand` field prevents accidental construction outside the provider —
 * callers receive an opaque token they can only pass back to `synthesize()`.
 */
export type PreparedTts =
  | { _brand: 'prepared'; kind: 'voiceId'; id: string; provider: TtsProviderId }
  | {
      _brand: 'prepared';
      kind: 'inlineAudio';
      buffer: Buffer;
      mimeType: string;
      provider: TtsProviderId;
    };

/**
 * Construct a stateful (voice-id) PreparedTts handle. Provider-internal use only.
 * Callers receive `PreparedTts` and pass it back opaquely.
 */
export function buildPreparedVoiceId(provider: TtsProviderId, id: string): PreparedTts {
  return { _brand: 'prepared', kind: 'voiceId', id, provider };
}

/**
 * Construct a stateless (inline-audio) PreparedTts handle. Provider-internal use only.
 */
export function buildPreparedInlineAudio(
  provider: TtsProviderId,
  buffer: Buffer,
  mimeType: string
): PreparedTts {
  return { _brand: 'prepared', kind: 'inlineAudio', buffer, mimeType, provider };
}

/**
 * The TTS provider contract.
 *
 * Implementations live in `services/ai-worker/src/services/voice/providers/`
 * and are wired into the dispatcher via the provider registry.
 */
export interface TtsProvider {
  /** Stable provider id (matches the DB-persisted `tts_configs.provider` string). */
  readonly id: TtsProviderId;
  /** Human-readable name for logs / settings UX. */
  readonly displayName: string;
  /** Static capabilities the dispatcher inspects for routing decisions. */
  readonly capabilities: TtsCapabilities;

  /**
   * Cheap predicate: are this provider's prerequisites available right now?
   *
   * Examples: ElevenLabs and Mistral require `byokKey` to be set.
   * Self-hosted requires `VOICE_ENGINE_URL` env config.
   *
   * The dispatcher uses this to skip providers cleanly without catching
   * an auth error at `synthesize()` time. Should NOT do I/O.
   */
  isAvailable(ctx: TtsContext): boolean;

  /**
   * Cheap predicate: can this provider handle the resolved config + context?
   *
   * Distinct from `isAvailable`: `canHandle` checks compatibility (e.g.,
   * the resolved config asked for a model this provider doesn't support);
   * `isAvailable` checks prerequisites (key set, infra reachable).
   */
  canHandle(config: ResolvedTtsConfig, ctx: TtsContext): boolean;

  /**
   * Lifecycle: ensure prerequisites (voice cloned/registered, warmup).
   * May be slow on first call. Returns an opaque handle.
   *
   * Stateless providers (e.g., a future provider that passes reference audio
   * inline per-call) return a `kind: 'inlineAudio'` handle. Stateful providers
   * (ElevenLabs, Mistral) return `kind: 'voiceId'`.
   *
   * Resolver-level cache deduplicates repeated `prepare()` calls for the same
   * provider+slug.
   */
  prepare(ctx: TtsContext): Promise<PreparedTts>;

  /**
   * Synthesize text using a prepared handle. Returns audio buffer in the
   * provider's `capabilities.outputFormat`. Long text is the provider's
   * responsibility (chunking handled internally OR delegated to a shared
   * chunker if the provider has a hard character cap).
   *
   * The `ctx` is passed through alongside the handle so providers that
   * need auth at synthesize time (ElevenLabs, Mistral — both consume
   * `ctx.byokKey` and `ctx.modelId`) can read it without us baking
   * provider-specific fields into the opaque handle. Stateless providers
   * that don't need ctx ignore it.
   *
   * Errors should be thrown as `TtsProviderError` with appropriate
   * `category` and `isFallbackEligible` so the dispatcher can route fallback
   * decisions correctly.
   */
  synthesize(text: string, handle: PreparedTts, ctx: TtsContext): Promise<Buffer>;

  /**
   * Optional cleanup hook called by the dispatcher when a handle is no longer
   * needed. Most providers have no per-handle resource to release (cloned
   * voices persist in the provider account; self-hosted slugs stay registered).
   * Reserved for future providers with WebSocket / temp-file lifecycle needs.
   */
  dispose?(handle: PreparedTts): Promise<void>;
}

// `TtsProviderError` is exported from its own module to avoid a circular
// import. Consumers wanting both types should import:
//   import type { TtsProvider } from '.../tts/TtsProvider.js';
//   import { TtsProviderError } from '.../tts/TtsProviderError.js';
