/**
 * TTS Step
 *
 * Post-generation step that synthesizes the AI response into audio.
 * Non-critical: errors are caught and logged, text response is still delivered.
 *
 * Prerequisites checked before synthesis:
 * - Generation succeeded (result.success === true)
 * - Personality has voice enabled (voiceEnabled === true)
 * - Config cascade allows TTS (voiceResponseMode !== 'never')
 * - If voiceResponseMode === 'voice-only', the trigger was a voice message
 *
 * The actual provider selection + fallback walk lives in `TtsDispatcher`,
 * which reads `ResolvedTtsConfig` (from `TtsConfigResolver`) plus
 * `audioProviderKeys` from `ResolvedAuth`. This step's job is the pipeline
 * glue: prerequisite checks, config resolution, dispatch with the outer
 * 300s budget, and Redis storage of the normalized output.
 */

import { type TtsProviderId } from '@tzurot/common-types/services/tts/TtsProvider';
import { type AudioProviderId } from '@tzurot/common-types/types/audio-provider';
import { isVoiceEnabled } from '@tzurot/common-types/types/schemas/personality';
import { TimeoutError } from '@tzurot/common-types/utils/errors';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { TtsConfigResolver } from '@tzurot/config-resolver';
import type { IPipelineStep, GenerationContext } from '../types.js';
import { dispatchTts } from '../../../../services/voice/TtsDispatcher.js';
import {
  ttsProviderRegistry,
  resetTtsProviderRegistry,
} from '../../../../services/voice/ttsProviderRegistry.js';
import { normalizeLoudness } from '../../../../services/voice/audioNormalizer.js';
import { redisService } from '../../../../redis.js';

const logger = createLogger('TTSStep');

/** Total TTS budget across prepare + synthesize + normalize.
 *
 * Sized for the common worst case: the primary provider (BYOK) fails — e.g. a
 * content-guardrail block — and the dispatcher falls back to self-hosted, which
 * may have to cold-start from serverless sleep before it can synthesize:
 *   primary attempt (~15s) + voice-engine cold start (up to the 120s warmup
 *   budget, ~52s typical — see voiceEngineWarmup) + multi-chunk synthesis of a
 *   long reply (~190s for ~3.5k chars) + margin.
 *
 * The cold start is charged against this same budget, so a long synthesis right
 * after a cold start is the binding case (~260s) — hence 300s, not less. A
 * pathological full-120s cold start + very-long synthesis can still exceed it
 * (accepted edge case); the cleaner fix — start the synthesis timeout at
 * warmup-completion so the cold start doesn't eat the synthesis budget — is
 * tracked in `backlog/cold/follow-ups.md`.
 *
 * The race is around the entire dispatcher + normalize call so a stuck
 * normalizer (e.g., ffmpeg hang) can't deadlock the pipeline. Text is
 * always delivered regardless — this only affects whether audio attaches. */
const TTS_MAX_TOTAL_MS = 300_000;

/** @internal Test-only — reset cached provider singletons between test files. */
export function resetTTSStepState(): void {
  resetTtsProviderRegistry();
}

/** Output of the Redis-storage step. Narrow on purpose — the dispatcher's
 *  attribution data (providerUsed/usedFallback) doesn't pass through
 *  storage; it's merged in by the outer pipeline call site. */
interface StoredTtsAudio {
  key: string;
  audioSize: number;
  contentType: string;
}

/** Full TtsResult that flows to the result metadata + diagnostic recorder.
 *  Storage fields plus dispatcher attribution + optional bot-owner notices. */
interface TtsResult extends StoredTtsAudio {
  /** Bot-owner-visible diagnostics from the dispatcher's fallback walk
   *  (e.g., "Mistral skipped because reference audio >30s"). Empty/undefined
   *  on the happy path. */
  notices?: string[];
  /** Provider that actually produced the audio (post-dispatch). May differ
   *  from the user's configured provider if the dispatcher fell through to
   *  a fallback. Always set on a successful dispatch. */
  providerUsed: TtsProviderId;
  /** Whether `providerUsed` differs from the user's configured provider for
   *  this turn (i.e., the dispatcher fell through to a fallback). */
  usedFallback: boolean;
}

export class TTSStep implements IPipelineStep {
  readonly name = 'TTSStep';

  /**
   * @param ttsConfigResolver - Resolves the user's effective TTS config from
   *   the (user, personality) pair. Optional in the constructor signature so
   *   tests that don't exercise TTS can construct the step without standing
   *   up a Prisma client. When undefined, TTS is skipped entirely.
   */
  constructor(private readonly ttsConfigResolver?: TtsConfigResolver) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    if (!this.shouldRunTTS(context)) {
      return context;
    }

    const { personality } = context.job.data;
    const slug = personality.slug;
    const text = context.result?.content;

    if (text === undefined || text.length === 0) {
      return context;
    }

    if (this.ttsConfigResolver === undefined) {
      logger.debug('No TtsConfigResolver wired — skipping TTS');
      return context;
    }

    try {
      // Resolve effective config (user override → user default → personality
      // default → free default → hardcoded fallback). The DB-side resolver
      // already handles all caching; we just call it.
      const userId = context.job.data.context.userId;
      const { config: resolvedConfig } = await this.ttsConfigResolver.resolveConfig(
        userId,
        personality.id,
        { id: personality.id }
      );

      // Build dispatcher inputs. The audioProviderKeys map carries any BYOK
      // credentials the user has set (populated by AuthStep — empty Map is
      // expected for guest mode or no-key users). Typed fallback avoids a
      // narrowing cast at the dispatcher boundary.
      const audioProviderKeys =
        context.auth?.audioProviderKeys ?? new Map<AudioProviderId, string>();

      const ttsResult = await this.runWithTimeout(
        text,
        slug,
        resolvedConfig,
        audioProviderKeys,
        context
      );

      if (ttsResult !== null && context.result?.metadata !== undefined) {
        context.result.metadata.ttsAudioKey = ttsResult.key;
        context.result.metadata.ttsAudioContentType = ttsResult.contentType;
        // Attribution: report what ACTUALLY produced the audio. If the
        // dispatcher fell through from the configured provider to a
        // fallback, the bot-client's diagnostic UI surfaces the divergence
        // so silent fallbacks don't masquerade as the requested provider.
        context.result.metadata.ttsProviderUsed = ttsResult.providerUsed;
        context.result.metadata.ttsUsedFallback = ttsResult.usedFallback;
        if (ttsResult.notices !== undefined && ttsResult.notices.length > 0) {
          context.result.metadata.ttsNotices = ttsResult.notices;
        }
        // Record TTS attribution in the diagnostic flight recorder so the
        // /inspect Token Budget view can render "TTS: provider (via fallback)".
        // Must run before the orchestrator stores the final diagnostic log
        // so the saved log carries the TTS fields.
        context.diagnosticCollector?.recordTtsDispatch({
          providerUsed: ttsResult.providerUsed,
          usedFallback: ttsResult.usedFallback,
        });
        logger.info(
          {
            slug,
            audioSize: ttsResult.audioSize,
            contentType: ttsResult.contentType,
            key: ttsResult.key,
            providerUsed: ttsResult.providerUsed,
            usedFallback: ttsResult.usedFallback,
            noticeCount: ttsResult.notices?.length ?? 0,
          },
          'TTS audio stored in Redis'
        );
      }
    } catch (error) {
      // Non-critical: log warning and return context unchanged (text still delivered)
      logger.warn({ err: error, slug }, 'TTS synthesis failed, delivering text-only response');
    }

    return context;
  }

  /**
   * Wrap the dispatch + normalize + store in the outer 300s budget. When the
   * timeout wins the race, the underlying work continues in the background;
   * its result is discarded (ttsAudioKey never written) and the audio expires
   * via Redis TTL.
   */
  private async runWithTimeout(
    text: string,
    slug: string,
    resolvedConfig: Awaited<ReturnType<TtsConfigResolver['resolveConfig']>>['config'],
    audioProviderKeys: ReadonlyMap<AudioProviderId, string>,
    context: GenerationContext
  ): Promise<TtsResult | null> {
    let timedOut = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const work = (async () => {
      // BYOK key threading: the base ctx intentionally has no `byokKey` field —
      // the dispatcher's `buildCtxForProvider` hydrates the per-provider key
      // from `audioProviderKeys` before each `prepare()`/`synthesize()` call.
      // Provider-side `byokKey === undefined` guards (e.g.,
      // MistralTtsProvider.prepare) only fire on direct calls in tests; in
      // production, the dispatcher path always supplies the key from the map.
      const dispatchResult = await dispatchTts({
        text,
        resolvedConfig,
        ctx: { slug, modelId: resolvedConfig.modelId ?? undefined },
        audioProviderKeys,
        registry: ttsProviderRegistry,
      });
      const stored = await this.storeTTSResult(
        context,
        dispatchResult.audioBuffer,
        dispatchResult.outputFormat,
        slug
      );
      // Bind to a local so TS narrowing carries through subsequent checks
      // without needing `?.length ?? 0` defensiveness inside the warn block.
      const notices = dispatchResult.notices;
      const hasNotices = notices !== undefined && notices.length > 0;
      if (stored === null && hasNotices) {
        // Notices are observability-only — losing them on a Redis write failure
        // doesn't change behavior, but the silent drop is surprising. Log so a
        // future debug session can correlate "missing owner notice" with a
        // Redis incident in the same window.
        logger.warn(
          { slug, noticeCount: notices.length },
          'TTS notices dropped: storeTTSResult returned null (likely Redis write failure)'
        );
      }
      if (stored === null) {
        return null;
      }
      // Always attach providerUsed/usedFallback — they're load-bearing for
      // the diagnostic UI's silent-fallback detection. Notices remain
      // optional (only set when something noteworthy happened).
      const baseResult: TtsResult = {
        ...stored,
        providerUsed: dispatchResult.providerUsed,
        usedFallback: dispatchResult.usedFallback,
      };
      return hasNotices ? { ...baseResult, notices } : baseResult;
    })();

    void work.then(
      result => {
        if (timedOut) {
          logger.warn(
            { slug, audioSize: result?.audioSize },
            'TTS completed after timeout (result discarded)'
          );
        }
      },
      (err: unknown) => {
        if (timedOut) {
          logger.warn({ err, slug }, 'TTS failed after timeout (result already discarded)');
        }
      }
    );

    return Promise.race([
      // clearTimeout is a no-op if the timeout already fired (timedOut path);
      // it's still needed to cancel the pending timer when work completes
      // first, otherwise the timer keeps the event loop alive past the response.
      work.finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }),
      new Promise<null>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new TimeoutError(TTS_MAX_TOTAL_MS, 'TTS processing'));
        }, TTS_MAX_TOTAL_MS);
      }),
    ]);
  }

  private shouldRunTTS(context: GenerationContext): boolean {
    if (context.result?.success !== true) {
      return false;
    }

    const { personality } = context.job.data;
    if (!isVoiceEnabled(personality)) {
      return false;
    }

    const voiceResponseMode = context.configOverrides?.voiceResponseMode ?? 'never';

    if (voiceResponseMode === 'never') {
      return false;
    }

    if (voiceResponseMode === 'voice-only') {
      const isVoiceMessage = context.job.data.context.isVoiceMessage === true;
      if (!isVoiceMessage) {
        logger.debug('voiceResponseMode is voice-only but trigger was not a voice message');
        return false;
      }
    }

    return true;
  }

  /**
   * Persist the synthesized audio to Redis, applying EBU R128 loudness
   * normalization to -14 LUFS first. Failure-tolerant — if normalization
   * throws (ffmpeg missing, malformed input), the unnormalized buffer is
   * stored so the user gets less-pleasant audio rather than no audio.
   */
  private async storeTTSResult(
    context: GenerationContext,
    audioBuffer: Buffer,
    outputFormat: string,
    slug: string
  ): Promise<StoredTtsAudio | null> {
    const jobId = context.job.id ?? context.job.data.requestId;
    if (jobId === undefined) {
      logger.warn({ slug }, 'TTS: no job ID available, skipping audio storage');
      return null;
    }

    let storedBuffer = audioBuffer;
    let storedContentType = outputFormatToContentType(outputFormat);
    try {
      const normalized = await normalizeLoudness(audioBuffer);
      storedBuffer = normalized;
      // normalizeLoudness emits Opus-in-Ogg (single ffmpeg pass: loudnorm +
      // libopus). Discord-friendly compressed output, ~10x smaller than the
      // uncompressed WAV path that preceded this consolidation.
      storedContentType = 'audio/ogg';
    } catch (error) {
      // On normalize failure (ffmpeg missing, pipe error), fall back to the
      // raw audioBuffer. For multi-chunk synthesis this is the concatenated
      // WAV — potentially several MiB on long output. DiscordResponseSender
      // bounds the upload via DISCORD_LIMITS.FILE_UPLOAD_MAX_BYTES (8 MiB)
      // and substitutes a small notice attachment when exceeded, so the
      // pathological-size case fails loud rather than silently truncating.
      logger.warn(
        { err: error, slug, originalBytes: audioBuffer.length },
        'Audio loudness normalization failed — storing unnormalized output'
      );
    }

    const key = await redisService.storeTTSAudio(jobId, storedBuffer);
    return { key, audioSize: storedBuffer.length, contentType: storedContentType };
  }
}

/** Map TtsCapabilities.outputFormat to its HTTP content-type. */
function outputFormatToContentType(format: string): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/ogg';
    case 'pcm':
      return 'audio/pcm';
    case 'wav':
    default:
      return 'audio/wav';
  }
}
