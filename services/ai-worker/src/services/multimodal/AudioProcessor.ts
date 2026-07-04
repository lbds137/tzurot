/**
 * Audio Processor
 *
 * Processes audio (voice messages, audio files) to extract text transcriptions.
 * Provider selection: callers pass a {@link SttProvider} that they've already
 * resolved via {@link SttResolver}; this module just dispatches to the
 * corresponding HTTP client. Voice-engine (self-hosted) is the fallback when
 * a BYOK provider's call fails OR when no key is supplied.
 *
 * Includes Redis caching for faster repeated access.
 */

import { isTransientNetworkError } from '@tzurot/common-types/constants/error';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type SttDispatch, type SttProvider } from '@tzurot/common-types/types/sttProvider';
import { isTimeoutError, TimeoutError, AudioTooLongError } from '@tzurot/common-types/utils/errors';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { withRetry, RetryError } from '../../utils/retry.js';
import { validateAttachmentUrl, isDataUrl } from '../../utils/attachmentFetch.js';
import {
  VoiceEngineError,
  getVoiceEngineClient,
  isTransientVoiceEngineError,
  VOICE_ENGINE_RETRY,
} from '../voice/VoiceEngineClient.js';
import { waitForVoiceEngine } from '../voice/voiceEngineWarmup.js';
import { elevenLabsSTT, ElevenLabsApiError } from '../voice/ElevenLabsClient.js';
import {
  mistralTranscribeAudio,
  MistralSttApiError,
  MistralSttTimeoutError,
} from '../voice/MistralSttClient.js';

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
  // SSRF guard. Data URLs (from DownloadAttachmentsStep) short-circuit validation —
  // Node's fetch handles `data:` natively and the bytes are already trusted.
  const fetchUrl = isDataUrl(url) ? url : validateAttachmentUrl(url);

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), TIMEOUTS.AUDIO_FETCH);

  try {
    logger.debug({ url: fetchUrl }, 'Fetching audio');
    const response = await fetch(fetchUrl, { signal: controller.signal });

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
 * Classify a voice-engine failure from `transcribeWithVoiceEngine`'s catch. THROWS a
 * typed error for terminal causes the caller must surface (too-long → AudioTooLongError,
 * timeout → TimeoutError); RETURNS for genuine unavailability (auth / any other failure),
 * signaling the caller to fall through to null so the BYOK→voice-engine cascade and the
 * "no provider" path still work. Unwraps RetryError to the root cause first.
 *
 * Extracted from the catch to keep `transcribeWithVoiceEngine` under the cognitive-
 * complexity limit; the un-laundering of timeout/too-long is the whole point of the
 * branch set (a swallowed timeout becomes a generic "no provider" error and the user
 * sees the wrong message).
 */
function rethrowIfTerminalVoiceEngineError(error: unknown): void {
  const originalError = error instanceof RetryError ? error.lastError : error;

  // Too-long (413) — deterministic rejection before inference. Propagate typed.
  if (originalError instanceof VoiceEngineError && originalError.status === 413) {
    logger.warn({ err: originalError }, 'Voice engine rejected audio as too long');
    throw new AudioTooLongError(originalError.message);
  }

  // Timeout — slow/stalled inference (long audio on CPU). Propagate the TimeoutError.
  if (isTimeoutError(originalError)) {
    logger.warn({ err: error }, 'Voice engine transcription timed out');
    throw originalError;
  }

  // Auth error / any other failure → genuine unavailability. Log; caller returns null.
  // Auth branch logs originalError (the VoiceEngineError with status code); else logs
  // the RetryError wrapper (its message carries attempt count + timing).
  if (originalError instanceof VoiceEngineError && originalError.isAuthError) {
    logger.error(
      { err: originalError },
      'Voice engine auth error — check VOICE_ENGINE_API_KEY config'
    );
    return;
  }
  logger.warn({ err: error }, 'Voice engine transcription failed after retries');
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
    //
    // globalTimeoutMs interacts with the retry loop based on WHERE the check
    // fires: at the start of each attempt, against wall-clock elapsed since
    // withRetry began. Setting it to VOICE_ENGINE_API (480s) — equal to the
    // per-attempt timeout — produces the intended asymmetric behavior:
    //   - Attempt 1 fast-fails (e.g., ECONNREFUSED at 5s): elapsed at attempt-2
    //     entry ≈ 8s, < 480s, so retry proceeds. We keep retry value on transients.
    //   - Attempt 1 times out fully (480s): elapsed at attempt-2 entry ≈ 483s,
    //     ≥ 480s, so the global-timeout check fires and aborts. Worst case ≈ 483s.
    // Any higher value (e.g., STT_GATEWAY - AUDIO_FETCH = 510s) is a no-op at
    // MAX_ATTEMPTS=2 because elapsed-at-attempt-2 is bounded by 480 + 3 = 483s
    // and never reaches the threshold. The fully correct fix requires AbortSignal
    // propagation to cancel in-flight work mid-attempt — out of scope here.
    const { value: result } = await withRetry(
      () =>
        voiceEngineClient.transcribe(Buffer.from(audioBuffer), filename, attachment.contentType),
      {
        maxAttempts: VOICE_ENGINE_RETRY.MAX_ATTEMPTS,
        initialDelayMs: VOICE_ENGINE_RETRY.INITIAL_DELAY_MS,
        globalTimeoutMs: TIMEOUTS.VOICE_ENGINE_API,
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
    // Terminal causes (timeout, too-long) re-throw as typed errors so the failure
    // reason survives to the job result and the user-facing message; genuine
    // unavailability (auth / other) falls through to null so the BYOK→voice-engine
    // cascade and the "no provider" path still work.
    rethrowIfTerminalVoiceEngineError(error);
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
        { err: originalError, fallback: STT_FALLBACK_LABEL },
        'ElevenLabs STT auth error — falling back'
      );
    } else {
      logger.warn(
        { err: error, fallback: STT_FALLBACK_LABEL },
        'ElevenLabs STT failed after retries — trying voice-engine'
      );
    }
    return null;
  }
}

/** Logged when a BYOK STT provider fails and we cascade to voice-engine.
 *  Also used as the actualProvider tag when voice-engine produces the text
 *  (whether as primary or fallback). */
const STT_FALLBACK_LABEL = 'voice-engine' satisfies SttProvider;

/** Retry config for Mistral STT — same shape as ElevenLabs STT. */
const MISTRAL_STT_RETRY = {
  MAX_ATTEMPTS: 2,
  INITIAL_DELAY_MS: 3_000,
} as const;

function isTransientMistralSttError(error: unknown): boolean {
  if (error instanceof MistralSttApiError) {
    return error.isTransient;
  }
  if (error instanceof MistralSttTimeoutError) {
    return true;
  }
  return isTransientNetworkError(error);
}

/**
 * Transcribe via Mistral. Returns the transcription text, or null if the
 * request fails after retries. Auth failures (401/403) fast-fail without
 * retry — no point hammering on a bad key.
 */
async function transcribeWithMistral(
  attachment: AttachmentMetadata,
  audioBuffer: ArrayBuffer,
  apiKey: string
): Promise<string | null> {
  try {
    const filename =
      attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'audio.ogg';

    const { value: result } = await withRetry(
      () =>
        mistralTranscribeAudio({
          audioBuffer: Buffer.from(audioBuffer),
          filename,
          contentType: attachment.contentType,
          apiKey,
        }),
      {
        maxAttempts: MISTRAL_STT_RETRY.MAX_ATTEMPTS,
        initialDelayMs: MISTRAL_STT_RETRY.INITIAL_DELAY_MS,
        shouldRetry: isTransientMistralSttError,
        operationName: 'Mistral STT',
        logger,
      }
    );

    logger.info(
      { transcriptionLength: result.text.length, duration: attachment.duration },
      'Audio transcribed via Mistral STT'
    );

    return result.text;
  } catch (error) {
    const originalError = error instanceof RetryError ? error.lastError : error;
    if (originalError instanceof MistralSttApiError && originalError.isAuthError) {
      logger.error(
        { err: originalError, fallback: STT_FALLBACK_LABEL },
        'Mistral STT auth error — falling back'
      );
    } else {
      logger.warn(
        { err: error, fallback: STT_FALLBACK_LABEL },
        'Mistral STT failed after retries — trying voice-engine'
      );
    }
    return null;
  }
}

/**
 * Result of a successful transcription.
 *
 * `actualProvider` is what *produced* the text, not what was *requested*.
 * Always set on a fresh transcribe — `undefined` only on cache hits, where
 * the originating provider isn't recorded in the (text-only) cache schema.
 * Surfacing the actual provider closes the silent-fallback misattribution
 * where a Mistral request that fell through to voice-engine still claimed
 * to be Mistral output.
 */
export interface TranscribeAudioResult {
  text: string;
  actualProvider?: SttProvider;
}

/**
 * Look up a previously-transcribed result in Redis. Returns null on cache
 * miss, missing originalUrl, or any Redis error (logged + swallowed so
 * Redis outages can't break transcription).
 */
async function lookupCachedTranscript(attachment: AttachmentMetadata): Promise<string | null> {
  if (attachment.originalUrl === undefined || attachment.originalUrl.length === 0) {
    return null;
  }
  try {
    // Dynamic import: must stay dynamic for vi.mock() compatibility in tests.
    // Static import causes "Cannot access before initialization" because vitest
    // hoists vi.mock() above const declarations that the factory references.
    const { voiceTranscriptCache } = await import('../../redis.js');
    const cachedTranscript = await voiceTranscriptCache.get(attachment.originalUrl);
    if (cachedTranscript === null || cachedTranscript.length === 0) {
      return null;
    }
    logger.info(
      { originalUrl: attachment.originalUrl, transcriptLength: cachedTranscript.length },
      'Using cached voice transcript from Redis'
    );
    return cachedTranscript;
  } catch (error) {
    // Redis errors shouldn't break transcription - just log and continue
    logger.warn({ err: error }, 'Failed to check Redis cache, proceeding with transcription');
    return null;
  }
}

/** Try the BYOK path for the resolved provider. Returns the actual provider
 *  alongside the text on success; null when no key, not BYOK, or failed. */
async function tryBYOKTranscription(
  attachment: AttachmentMetadata,
  audioBuffer: ArrayBuffer,
  opts: SttDispatch
): Promise<TranscribeAudioResult | null> {
  if (opts.apiKey === undefined) {
    return null;
  }
  if (opts.provider === 'mistral') {
    const text = await transcribeWithMistral(attachment, audioBuffer, opts.apiKey);
    return text !== null ? { text, actualProvider: 'mistral' } : null;
  }
  if (opts.provider === 'elevenlabs') {
    const text = await transcribeWithElevenLabs(attachment, audioBuffer, opts.apiKey);
    return text !== null ? { text, actualProvider: 'elevenlabs' } : null;
  }
  return null;
}

/**
 * Transcribe audio (voice message or audio file).
 *
 * Provider dispatch is driven by `opts.provider` (resolved via SttResolver
 * upstream). Each BYOK path (mistral/elevenlabs) falls back to voice-engine
 * on failure or missing key, so callers always get a usable transcription
 * unless the audio itself is malformed.
 *
 * Throws only when ALL providers (the chosen one + voice-engine fallback)
 * fail to produce text — surfaces actionable "no STT available" errors
 * to the caller.
 */
export async function transcribeAudio(
  attachment: AttachmentMetadata,
  opts: SttDispatch
): Promise<TranscribeAudioResult> {
  const cached = await lookupCachedTranscript(attachment);
  if (cached !== null) {
    // Cache stores text only — original provider isn't recorded, so omit
    // attribution rather than re-claim it as the currently-resolved provider.
    // Telling the user "Transcribed by [Mistral]" over a cached voice-engine
    // transcript would be the exact misattribution this fix is designed to
    // prevent.
    return { text: cached };
  }

  // Fetch audio once — shared by all transcription paths
  const audioBuffer = await fetchAudioBuffer(attachment.url);

  // Primary path — dispatch to the resolved provider. Each BYOK path
  // returns null on failure (logged) so we fall through to voice-engine.
  const byokResult = await tryBYOKTranscription(attachment, audioBuffer, opts);
  if (byokResult !== null) {
    return byokResult;
  }

  // Fallback / `provider === 'voice-engine'` — try voice-engine.
  const voiceEngineText = await transcribeWithVoiceEngine(attachment, audioBuffer);
  if (voiceEngineText !== null) {
    return { text: voiceEngineText, actualProvider: STT_FALLBACK_LABEL };
  }

  // No STT provider produced text — surface the issue. voice-engine doesn't
  // need a key, so the "(no API key)" annotation only applies to BYOK providers.
  if (opts.provider === STT_FALLBACK_LABEL) {
    throw new Error('No STT provider available: voice-engine failed');
  }
  const annotation = opts.apiKey === undefined ? '(no API key)' : '(failed)';
  throw new Error(
    `No STT provider available: ${opts.provider} ${annotation} and voice-engine fallback also failed`
  );
}
