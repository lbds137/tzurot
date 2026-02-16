/**
 * Audio Processor
 *
 * Processes audio (voice messages, audio files) to extract text transcriptions
 * using OpenAI's Whisper model. Includes Redis caching for faster repeated access.
 */

import {
  createLogger,
  getConfig,
  TIMEOUTS,
  AI_DEFAULTS,
  TEXT_LIMITS,
  type AttachmentMetadata,
  type LoadedPersonality,
} from '@tzurot/common-types';
import OpenAI from 'openai';

const logger = createLogger('AudioProcessor');
const config = getConfig();

/**
 * Transcribe audio (voice message or audio file) using Whisper
 * Throws errors to allow retry logic to handle them
 *
 * @param attachment - Audio attachment to transcribe
 * @param _personality - (Optional) Personality context (not currently used for transcription)
 */
export async function transcribeAudio(
  attachment: AttachmentMetadata,
  _personality?: LoadedPersonality
): Promise<string> {
  // Check Redis cache first (if originalUrl is available)
  if (attachment.originalUrl !== undefined && attachment.originalUrl.length > 0) {
    try {
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

  logger.info(
    {
      url: attachment.url,
      originalUrl: attachment.originalUrl,
      duration: attachment.duration,
      contentType: attachment.contentType,
    },
    'Transcribing audio with Whisper (no cache)'
  );

  // Initialize OpenAI client for Whisper with extended timeout for long audio files
  const openai = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    timeout: TIMEOUTS.WHISPER_API, // 3 minutes per attempt (handles ~15 min voice messages)
  });

  // Fetch the audio file with timeout
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), TIMEOUTS.AUDIO_FETCH);

  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    clearTimeout(fetchTimeout);

    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    // Convert to buffer and create File object
    const audioBuffer = await response.arrayBuffer();
    const blob = new Blob([audioBuffer], { type: attachment.contentType });
    const audioFile = new File(
      [blob],
      attachment.name !== undefined && attachment.name.length > 0 ? attachment.name : 'audio.ogg',
      {
        type: attachment.contentType,
      }
    );

    // Transcribe using Whisper (with 5-minute timeout from OpenAI client config)
    logger.info(
      {
        fileSize: audioFile.size,
        duration: attachment.duration,
      },
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
      'Audio transcribed successfully'
    );

    return transcription;
  } catch (error) {
    clearTimeout(fetchTimeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Audio file download timed out after ${TIMEOUTS.AUDIO_FETCH}ms`, {
        cause: error,
      });
    }
    throw error;
  }
}
