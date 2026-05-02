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
 *      reconciled design 2026-05-01)
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
} from '../MistralTtsClient.js';
import { fetchVoiceReference } from '../voiceReferenceHelper.js';

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
        // Rate limit (429) is transient — don't poison the negative cache
        if (error instanceof MistralApiError && error.isRateLimited) {
          logger.warn({ slug, reason }, 'Mistral voice clone rate limited (not cached)');
        } else {
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

    // Step 1: list voices, find by name. Single-page assumption per the
    // backlog item — total_pages > 1 logs a warning inside mistralListVoices
    // but still returns just page 1's items.
    try {
      const voices = await mistralListVoices(apiKey);
      const existing = voices.find(v => v.name === voiceName);
      if (existing !== undefined) {
        this.cloneCache.set(cacheKey, { voiceId: existing.id });
        logger.info({ slug, voiceId: existing.id }, 'Found existing Mistral voice');
        return existing.id;
      }
    } catch (error) {
      // List failures don't block the clone path — we'll just produce a new
      // voice. Eventually-consistent dedup if the listing was stale.
      logger.warn({ err: error, slug }, 'Failed to list Mistral voices, attempting clone');
    }

    // Step 2: fetch reference audio from api-gateway
    const { audioBuffer, contentType } = await fetchVoiceReference(slug);

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
   * keys are ~32+ chars), use the full key as the suffix to avoid the two
   * slices overlapping and double-counting middle characters.
   */
  private getKeySuffix(apiKey: string): string {
    if (apiKey.length < 12) {
      return apiKey;
    }
    return `${apiKey.slice(0, 4)}${apiKey.slice(-8)}`;
  }
}
