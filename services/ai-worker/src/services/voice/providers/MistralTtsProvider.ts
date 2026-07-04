/**
 * MistralTtsProvider
 *
 * `TtsProvider` adapter for Mistral's Voxtral TTS. Unlike `ElevenLabsTtsProvider`
 * which wraps the existing `ElevenLabsVoiceService`, Mistral has no legacy
 * voice service — the lifecycle (lazy-clone, cache, eviction-mutex) lives
 * directly on this class.
 *
 * Lifecycle (mirrors ElevenLabsVoiceService.ensureVoiceCloned semantics):
 *   1. Check positive cache (slug + apiKey-suffix → voiceId, 30-min TTL)
 *   2. Check negative cache (5-min TTL on failures, prevents retry storms)
 *   3. Inflight dedup — concurrent prepare() calls for same slug share one promise
 *   4. List voices via `GET /v1/audio/voices`, find by name `tzurot-${slug}`
 *   5. If not found, fetch reference audio from gateway, clone via
 *      `POST /v1/audio/voices`, cache the returned voice_id
 *   6. **Eviction mutex** serializes the list-then-clone critical section to
 *      prevent the concurrent-clone-double-write race (per three-council
 *      reconciled design)
 *
 * Mistral slot quota behavior is undocumented (smoke test didn't probe). If
 * a future MistralApiError surfaces a slot-limit error, eviction code is
 * straightforward to add (mirror ElevenLabsVoiceService.evictAndClone).
 */

import {
  buildPreparedVoiceId,
  createLogger,
  TTLCache,
  TTS_VOICE_NAME_PREFIX,
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsCapabilities,
  type TtsContext,
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types';
import {
  mistralCloneVoice,
  mistralListVoices,
  mistralTTS,
  MistralApiError,
  MistralReferenceAudioTooLongError,
  MistralVoiceListUnavailableError,
  MISTRAL_MAX_REFERENCE_AUDIO_SEC,
} from '../MistralTtsClient.js';
import { fetchVoiceReference } from '../voiceReferenceHelper.js';
import { withRetry, RetryError } from '../../../utils/retry.js';

const logger = createLogger('MistralTtsProvider');

const PROVIDER_ID: TtsProviderId = 'mistral';

/** TTL for successful clone cache entries (30 minutes — same as ElevenLabs). */
const CLONE_CACHE_TTL_MS = 30 * 60 * 1000;
/** TTL for failed clone cache entries (5 minutes). */
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
/** Max cached entries per service. */
const CACHE_MAX_SIZE = 200;

/** Static capabilities of the Mistral path. */
const MISTRAL_CAPABILITIES: TtsCapabilities = {
  // Mistral docs don't publish a hard char cap. Smoke test ran 354-char
  // synthesis without issue. Setting a generous 5000 (same as ElevenLabs)
  // keeps the dispatcher from chunking unnecessarily; if Mistral ever
  // surfaces a 400 on overlong input, a chunker can be added behind this.
  maxCharacters: 5000,
  requiresPrepare: true,
  supportsReferenceAudio: true,
  // Mistral always returns base64-wrapped WAV inside JSON; the client decodes
  // at the boundary before this layer sees the audio.
  outputFormat: 'wav',
};

interface CachedVoice {
  voiceId: string;
}

/**
 * The discriminated return shape of `mistralListVoices` — `{ voices, truncated }`.
 * Aliased so call-site code reads cleanly without repeating the inline
 * `Awaited<ReturnType<...>>` ceremony.
 */
type ListResult = Awaited<ReturnType<typeof mistralListVoices>>;

/**
 * Returns true if the error explicitly self-classifies as deterministic-from-input
 * (`isTransient === false`). Used to gate the 5-min negative cache: deterministic
 * failures don't benefit from caching because re-running with the same input
 * produces the same failure — the cache just adds 5-min delay before the same
 * error recurs.
 *
 * Errors without an `isTransient` field fall through to the "cache" default
 * (preserves old behavior for network blips, generic Error subclasses, etc.).
 */
function isDeterministicFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isTransient' in error &&
    error.isTransient === false
  );
}

export class MistralTtsProvider implements TtsProvider {
  readonly id = PROVIDER_ID;
  readonly displayName = 'Mistral Voxtral (BYOK)';
  readonly capabilities = MISTRAL_CAPABILITIES;

  private readonly cloneCache: TTLCache<CachedVoice>;
  private readonly negativeCache: TTLCache<string>;
  private readonly inflight = new Map<string, Promise<string>>();

  /**
   * Eviction mutex — serializes prepare() per-instance to prevent the
   * concurrent-clone-double-write race at the list-then-clone critical
   * section. Same pattern as ElevenLabsTtsProvider.
   */
  private evictionLock: Promise<unknown> = Promise.resolve();

  constructor() {
    this.cloneCache = new TTLCache<CachedVoice>({
      ttl: CLONE_CACHE_TTL_MS,
      maxSize: CACHE_MAX_SIZE,
    });
    this.negativeCache = new TTLCache<string>({
      ttl: NEGATIVE_CACHE_TTL_MS,
      maxSize: CACHE_MAX_SIZE,
    });
  }

  /** Cheap predicate — Mistral requires a BYOK key. No I/O. */
  isAvailable(ctx: TtsContext): boolean {
    return ctx.byokKey !== undefined && ctx.byokKey.length > 0;
  }

  canHandle(config: ResolvedTtsConfig, _ctx: TtsContext): boolean {
    return config.provider === PROVIDER_ID;
  }

  /**
   * Lazy-clone the voice for the given slug + API key. The eviction mutex
   * serializes this work per-instance.
   */
  async prepare(ctx: TtsContext): Promise<PreparedTts> {
    const { byokKey, slug } = ctx;
    if (byokKey === undefined || byokKey.length === 0) {
      throw new Error('MistralTtsProvider.prepare requires ctx.byokKey to be set');
    }
    const apiKey = byokKey;

    const next = this.evictionLock.then(() => this.ensureVoiceCloned(slug, apiKey));
    // Don't poison the chain on failure — subsequent prepare() calls should
    // still get a fresh shot.
    this.evictionLock = next.catch(() => {
      /* no-op */
    });
    const voiceId = await next;
    return buildPreparedVoiceId(PROVIDER_ID, voiceId);
  }

  /**
   * Synthesize text via Mistral. Reads byokKey + modelId from ctx — handles
   * stay opaque/provider-agnostic per the dispatcher contract.
   */
  async synthesize(text: string, handle: PreparedTts, ctx: TtsContext): Promise<Buffer> {
    if (handle.kind !== 'voiceId') {
      throw new Error(
        `MistralTtsProvider received an inlineAudio handle — expected voiceId. Got: ${handle.kind}`
      );
    }
    if (ctx.byokKey === undefined || ctx.byokKey.length === 0) {
      throw new Error('MistralTtsProvider.synthesize requires ctx.byokKey to be set');
    }
    const start = Date.now();
    let result: Awaited<ReturnType<typeof mistralTTS>>;
    try {
      result = await mistralTTS({
        text,
        voiceId: handle.id,
        apiKey: ctx.byokKey,
        modelId: ctx.modelId,
      });
    } catch (error) {
      // 404 = voice deleted server-side (Mistral dashboard, /voices DELETE,
      // account expired, etc.). The cached voiceId is dead — evict the
      // positive cache entry so the next prepare() call re-clones rather
      // than feeding the same dead id back through synthesize().
      if (error instanceof MistralApiError && error.status === 404) {
        this.invalidateVoice(ctx.slug, ctx.byokKey);
        logger.info(
          { slug: ctx.slug, voiceId: handle.id },
          'Mistral voice 404 — invalidated cache for re-clone on next prepare'
        );
      }
      throw error;
    }
    logger.info(
      {
        event: 'tts.synthesize',
        provider: PROVIDER_ID,
        // null when no explicit model resolved upstream — matches ElevenLabs +
        // SelfHosted log shape so a telemetry consumer aggregating by model
        // sees the same nullish convention everywhere. Actual model resolution
        // lives in TtsConfigResolver, not in the synthesize log line.
        model: ctx.modelId ?? null,
        charCount: text.length,
        outputBytes: result.audioBuffer.length,
        durationMs: Date.now() - start,
      },
      'TTS synthesis'
    );
    return result.audioBuffer;
  }

  /** Invalidate cached voice for slug+key (e.g., on 404 from synthesize). */
  invalidateVoice(slug: string, apiKey: string): void {
    const cacheKey = this.buildCacheKey(slug, apiKey);
    this.cloneCache.delete(cacheKey);
    this.negativeCache.delete(cacheKey);
  }

  /** @internal Test-only cache reset. */
  clearCache(): void {
    this.cloneCache.clear();
    this.negativeCache.clear();
    this.inflight.clear();
  }

  // ===== Internal lifecycle ===============================================

  private async ensureVoiceCloned(slug: string, apiKey: string): Promise<string> {
    const cacheKey = this.buildCacheKey(slug, apiKey);

    // Positive cache hit
    const cached = this.cloneCache.get(cacheKey);
    if (cached !== null) {
      return cached.voiceId;
    }

    // Negative cache hit — surface the prior failure rather than retrying
    const failReason = this.negativeCache.get(cacheKey);
    if (failReason !== null) {
      throw new Error(`Mistral voice clone for "${slug}" recently failed: ${failReason}`);
    }

    // Inflight dedup — defensive backstop only. The eviction mutex in
    // `prepare()` already serializes concurrent calls, so by the time the
    // second call's promise chain reaches here, the first has settled and
    // populated the cache (or cleared inflight via `.finally`). The check
    // is unreachable under the current call shape (`ensureVoiceCloned` is
    // private + only called from the mutex-chained path), kept in case a
    // future caller bypasses the mutex (e.g., direct test invocation).
    const existing = this.inflight.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.doEnsureCloned(slug, apiKey, cacheKey)
      .catch(error => {
        const reason = error instanceof Error ? error.message : String(error);

        // Branch ordering matters: MistralReferenceAudioTooLongError has
        // `isTransient = false`, so `isDeterministicFailure` would match it
        // too. Keep this explicit instanceof check first so the structured
        // `mistral.referenceAudioTooLong` event fires for log consumers — a
        // future refactor that moves or collapses this branch would silently
        // lose the event without breaking tests.
        if (error instanceof MistralReferenceAudioTooLongError) {
          // Deterministic from input. Skip the negative cache (it would add
          // nothing — same input will fail the same way), emit a structured
          // WARN so log consumers can route this distinct case.
          logger.warn(
            {
              event: 'mistral.referenceAudioTooLong',
              slug,
              durationSec: error.durationSec,
              limitSec: error.limitSec,
            },
            'Mistral reference audio exceeds 30s limit — skipping clone; dispatcher will attempt fallback if available'
          );
        } else if (error instanceof MistralVoiceListUnavailableError) {
          // The clone path never ran — the list endpoint failed (truncation
          // or fetch retry-exhaustion). Log message reflects the actual
          // failure mode, distinct from "voice clone failed" which would
          // misattribute. Still cache (isTransient=true) so the next 5 min
          // of prepares short-circuit instead of repeating retry storms.
          this.negativeCache.set(cacheKey, reason);
          logger.warn(
            { event: 'mistral.voiceListUnavailable', slug, listReason: error.reason, reason },
            'Mistral voice list unavailable — cached for 5 min, no clone attempted'
          );
        } else if (error instanceof MistralApiError && error.isRateLimited) {
          // Rate-limited (429) is transient but too granular for a 5-min
          // blanket cache — Mistral's retry-after header is more precise.
          logger.warn({ slug, reason }, 'Mistral voice clone rate limited (not cached)');
        } else if (isDeterministicFailure(error)) {
          // Other deterministic failures (e.g., 4xx auth, malformed audio) —
          // caching adds nothing because the same input will keep failing.
          // The absence of `negativeCache.set` is intentional: the `throw error`
          // below still rejects the caller's promise, so the failure surfaces;
          // we just don't poison the cache for the next attempt.
          logger.warn({ slug, reason }, 'Mistral voice clone failed (deterministic — not cached)');
        } else {
          // Transient (5xx, response-shape, network blips) or unknown.
          // Cache for 5 min to prevent retry storms.
          this.negativeCache.set(cacheKey, reason);
          logger.warn({ slug, reason }, 'Mistral voice clone failed — cached for 5 min');
        }
        throw error;
      })
      .finally(() => this.inflight.delete(cacheKey));

    this.inflight.set(cacheKey, promise);
    return promise;
  }

  private async doEnsureCloned(slug: string, apiKey: string, cacheKey: string): Promise<string> {
    const voiceName = `${TTS_VOICE_NAME_PREFIX}${slug}`;

    // Step 1: list voices, find by name. `mistralListVoices` walks pages up
    // to VOICE_LIST_MAX_PAGES (20 / 1000 voices) and returns a discriminated
    // result so we can tell whether the list is exhaustive or truncated.
    //
    // Two robustness layers vs. the duplicate-clone risk:
    //
    // 1. Retry transient list failures with exponential backoff. Without the
    //    retry, a single network blip → catch-and-clone → silent duplicate
    //    accumulation, every prepare call adds another `tzurot-${slug}` in
    //    the user's Mistral account.
    //
    // 2. After all retries exhaust OR the list returns truncated AND no match
    //    was found, throw `MistralVoiceListUnavailableError` rather than
    //    falling through to clone. The user sees an explicit error (cached
    //    by the negative cache for 5 min via the transient classifier) rather
    //    than a silent duplicate clone.
    let listResult: ListResult | undefined;
    let listError: unknown;
    try {
      const result = await withRetry(() => mistralListVoices(apiKey), {
        maxAttempts: 3,
        initialDelayMs: 500,
        maxDelayMs: 4000,
        operationName: `Mistral voice list (${slug})`,
        logger,
        // Don't retry deterministic failures (auth, malformed) — they won't
        // recover on retry. Reuses the same predicate the cache logic uses
        // so the two policies stay in sync.
        shouldRetry: error => !isDeterministicFailure(error),
      });
      listResult = result.value;
    } catch (error) {
      listError = error instanceof RetryError ? error.lastError : error;
      // `withRetry` wraps both retry-exhaustion AND fast-fail (errors that
      // failed `shouldRetry`) in `RetryError` — so a misleading log would
      // claim "retried" for a deterministic 401 that fast-failed at attempt 1.
      // The `attempts` count is the honest signal.
      //
      // The `: 1` fallback is defensive — `withRetry`'s current implementation
      // always throws `RetryError`, but typing the catch as `unknown` and
      // tolerating a future implementation change is cheaper than relying on
      // an invariant that lives in another module.
      const attempts = error instanceof RetryError ? error.attempts : 1;
      logger.warn(
        { err: listError, slug, attempts },
        'Mistral voice list fetch failed — refusing to clone (would risk silent duplicate)'
      );
    }

    if (listResult !== undefined) {
      const existing = listResult.voices.find(v => v.name === voiceName);
      if (existing !== undefined) {
        this.cloneCache.set(cacheKey, { voiceId: existing.id });
        logger.info({ slug, voiceId: existing.id }, 'Found existing Mistral voice');
        return existing.id;
      }
      if (listResult.truncated) {
        // Voice not found in the first VOICE_LIST_MAX_PAGES * page_size voices,
        // but there could be more on later pages. Cloning would risk a
        // duplicate. Surface a typed error rather than silently adding to
        // the duplicate count.
        throw new MistralVoiceListUnavailableError(
          'truncated',
          `${listResult.voices.length} voices listed`
        );
      }
      // Exhaustive list confirmed no match → safe to clone fresh.
    } else {
      // List failed all retries (or fast-failed on a deterministic error like
      // 401 auth). Refuse to clone — repeated list failures would otherwise
      // produce one duplicate voice per prepare call.
      //
      // Note: this reclassifies deterministic underlying errors (e.g., 401)
      // as transient via MistralVoiceListUnavailableError(isTransient=true),
      // so the negative cache will suppress them for 5 min. Trade-off
      // accepted: a debugging session for a misconfigured key sees one
      // 401-wrapped error followed by 5 min of cache hits, rather than
      // repeated 401s. Preventing duplicate-clone accumulation outweighs
      // the debug-time noise.
      throw new MistralVoiceListUnavailableError(
        'fetch-failed',
        listError instanceof Error ? listError.message : String(listError)
      );
    }

    // Step 2: fetch reference audio from api-gateway
    const { audioBuffer, contentType, durationSec } = await fetchVoiceReference(slug);

    // Step 2.5: pre-flight Mistral's 30s reference-audio limit. Cheaper to
    // reject here than to round-trip the full base64 payload to Mistral and
    // get a 400 back — and `MistralReferenceAudioTooLongError` carries
    // structured fields for diagnostic logging at the catch site. Only
    // applies when we could parse the duration; unrecognized formats fall
    // through to the reactive path (Mistral returns 400 if too long).
    if (durationSec !== undefined && durationSec > MISTRAL_MAX_REFERENCE_AUDIO_SEC) {
      throw new MistralReferenceAudioTooLongError(durationSec);
    }

    // Step 3: clone
    logger.info({ slug, audioSize: audioBuffer.length }, 'Cloning voice via Mistral');
    const cloned = await mistralCloneVoice({
      name: voiceName,
      audioBuffer,
      contentType,
      apiKey,
    });

    this.cloneCache.set(cacheKey, { voiceId: cloned.id });
    logger.info({ slug, voiceId: cloned.id }, 'Mistral voice cloned and cached');
    return cloned.id;
  }

  /** Cache key: slug + key-suffix (different users = different entries). */
  private buildCacheKey(slug: string, apiKey: string): string {
    return `${slug}:${this.getKeySuffix(apiKey)}`;
  }

  /**
   * First 4 + last 8 chars of the API key — short, unique, not the full key.
   * For keys shorter than 12 chars (test fixtures only — production Mistral
   * keys are ~32+ chars), return a sentinel rather than the full key. This
   * prevents the cache key (and any debug logs that include it) from leaking
   * a full short key if a test fixture is ever accidentally used in a
   * deployed environment. The sentinel collapses all short keys into the
   * same cache bucket — acceptable because (a) production never produces
   * sub-12-char keys, and (b) cache collisions across test-fixture-keyed
   * entries would only manifest in a misconfigured deployment.
   */
  private getKeySuffix(apiKey: string): string {
    if (apiKey.length < 12) {
      return '[short-key]';
    }
    return `${apiKey.slice(0, 4)}${apiKey.slice(-8)}`;
  }
}
