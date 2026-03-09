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
import { redisService } from '../../../../redis.js';

const logger = createLogger('TTSStep');

/** TTS timeout — includes voice-engine cold start time on Railway Serverless.
 * Budget: health retries (12s) + voice registration (15s) + synthesis (~63s).
 * 90s accommodates multi-chunk TTS on first cold-start without unnecessary wait on true failures. */
const TTS_TIMEOUT_MS = 90_000;

/** Delay between health check retries when waiting for voice engine cold start */
const HEALTH_RETRY_DELAY_MS = 3_000;
/** Max health check attempts before proceeding anyway */
const HEALTH_RETRY_MAX_ATTEMPTS = 5;

/**
 * Lazy singleton for voice registration (shares VoiceEngineClient lifecycle).
 * WARNING: Test files that import TTSStep must call resetTTSStepState() in
 * beforeEach/afterEach to avoid stale singleton leaking between test files.
 */
let _registrationService: VoiceRegistrationService | null = null;

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

/** Reset singleton (for testing). */
export function resetTTSStepState(): void {
  _registrationService = null;
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

    const registrationService = getRegistrationService();
    if (registrationService === null) {
      logger.debug('Voice engine not configured, skipping TTS');
      return context;
    }

    try {
      // Apply timeout to the entire TTS process.
      // When timeout wins the race, performTTS continues in the background — its result
      // is discarded (ttsAudioKey never written), and the audio expires via Redis TTL.
      let timedOut = false;
      let timeoutId: NodeJS.Timeout | undefined;
      const ttsPromise = this.performTTS(registrationService, text, slug, context);

      // Observe dangling completion/rejection after timeout (makes background work visible in logs).
      // If timeout wins the race, the outer catch handles the timeout error but NOT any later
      // rejection from performTTS — without this observer, late failures would be silently swallowed.
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
          // else: pre-timeout error — already rejected in Promise.race, outer catch handles it
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
        logger.info(
          { slug, audioSize: ttsResult.audioSize, key: ttsResult.key },
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

    // Check config cascade for voice response mode
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

  private async performTTS(
    registrationService: VoiceRegistrationService,
    text: string,
    slug: string,
    context: GenerationContext
  ): Promise<{ key: string; audioSize: number } | null> {
    // Pre-warm: ping /health to wake voice engine from Railway Serverless sleep.
    // Voice engine cold boot takes ~7s (models cached on disk), so retry a few
    // times with short delays. The first ping's TCP connection triggers Railway
    // to start the container.
    await this.waitForVoiceEngine(registrationService, slug);

    // Ensure voice is registered
    await registrationService.ensureVoiceRegistered(slug);

    // Synthesize (with chunking for long text)
    const { audioBuffer } = await synthesizeWithChunking(registrationService.client, text, slug);

    // Store audio in Redis
    const jobId = context.job.id ?? context.job.data.requestId;
    if (jobId === undefined) {
      logger.warn({ slug }, 'TTS: no job ID available, skipping audio storage');
      return null;
    }
    const key = await redisService.storeTTSAudio(jobId, audioBuffer);

    return { key, audioSize: audioBuffer.length };
  }

  /**
   * Wait for the voice engine to become ready, retrying health checks with delays.
   * The first ping wakes Railway Serverless; subsequent pings wait for model loading (~7s).
   * Proceeds after max attempts regardless — registration/synthesis will fail with a
   * clear error if the engine truly isn't available.
   */
  private async waitForVoiceEngine(
    registrationService: VoiceRegistrationService,
    slug: string
  ): Promise<void> {
    for (let attempt = 1; attempt <= HEALTH_RETRY_MAX_ATTEMPTS; attempt++) {
      const health = await registrationService.client.getHealth();
      if (health.tts) {
        return;
      }
      if (attempt < HEALTH_RETRY_MAX_ATTEMPTS) {
        logger.info(
          { slug, attempt, maxAttempts: HEALTH_RETRY_MAX_ATTEMPTS },
          'Voice engine TTS not ready — waiting for cold start'
        );
        await new Promise(resolve => setTimeout(resolve, HEALTH_RETRY_DELAY_MS));
      }
    }
    logger.warn({ slug }, 'Voice engine TTS still not ready after retries — proceeding anyway');
  }
}
