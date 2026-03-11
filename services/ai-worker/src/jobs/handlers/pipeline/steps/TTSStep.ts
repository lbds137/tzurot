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

import { createLogger, isVoiceEnabled } from '@tzurot/common-types';
import type { IPipelineStep, GenerationContext } from '../types.js';
import { getVoiceEngineClient } from '../../../../services/voice/VoiceEngineClient.js';
import { VoiceRegistrationService } from '../../../../services/voice/VoiceRegistrationService.js';
import { synthesizeWithChunking } from '../../../../services/voice/ttsSynthesizer.js';
import { waitForVoiceEngine } from '../../../../services/voice/voiceEngineWarmup.js';
import { ElevenLabsVoiceService } from '../../../../services/voice/ElevenLabsVoiceService.js';
import {
  elevenLabsTTS,
  ElevenLabsApiError,
  ElevenLabsTimeoutError,
} from '../../../../services/voice/ElevenLabsClient.js';
import { withRetry, RetryError } from '../../../../utils/retry.js';
import { redisService } from '../../../../redis.js';

const logger = createLogger('TTSStep');

/** TTS timeout — includes voice-engine cold start time on Railway Serverless.
 * Budget: health wait (75s) + voice registration (15s) + synthesis (~45s) + margin (15s).
 * 150s accommodates the full ~56s cold start plus multi-chunk TTS. */
const TTS_TIMEOUT_MS = 150_000;

/** Max ElevenLabs TTS outer retry attempts (1 initial + 1 retry).
 * Each attempt may make 1 extra elevenLabsTTS call if 404 triggers re-clone. */
const ELEVENLABS_MAX_ATTEMPTS = 2;

/** Global timeout for all ElevenLabs retry attempts combined.
 * Each ElevenLabs call has a 60s AbortController timeout, so worst case without
 * this cap would be 2×60s + backoff = ~121s — leaving only ~29s for voice-engine
 * fallback (which needs up to 75s for cold start alone).
 * 90s cap: allows 1 full timeout (60s) + partial 2nd attempt, leaves ~60s for
 * voice-engine fallback — enough for a warm engine, tight for cold start. */
const ELEVENLABS_RETRY_TIMEOUT_MS = 90_000;

/** Initial backoff delay for ElevenLabs TTS retry. Intentionally short — the
 * retry primarily helps with brief 5xx blips. For sustained 429 rate limits
 * (30-60s windows), the voice-engine fallback is the real safety net. */
const ELEVENLABS_RETRY_DELAY_MS = 5_000;

/** Classify errors as transient (worth retrying) for ElevenLabs TTS.
 * Covers: 429 rate limit, 5xx server errors, network timeouts, connection failures. */
function isTransientElevenLabsError(error: unknown): boolean {
  if (error instanceof ElevenLabsApiError) {
    return error.isTransient;
  }
  // Typed sentinel from elevenLabsFetch AbortController timeout
  if (error instanceof ElevenLabsTimeoutError) {
    return true;
  }
  // Network-level connection failures: Node undici throws TypeError("fetch failed")
  // for ECONNREFUSED, ECONNRESET, DNS failures (details in error.cause).
  // Strict equality on the known undici message to avoid retrying programming TypeErrors.
  if (error instanceof Error && error.name === 'TypeError' && error.message === 'fetch failed') {
    return true;
  }
  return false;
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
      const ttsPromise =
        elevenlabsApiKey !== undefined
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

      const ttsResult = await Promise.race([
        ttsPromise.finally(() => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
        }),
        new Promise<null>((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            reject(new Error(`TTS timed out after ${TTS_TIMEOUT_MS}ms`));
          }, TTS_TIMEOUT_MS);
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
    try {
      return await this.performElevenLabsTTS(text, slug, apiKey, context);
    } catch (error) {
      // No voice-engine configured → rethrow (outer catch delivers text-only)
      const registrationService = getRegistrationService();
      if (registrationService === null) {
        throw error;
      }

      // Unwrap RetryError to get the original error for classification and logging.
      // Pino won't auto-unwrap RetryError.lastError, so log the original directly.
      const originalError = error instanceof RetryError ? error.lastError : error;

      if (originalError instanceof ElevenLabsApiError && originalError.isAuthError) {
        logger.error(
          { err: originalError, slug },
          '[FALLBACK] ElevenLabs auth error, falling back to voice-engine'
        );
      } else {
        logger.warn(
          { err: originalError, slug },
          '[FALLBACK] ElevenLabs TTS failed, trying voice-engine'
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

    // Clone or find voice in user's ElevenLabs account
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
        initialDelayMs: ELEVENLABS_RETRY_DELAY_MS,
        globalTimeoutMs: ELEVENLABS_RETRY_TIMEOUT_MS,
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
    await waitForVoiceEngine(registrationService.client, 'tts');

    // Ensure voice is registered
    await registrationService.ensureVoiceRegistered(slug);

    // Synthesize (with chunking for long text)
    const { audioBuffer, contentType } = await synthesizeWithChunking(
      registrationService.client,
      text,
      slug
    );

    return this.storeTTSResult(context, audioBuffer, contentType, slug);
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
