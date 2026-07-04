/**
 * ElevenLabsTtsProvider
 *
 * `TtsProvider` adapter wrapping the existing `ElevenLabsVoiceService`
 * (which handles BYOK lazy voice cloning + slot eviction). The wrapper
 * keeps the existing service's "musical chairs" eviction intact —
 * `prepare()` delegates to `ensureVoiceCloned(slug, apiKey)` and returns
 * the cloned voice's id; `synthesize()` posts to `elevenLabsTTS`.
 *
 * Adds an **eviction mutex** that serializes `prepare()` calls per-instance
 * (per the three-council reconciled design). Without it, two
 * concurrent `prepare()` calls for the SAME slug at fresh-account state
 * could both list, both not find the voice, and both POST a clone —
 * producing duplicate `tzurot-X` voices in the user's account. The mutex
 * is 5 lines of promise-chain serialization.
 *
 * The mutex is per-instance, not per-key, because the in-flight dedup map
 * inside ElevenLabsVoiceService already handles concurrent same-slug
 * requests — the mutex closes a narrower race specifically around the
 * eviction decision (list-then-clone is atomic per-instance).
 */

import {
  buildPreparedVoiceId,
  type PreparedTts,
  type ResolvedTtsConfig,
  type TtsCapabilities,
  type TtsContext,
  type TtsProvider,
} from '@tzurot/common-types/services/tts/TtsProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type ElevenLabsVoiceService } from '../ElevenLabsVoiceService.js';
import { elevenLabsTTS, ElevenLabsApiError } from '../ElevenLabsClient.js';

const logger = createLogger('ElevenLabsTtsProvider');

/** Static capabilities of the ElevenLabs path. */
const ELEVENLABS_CAPABILITIES: TtsCapabilities = {
  // ElevenLabs documents a 5,000 char cap on `eleven_multilingual_v2` and similar.
  // Large enough that callers (TTSStep) almost never chunk; if they do, they
  // can either chunk before calling synthesize() or rely on a future provider-
  // owned chunker. For now we surface the documented limit.
  maxCharacters: 5000,
  requiresPrepare: true, // ensureVoiceCloned must run first
  supportsReferenceAudio: true,
  outputFormat: 'mp3', // ElevenLabs returns MP3 by default
};

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly displayName = 'ElevenLabs (BYOK)';
  readonly capabilities = ELEVENLABS_CAPABILITIES;

  /**
   * Eviction mutex — serializes `prepare()` calls per-instance to prevent
   * the concurrent-clone-double-write race when two requests for the same
   * voice race past the in-flight dedup. Initialized to a resolved promise.
   *
   * Pattern: each `prepare()` chains its work onto the mutex, replacing
   * the chain head with `.catch(() => {})` to prevent failed preparations
   * from poisoning subsequent attempts.
   */
  private evictionLock: Promise<unknown> = Promise.resolve();

  constructor(private readonly voiceService: ElevenLabsVoiceService) {}

  /**
   * ElevenLabs requires a BYOK key to do anything. Cheap predicate — no I/O.
   */
  isAvailable(ctx: TtsContext): boolean {
    return ctx.byokKey !== undefined && ctx.byokKey.length > 0;
  }

  /**
   * Provider claim: this is the right provider when config.provider === 'elevenlabs'.
   * Per-model dimension (eleven_multilingual_v2, eleven_v3, etc.) is honored
   * by `synthesize` reading config.modelId — `canHandle` returns true for
   * any elevenlabs config regardless of model, since model selection is
   * provider-internal.
   */
  canHandle(config: ResolvedTtsConfig, _ctx: TtsContext): boolean {
    return config.provider === 'elevenlabs';
  }

  /**
   * Lazy-clone the voice for the given slug + API key. Eviction mutex
   * serializes concurrent calls to prevent double-clone races at the
   * list-then-clone critical section.
   */
  async prepare(ctx: TtsContext): Promise<PreparedTts> {
    const { byokKey, slug } = ctx;
    if (byokKey === undefined || byokKey.length === 0) {
      throw new Error('ElevenLabsTtsProvider.prepare requires ctx.byokKey to be set');
    }
    // Local const captures the narrowed type so the inner closure doesn't need
    // a `!` assertion (which the project's no-non-null-assertion rule forbids).
    const apiKey = byokKey;
    const next = this.evictionLock.then(() => this.voiceService.ensureVoiceCloned(slug, apiKey));
    // Don't poison the chain on failure — subsequent prepare() calls should
    // still get a fresh shot at cloning.
    this.evictionLock = next.catch(() => {
      /* no-op */
    });
    const voiceId = await next;
    return buildPreparedVoiceId('elevenlabs', voiceId);
  }

  /**
   * Synthesize text via the ElevenLabs HTTP client. Reads `byokKey` and
   * `modelId` from the passed `ctx` — these are threaded through the
   * dispatcher rather than baked into the opaque handle so handles stay
   * provider-agnostic.
   *
   * Throws on inlineAudio handles (ElevenLabs is a stateful provider).
   */
  async synthesize(text: string, handle: PreparedTts, ctx: TtsContext): Promise<Buffer> {
    if (handle.kind !== 'voiceId') {
      throw new Error(
        `ElevenLabsTtsProvider received an inlineAudio handle — expected voiceId. Got: ${handle.kind}`
      );
    }
    if (ctx.byokKey === undefined || ctx.byokKey.length === 0) {
      throw new Error('ElevenLabsTtsProvider.synthesize requires ctx.byokKey to be set');
    }
    const start = Date.now();
    let result: Awaited<ReturnType<typeof elevenLabsTTS>>;
    try {
      result = await elevenLabsTTS({
        text,
        voiceId: handle.id,
        apiKey: ctx.byokKey,
        modelId: ctx.modelId,
      });
    } catch (error) {
      // 404 = voice deleted server-side (ElevenLabs dashboard, /voices DELETE,
      // slot eviction by another client, etc.). The cached voiceId is dead —
      // evict the underlying ElevenLabsVoiceService positive cache entry so
      // the next prepare() call re-clones rather than feeding the same dead
      // id back through synthesize(). Note: ElevenLabsVoiceService also has
      // an internal 404-retry-clone path inside ensureVoiceCloned, but that
      // only catches the failure if it surfaces during prepare() — synthesize()
      // 404s otherwise leak past it.
      if (error instanceof ElevenLabsApiError && error.status === 404) {
        this.voiceService.invalidateVoice(ctx.slug, ctx.byokKey);
        logger.info(
          { slug: ctx.slug, voiceId: handle.id },
          'ElevenLabs voice 404 — invalidated cache for re-clone on next prepare'
        );
      }
      throw error;
    }
    logger.info(
      {
        event: 'tts.synthesize',
        provider: 'elevenlabs',
        model: ctx.modelId ?? null,
        charCount: text.length,
        outputBytes: result.audioBuffer.length,
        durationMs: Date.now() - start,
      },
      'TTS synthesis'
    );
    return result.audioBuffer;
  }
}
