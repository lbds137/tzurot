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
 */

import { createLogger, isVoiceEnabled, isTransientNetworkError } from '@tzurot/common-types';
import type { IPipelineStep, GenerationContext } from '../types.js';
import {
  getVoiceEngineClient,
  isTransientVoiceEngineError,
  VOICE_ENGINE_RETRY,
} from '../../../../services/voice/VoiceEngineClient.js';
import { VoiceRegistrationService } from '../../../../services/voice/VoiceRegistrationService.js';
import { synthesizeWithChunking } from '../../../../services/voice/ttsSynthesizer.js';
import { waitForVoiceEngine } from '../../../../services/voice/voiceEngineWarmup.js';
import { ElevenLabsVoiceService } from '../../../../services/voice/ElevenLabsVoiceService.js';
import { elevenLabsTTS, ElevenLabsApiError } from '../../../../services/voice/ElevenLabsClient.js';
import { withRetry, RetryError, TimeoutError } from '../../../../utils/retry.js';
import { redisService } from '../../../../redis.js';

const logger = createLogger('TTSStep');

/** Total TTS budget (single budget across ElevenLabs + voice-engine fallback paths).
 *
 * Sized to accommodate the worst case where ElevenLabs fails and voice-engine
 * has to cold-start from scratch:
 *   ElevenLabs attempt (60s) + voice-engine cold start (~47s observed,
 *   75s budget) + registration (15s) + multi-chunk synthesis (~90s) + margin.
 *
 * Previously this was two separate budgets (150s for ElevenLabs-only path,
 * 240s for voice-engine path) which had a bug: when an ElevenLabs-configured
 * user's request failed and fell back to voice-engine, the outer race was
 * still bound by the 150s budget, and voice-engine cold start couldn't
 * complete in the remaining ~25s. Unified to 240s for robustness regardless
 * of which path is taken. Text is always delivered regardless — this only
 * affects whether audio is attached. */
const TTS_MAX_TOTAL_MS = 240_000;

/** Max ElevenLabs TTS outer retry attempts (1 attempt, no retry).
 *
 * Previously 2 (1 initial + 1 retry). Reduced to 1 for the same reason we
 * capped vision retries in beta.97: a 60s ElevenLabs timeout retried with
 * another 60s budget rarely succeeds if the first attempt timed out — the
 * provider's network state hasn't changed. When 60s isn't enough, the
 * voice-engine fallback is the real safety net (see
 * performElevenLabsTTSWithFallback) and needs the budget headroom.
 *
 * Cost of this choice: we lose recovery on brief 5xx blips that would've
 * succeeded on a second attempt. Accepted because: (a) fallback handles the
 * failure path, (b) text is always delivered regardless of audio outcome. */
const ELEVENLABS_MAX_ATTEMPTS = 1;

/** Classify errors as transient (worth retrying) for ElevenLabs TTS.
 * Covers: 429 rate limit, 5xx server errors, network timeouts, connection failures.
 *
 * Note: at {@link ELEVENLABS_MAX_ATTEMPTS}=1, `shouldRetry` is never invoked
 * (no retry attempts exist), so this classification has no runtime effect.
 * Kept in place so that if maxAttempts is raised in the future, retry gating
 * still works without code changes. The voice-engine fallback in
 * {@link performElevenLabsTTSWithFallback} fires unconditionally on any
 * error — it does not consult this classifier. */
function isTransientElevenLabsError(error: unknown): boolean {
  if (error instanceof ElevenLabsApiError) {
    return error.isTransient;
  }
  // Typed sentinel from elevenLabsFetch AbortController timeout.
  // Broad TimeoutError check covers ElevenLabsTimeoutError (subclass)
  // and any future timeout subclasses without updating this classifier.
  if (error instanceof TimeoutError) {
    return true;
  }
  // Network-level connection failures (ECONNREFUSED, ECONNRESET, ETIMEDOUT, fetch failed)
  return isTransientNetworkError(error);
}

/**
 * Lazy singleton for voice registration (shares VoiceEngineClient lifecycle).
 * WARNING: Test files that import TTSStep must call resetTTSStepState() in
 * beforeEach/afterEach to avoid stale singleton leaking between test files.
 */
let _registrationService: VoiceRegistrationService | null = null;
let _elevenLabsVoiceService: ElevenLabsVoiceService | null = null;

function getRegistrationService(): VoiceRegistrationService | null {
  if (_registrationService !== null) {
    return _registrationService;
  }
  const client = getVoiceEngineClient();
  if (client === null) {
    return null;
  }
  _registrationService = new VoiceRegistrationService(client);
  return _registrationService;
}

function getElevenLabsVoiceService(): ElevenLabsVoiceService {
  _elevenLabsVoiceService ??= new ElevenLabsVoiceService();
  return _elevenLabsVoiceService;
}

/** Reset singleton (for testing). */
export function resetTTSStepState(): void {
  _registrationService = null;
  _elevenLabsVoiceService = null;
}

export class TTSStep implements IPipelineStep {
  readonly name = 'TTSStep';

  async process(context: GenerationContext): Promise<GenerationContext> {
    // Check prerequisites
    if (!this.shouldRunTTS(context)) {
      return context;
    }

    const { personality } = context.job.data;
    const slug = personality.slug;
    const text = context.result?.content;

    if (text === undefined || text.length === 0) {
      return context;
    }

    // Route TTS: ElevenLabs BYOK takes priority over self-hosted voice-engine
    const elevenlabsApiKey = context.auth?.elevenlabsApiKey;

    if (elevenlabsApiKey === undefined) {
      const registrationService = getRegistrationService();
      if (registrationService === null) {
        logger.debug('Voice engine not configured and no ElevenLabs key, skipping TTS');
        return context;
      }
    }

    try {
      // Apply timeout to the entire TTS process.
      // When timeout wins the race, the TTS continues in the background — its result
      // is discarded (ttsAudioKey never written), and the audio expires via Redis TTL.
      let timedOut = false;
      let timeoutId: NodeJS.Timeout | undefined;

      // Dispatch based on whether the user has ElevenLabs configured.
      const isElevenLabs = elevenlabsApiKey !== undefined;
      const ttsPromise = isElevenLabs
        ? this.performElevenLabsTTSWithFallback(text, slug, elevenlabsApiKey, context)
        : this.performVoiceEngineTTS(text, slug, context);

      // Observe dangling completion/rejection after timeout (makes background work visible in logs).
      void ttsPromise.then(
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

      // Single outer budget across both paths (ElevenLabs + voice-engine fallback).
      // See TTS_MAX_TOTAL_MS comment for the rationale behind the unified budget.
      const ttsResult = await Promise.race([
        ttsPromise.finally(() => {
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

      if (ttsResult !== null && context.result?.metadata !== undefined) {
        context.result.metadata.ttsAudioKey = ttsResult.key;
        context.result.metadata.ttsAudioContentType = ttsResult.contentType;
        logger.info(
          {
            slug,
            audioSize: ttsResult.audioSize,
            contentType: ttsResult.contentType,
            key: ttsResult.key,
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

  private shouldRunTTS(context: GenerationContext): boolean {
    // Must have a successful generation result
    if (context.result?.success !== true) {
      return false;
    }

    // Personality must have voice enabled
    const { personality } = context.job.data;
    if (!isVoiceEnabled(personality)) {
      return false;
    }

    // Check config cascade for voice response mode.
    // Defaults to 'never' when configOverrides is absent (e.g., guest mode, missing cascade).
    const voiceResponseMode = context.configOverrides?.voiceResponseMode ?? 'never';

    if (voiceResponseMode === 'never') {
      return false;
    }

    if (voiceResponseMode === 'voice-only') {
      // Only run TTS when the triggering message was a voice message
      const isVoiceMessage = context.job.data.context.isVoiceMessage === true;
      if (!isVoiceMessage) {
        logger.debug('voiceResponseMode is voice-only but trigger was not a voice message');
        return false;
      }
    }

    // voiceResponseMode === 'always' falls through to return true
    return true;
  }

  private async performElevenLabsTTSWithFallback(
    text: string,
    slug: string,
    apiKey: string,
    context: GenerationContext
  ): Promise<{ key: string; audioSize: number; contentType: string } | null> {
    const elevenLabsStartMs = Date.now();
    try {
      return await this.performElevenLabsTTS(text, slug, apiKey, context);
    } catch (error) {
      const elapsedMs = Date.now() - elevenLabsStartMs;

      // No voice-engine configured → rethrow (outer catch delivers text-only)
      if (getVoiceEngineClient() === null) {
        throw error;
      }

      // Unwrap RetryError to get the original error for classification and logging.
      // Pino won't auto-unwrap RetryError.lastError, so log the original directly.
      const originalError = error instanceof RetryError ? error.lastError : error;

      if (originalError instanceof ElevenLabsApiError && originalError.isAuthError) {
        logger.error(
          { err: originalError, slug, elapsedMs, fallback: 'voice-engine' },
          'ElevenLabs auth error, falling back to voice-engine'
        );
      } else {
        logger.warn(
          { err: originalError, slug, elapsedMs, fallback: 'voice-engine' },
          'ElevenLabs TTS failed, trying voice-engine'
        );
      }

      return this.performVoiceEngineTTS(text, slug, context);
    }
  }

  private async performElevenLabsTTS(
    text: string,
    slug: string,
    apiKey: string,
    context: GenerationContext
  ): Promise<{ key: string; audioSize: number; contentType: string } | null> {
    const voiceService = getElevenLabsVoiceService();
    const modelId = context.configOverrides?.elevenlabsTtsModel;

    // Clone or find voice in user's ElevenLabs account.
    // voiceId is intentionally mutable — a 404 re-clone inside the retry callback
    // updates it, and subsequent retry attempts reuse the fresh voice ID.
    //
    // Subtle interaction: if ensureVoiceCloned (re-clone) inside the 404 handler
    // throws transiently (e.g., TypeError("fetch failed")), withRetry may retry
    // with the old voiceId (already invalidated), hitting 404 again. The 404
    // handler re-invokes ensureVoiceCloned; if that succeeds, the retry succeeds.
    // If it fails again, retries exhaust → voice-engine fallback. Not a bug —
    // just a double-clone-attempt under pathological conditions.
    let voiceId = await voiceService.ensureVoiceCloned(slug, apiKey);

    // Synthesize — ElevenLabs handles up to 5000 chars natively, no chunking needed
    logger.info({ slug, textLength: text.length, modelId }, 'Synthesizing via ElevenLabs TTS');

    const { value } = await withRetry(
      async () => {
        try {
          return await elevenLabsTTS({ text, voiceId, apiKey, modelId });
        } catch (error) {
          // Voice was deleted externally (e.g., /settings voices clear, ElevenLabs dashboard).
          // Invalidate stale cache entry and re-clone from reference audio, then retry the call.
          // 404 is a state fix (not transience), so handle before shouldRetry sees it.
          // If the re-cloned voice also 404s, shouldRetry returns false (404 isn't transient)
          // and the error propagates to performElevenLabsTTSWithFallback for voice-engine fallback.
          if (error instanceof ElevenLabsApiError && error.status === 404) {
            logger.info({ slug, voiceId }, 'Voice not found on ElevenLabs, re-cloning');
            voiceService.invalidateVoice(slug, apiKey);
            voiceId = await voiceService.ensureVoiceCloned(slug, apiKey);
            return elevenLabsTTS({ text, voiceId, apiKey, modelId });
          }
          throw error;
        }
      },
      {
        maxAttempts: ELEVENLABS_MAX_ATTEMPTS,
        // No initialDelayMs or globalTimeoutMs — both are no-ops at
        // maxAttempts=1 (no between-attempts gap exists). The outer
        // Promise.race (TTS_MAX_TOTAL_MS) is the effective upper bound.
        shouldRetry: isTransientElevenLabsError,
        operationName: 'ElevenLabs TTS',
        logger,
      }
    );

    return this.storeTTSResult(context, value.audioBuffer, value.contentType, slug);
  }

  private async performVoiceEngineTTS(
    text: string,
    slug: string,
    context: GenerationContext
  ): Promise<{ key: string; audioSize: number; contentType: string } | null> {
    const registrationService = getRegistrationService();
    if (registrationService === null) {
      return null;
    }

    // Pre-warm: ping /health to wake voice engine from Railway Serverless sleep.
    // Voice engine cold boot takes ~56s (model loading from disk). The first ping's
    // TCP connection triggers Railway to start the container; subsequent polls wait
    // for model readiness. Proceeds even if budget exhausted — synthesis will fail
    // with a clear error if the engine truly isn't available.
    const warmup = await waitForVoiceEngine(registrationService.client, 'tts');
    logger.info(
      { slug, warmupElapsedMs: warmup.elapsedMs, ready: warmup.ready },
      'Voice engine warmup complete for TTS'
    );

    // Register + synthesize with retry for transient errors (ECONNREFUSED, 502/503/504).
    // Warmup stays outside retry (it has its own polling loop). Registration positive cache
    // prevents duplicate work on retry; transient errors aren't negatively cached so re-attempt
    // succeeds once the engine stabilizes.
    // No globalTimeoutMs — intentionally omitted (unlike ElevenLabs retry which uses 90s).
    // The outer Promise.race (TTS_MAX_TOTAL_MS = 240s) already enforces the total budget,
    // and with maxAttempts=2 + 3s delay the worst-case retry overhead is ~6s.
    const { value: synthesisResult } = await withRetry(
      async () => {
        await registrationService.ensureVoiceRegistered(slug);
        return synthesizeWithChunking(registrationService.client, text, slug);
      },
      {
        maxAttempts: VOICE_ENGINE_RETRY.MAX_ATTEMPTS,
        initialDelayMs: VOICE_ENGINE_RETRY.INITIAL_DELAY_MS,
        shouldRetry: isTransientVoiceEngineError,
        operationName: 'Voice Engine TTS',
        logger,
      }
    );

    return this.storeTTSResult(
      context,
      synthesisResult.audioBuffer,
      synthesisResult.contentType,
      slug
    );
  }

  private async storeTTSResult(
    context: GenerationContext,
    audioBuffer: Buffer,
    contentType: string,
    slug: string
  ): Promise<{ key: string; audioSize: number; contentType: string } | null> {
    const jobId = context.job.id ?? context.job.data.requestId;
    if (jobId === undefined) {
      logger.warn({ slug }, 'TTS: no job ID available, skipping audio storage');
      return null;
    }
    const key = await redisService.storeTTSAudio(jobId, audioBuffer);
    return { key, audioSize: audioBuffer.length, contentType };
  }
}
