/**
 * Audio Processor
 *
 * Processes audio (voice messages, audio files) to extract text transcriptions.
 * Primary path: ElevenLabs STT (when BYOK key available).
 * Fallback: self-hosted voice-engine (Parakeet TDT) when VOICE_ENGINE_URL is set.
 * Includes Redis caching for faster repeated access.
 */

import {
  createLogger,
  TIMEOUTS,
  isTransientNetworkError,
  TimeoutError,
  type AttachmentMetadata,
} from '@tzurot/common-types';
import { withRetry, RetryError } from '../../utils/retry.js';
import {
  VoiceEngineError,
  getVoiceEngineClient,
  isTransientVoiceEngineError,
  VOICE_ENGINE_RETRY,
} from '../voice/VoiceEngineClient.js';
import { waitForVoiceEngine } from '../voice/voiceEngineWarmup.js';
import { elevenLabsSTT, ElevenLabsApiError } from '../voice/ElevenLabsClient.js';

const logger = createLogger('AudioProcessor');

/** Retry config for ElevenLabs STT — matches TTS retry budget in TTSStep.ts. */
const ELEVENLABS_STT_RETRY = {
  MAX_ATTEMPTS: 2,
  INITIAL_DELAY_MS: 3_000,
} as const;

/** Classify transient ElevenLabs errors (429 rate limit, 5xx, network failures).
 * Auth errors (401/403) fast-fail — no point retrying bad credentials. */
function isTransientElevenLabsError(error: unknown): boolean {
  if (error instanceof ElevenLabsApiError) {
    return error.isTransient;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  // Network-level connection failures (ECONNREFUSED, ECONNRESET, ETIMEDOUT, fetch failed)
  return isTransientNetworkError(error);
}

/**
 * Fetch audio from a URL with timeout, returning a Buffer.
 * Shared by both ElevenLabs and voice-engine paths.
 */
async function fetchAudioBuffer(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), TIMEOUTS.AUDIO_FETCH);

  try {
    logger.debug({ url }, 'Fetching audio');
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    return await response.arrayBuffer();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(TIMEOUTS.AUDIO_FETCH, 'audio file download', error);
    }
    throw error;
  } finally {
    clearTimeout(fetchTimeout);
  }
}

/**
 * Transcribe audio using the self-hosted voice-engine service.
 * Returns the transcription text, or null if the service is unavailable.
 */
async function transcribeWithVoiceEngine(
  attachment: AttachmentMetadata,
  audioBuffer: ArrayBuffer
): Promise<string | null> {
  const voiceEngineClient = getVoiceEngineClient();
  if (voiceEngineClient === null) {
    return null;
  }

  // Wake voice-engine from Railway Serverless sleep before attempting STT.
  // Without this, ECONNREFUSED wastes the first retry attempt (~7s backoff)
  // while the engine cold-starts for ~56s.
  const warmup = await waitForVoiceEngine(voiceEngineClient, 'asr');
  logger.info(
    { warmupElapsedMs: warmup.elapsedMs, ready: warmup.ready },
    'Voice engine warmup complete for STT'
  );

  try {
    const filename =
      attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'audio.ogg';

    // Retry transient errors (ECONNREFUSED, 502/503/504) — the engine may still be
    // stabilizing after warmup polling returned. Auth errors and other permanent
    // failures fast-fail via shouldRetry returning false.
    // No globalTimeoutMs — the per-call VOICE_ENGINE_API timeout (180s) bounds each
    // attempt, and with maxAttempts=2 the worst-case retry overhead is ~3s (delay only).
    const { value: result } = await withRetry(
      () =>
        voiceEngineClient.transcribe(Buffer.from(audioBuffer), filename, attachment.contentType),
      {
        maxAttempts: VOICE_ENGINE_RETRY.MAX_ATTEMPTS,
        initialDelayMs: VOICE_ENGINE_RETRY.INITIAL_DELAY_MS,
        shouldRetry: isTransientVoiceEngineError,
        operationName: 'Voice Engine STT',
        logger,
      }
    );

    if (result.text.length === 0) {
      // Warn if duration suggests real speech (>1s) — may indicate a model issue
      const logLevel =
        attachment.duration !== undefined && attachment.duration > 1 ? 'warn' : 'info';
      logger[logLevel](
        { duration: attachment.duration },
        'Voice engine returned empty transcription (silent or inaudible audio)'
      );
    } else {
      logger.info(
        { transcriptionLength: result.text.length, duration: attachment.duration },
        'Audio transcribed via voice-engine'
      );
    }

    // Empty string is a valid result (silent/inaudible audio)
    return result.text;
  } catch (error) {
    // Unwrap RetryError to classify the root cause (auth vs transient).
    // Auth branch logs originalError (the VoiceEngineError with status code).
    // Else branch logs the full `error` (RetryError wrapper) — its message includes
    // attempt count and timing, which is more useful for diagnosing transient failures.
    const originalError = error instanceof RetryError ? error.lastError : error;
    if (originalError instanceof VoiceEngineError && originalError.isAuthError) {
      logger.error(
        { err: originalError },
        'Voice engine auth error — check VOICE_ENGINE_API_KEY config'
      );
    } else {
      logger.warn({ err: error }, 'Voice engine transcription failed after retries');
    }
    return null;
  }
}

/**
 * Transcribe audio using ElevenLabs STT (BYOK path).
 * Returns the transcription text, or null if the request fails.
 */
async function transcribeWithElevenLabs(
  attachment: AttachmentMetadata,
  audioBuffer: ArrayBuffer,
  apiKey: string
): Promise<string | null> {
  try {
    const filename =
      attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'audio.ogg';

    // Retry transient errors (429 rate limit, 5xx, network failures) before
    // falling back to voice-engine. BYOK users pay for premium STT quality —
    // a brief 429 shouldn't silently downgrade to the free tier.
    const { value: result } = await withRetry(
      () =>
        elevenLabsSTT({
          audioBuffer: Buffer.from(audioBuffer),
          filename,
          contentType: attachment.contentType,
          apiKey,
        }),
      {
        maxAttempts: ELEVENLABS_STT_RETRY.MAX_ATTEMPTS,
        initialDelayMs: ELEVENLABS_STT_RETRY.INITIAL_DELAY_MS,
        shouldRetry: isTransientElevenLabsError,
        operationName: 'ElevenLabs STT',
        logger,
      }
    );

    logger.info(
      { transcriptionLength: result.text.length, duration: attachment.duration },
      'Audio transcribed via ElevenLabs STT'
    );

    return result.text;
  } catch (error) {
    // Unwrap RetryError to classify the root cause (auth vs transient).
    const originalError = error instanceof RetryError ? error.lastError : error;
    if (originalError instanceof ElevenLabsApiError && originalError.isAuthError) {
      logger.error(
        { err: originalError, fallback: 'voice-engine' },
        'ElevenLabs STT auth error — falling back'
      );
    } else {
      logger.warn(
        { err: error, fallback: 'voice-engine' },
        'ElevenLabs STT failed after retries — trying voice-engine'
      );
    }
    return null;
  }
}

/**
 * Transcribe audio (voice message or audio file).
 * Tries ElevenLabs STT first (if BYOK key), then voice-engine.
 * Throws when no STT provider is available — surfaces config issues.
 *
 * @param attachment - Audio attachment to transcribe
 * @param elevenlabsApiKey - Optional ElevenLabs BYOK key for premium STT
 */
export async function transcribeAudio(
  attachment: AttachmentMetadata,
  elevenlabsApiKey?: string
): Promise<string> {
  // Check Redis cache first (if originalUrl is available).
  // Cache is populated by bot-client's VoiceTranscriptionService after receiving job results.
  if (attachment.originalUrl !== undefined && attachment.originalUrl.length > 0) {
    try {
      // Dynamic import: must stay dynamic for vi.mock() compatibility in tests.
      // Static import causes "Cannot access before initialization" because vitest
      // hoists vi.mock() above const declarations that the factory references.
      const { voiceTranscriptCache } = await import('../../redis.js');
      const cachedTranscript = await voiceTranscriptCache.get(attachment.originalUrl);

      if (cachedTranscript !== null && cachedTranscript.length > 0) {
        logger.info(
          {
            originalUrl: attachment.originalUrl,
            transcriptLength: cachedTranscript.length,
          },
          'Using cached voice transcript from Redis'
        );
        return cachedTranscript;
      }
    } catch (error) {
      // Redis errors shouldn't break transcription - just log and continue
      logger.warn({ err: error }, 'Failed to check Redis cache, proceeding with transcription');
    }
  }

  // Fetch audio once — shared by all transcription paths
  const audioBuffer = await fetchAudioBuffer(attachment.url);

  // Try ElevenLabs STT first (BYOK premium path)
  if (elevenlabsApiKey !== undefined) {
    const elevenLabsResult = await transcribeWithElevenLabs(
      attachment,
      audioBuffer,
      elevenlabsApiKey
    );
    if (elevenLabsResult !== null) {
      return elevenLabsResult;
    }
  }

  // Try voice-engine (returns null if unconfigured or failed)
  const voiceEngineResult = await transcribeWithVoiceEngine(attachment, audioBuffer);
  if (voiceEngineResult !== null) {
    return voiceEngineResult;
  }

  // No STT provider available — fail with clear error
  throw new Error(
    'No STT provider available: configure an ElevenLabs API key (BYOK) or VOICE_ENGINE_URL'
  );
}
