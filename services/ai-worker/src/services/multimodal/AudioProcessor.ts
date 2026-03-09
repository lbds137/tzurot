/**
 * Audio Processor
 *
 * Processes audio (voice messages, audio files) to extract text transcriptions.
 * Primary path: ElevenLabs STT (when BYOK key available).
 * Fallback: self-hosted voice-engine (Parakeet TDT) when VOICE_ENGINE_URL is set.
 * Includes Redis caching for faster repeated access.
 */

import { createLogger, TIMEOUTS, type AttachmentMetadata } from '@tzurot/common-types';
import { VoiceEngineError, getVoiceEngineClient } from '../voice/VoiceEngineClient.js';
import { elevenLabsSTT, ElevenLabsApiError } from '../voice/ElevenLabsClient.js';

const logger = createLogger('AudioProcessor');

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
      throw new Error(`Audio file download timed out after ${TIMEOUTS.AUDIO_FETCH}ms`, {
        cause: error,
      });
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

  try {
    const filename =
      attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'audio.ogg';

    const result = await voiceEngineClient.transcribe(
      Buffer.from(audioBuffer),
      filename,
      attachment.contentType
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
    if (error instanceof VoiceEngineError && error.isAuthError) {
      logger.error({ err: error }, 'Voice engine auth error — check VOICE_ENGINE_API_KEY config');
    } else {
      logger.warn({ err: error }, 'Voice engine transcription failed');
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

    const result = await elevenLabsSTT({
      audioBuffer: Buffer.from(audioBuffer),
      filename,
      contentType: attachment.contentType,
      apiKey,
    });

    logger.info(
      { transcriptionLength: result.text.length, duration: attachment.duration },
      'Audio transcribed via ElevenLabs STT'
    );

    return result.text;
  } catch (error) {
    // Auth errors (401/403) are persistent config issues — log at error level
    if (error instanceof ElevenLabsApiError && error.isAuthError) {
      logger.error(
        { err: error, fallback: 'voice-engine' },
        'ElevenLabs STT auth error — falling back'
      );
    } else {
      logger.warn(
        { err: error, fallback: 'voice-engine' },
        '[FALLBACK] ElevenLabs STT failed — trying voice-engine'
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
