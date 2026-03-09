/**
 * Audio Processor
 *
 * Processes audio (voice messages, audio files) to extract text transcriptions.
 * Primary path: self-hosted voice-engine (Parakeet TDT) when VOICE_ENGINE_URL is set.
 * Fallback: OpenAI Whisper when voice-engine is unavailable or unconfigured.
 * Includes Redis caching for faster repeated access.
 */

import {
  createLogger,
  getConfig,
  TIMEOUTS,
  AI_DEFAULTS,
  TEXT_LIMITS,
  type AttachmentMetadata,
} from '@tzurot/common-types';
import OpenAI from 'openai';
import { VoiceEngineError, getVoiceEngineClient } from '../voice/VoiceEngineClient.js';

const logger = createLogger('AudioProcessor');

// ---------------------------------------------------------------------------
// Lazy OpenAI singleton — avoids creating a new client per transcription
// ---------------------------------------------------------------------------
let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (_openaiClient !== null) {
    return _openaiClient;
  }
  const config = getConfig();
  _openaiClient = new OpenAI({ apiKey: config.OPENAI_API_KEY, timeout: TIMEOUTS.WHISPER_API });
  return _openaiClient;
}

/** Reset singleton for testing. */
export function resetOpenAIClient(): void {
  _openaiClient = null;
}

/**
 * Fetch audio from a URL with timeout, returning a Buffer.
 * Shared by both voice-engine and Whisper paths.
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

    // Empty string is a valid result (silent/inaudible audio) — don't fall back to Whisper
    return result.text;
  } catch (error) {
    // Auth errors (401/403) are persistent config issues — log at error level.
    // We still fall back to Whisper (intentional "always succeed" trade-off:
    // user gets a transcription even with misconfigured voice-engine, at the
    // cost of silent OpenAI API usage visible only in error logs).
    if (error instanceof VoiceEngineError && error.isAuthError) {
      logger.error(
        { err: error, voiceEngineFallback: true },
        'Voice engine auth error — check VOICE_ENGINE_API_KEY config'
      );
    } else {
      logger.warn(
        { err: error, voiceEngineFallback: true },
        '[FALLBACK] Voice engine unavailable — transcribing via Whisper'
      );
    }
    return null;
  }
}

/**
 * Transcribe audio using OpenAI Whisper (fallback path).
 */
async function transcribeWithWhisper(
  attachment: AttachmentMetadata,
  audioBuffer: ArrayBuffer
): Promise<string> {
  const config = getConfig();

  logger.info(
    {
      url: attachment.url,
      originalUrl: attachment.originalUrl,
      duration: attachment.duration,
      contentType: attachment.contentType,
    },
    'Transcribing audio with Whisper'
  );

  const openai = getOpenAIClient();

  const blob = new Blob([audioBuffer], { type: attachment.contentType });
  const audioFile = new File(
    [blob],
    attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'audio.ogg',
    { type: attachment.contentType }
  );

  logger.info(
    { fileSize: audioFile.size, duration: attachment.duration },
    'Starting Whisper transcription...'
  );

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: config.WHISPER_MODEL,
    language: AI_DEFAULTS.WHISPER_LANGUAGE,
    response_format: 'text',
  });

  logger.info(
    {
      duration: attachment.duration,
      transcriptionLength: transcription.length,
      transcriptionPreview:
        transcription.substring(0, TEXT_LIMITS.PERSONALITY_PREVIEW) +
        (transcription.length > TEXT_LIMITS.PERSONALITY_PREVIEW ? '...' : ''),
    },
    'Audio transcribed successfully via Whisper'
  );

  return transcription;
}

/**
 * Transcribe audio (voice message or audio file).
 * Tries voice-engine first (if configured), falls back to Whisper.
 * Empty string from voice-engine is returned as-is (silent/inaudible audio) —
 * only null (unconfigured or failed) triggers the Whisper fallback.
 * Throws errors to allow retry logic to handle them.
 *
 * @param attachment - Audio attachment to transcribe
 */
export async function transcribeAudio(attachment: AttachmentMetadata): Promise<string> {
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

  // Fetch audio once — shared by both voice-engine and Whisper paths
  const audioBuffer = await fetchAudioBuffer(attachment.url);

  // Try voice-engine first (returns null if unconfigured or failed)
  const voiceEngineResult = await transcribeWithVoiceEngine(attachment, audioBuffer);
  if (voiceEngineResult !== null) {
    return voiceEngineResult;
  }

  // Fallback to Whisper
  return transcribeWithWhisper(attachment, audioBuffer);
}
