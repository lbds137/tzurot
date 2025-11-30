/**
 * Audio Transcription Job Processor
 *
 * Handles audio transcription preprocessing jobs.
 * Extracts audio attachments and transcribes them using Whisper.
 * Results are stored in Redis for dependent jobs to consume.
 */

import { Job } from 'bullmq';
import {
  createLogger,
  CONTENT_TYPES,
  RETRY_CONFIG,
  type AudioTranscriptionJobData,
  type AudioTranscriptionResult,
  audioTranscriptionJobDataSchema,
} from '@tzurot/common-types';
import { transcribeAudio } from '../services/MultimodalProcessor.js';
import { withRetry } from '../utils/retryService.js';

const logger = createLogger('AudioTranscriptionJob');

/**
 * Process audio transcription job
 */
export async function processAudioTranscriptionJob(
  job: Job<AudioTranscriptionJobData>
): Promise<AudioTranscriptionResult> {
  const startTime = Date.now();

  // Validate job payload against schema (contract testing)
  const validation = audioTranscriptionJobDataSchema.safeParse(job.data);
  if (!validation.success) {
    logger.error(
      {
        jobId: job.id,
        errors: validation.error.format(),
      },
      '[AudioTranscriptionJob] Job validation failed'
    );
    throw new Error(`Audio transcription job validation failed: ${validation.error.message}`);
  }

  const { requestId, attachment, sourceReferenceNumber } = job.data;

  logger.info(
    {
      jobId: job.id,
      requestId,
      duration: attachment.duration,
      size: attachment.size,
    },
    '[AudioTranscriptionJob] Processing audio transcription job'
  );

  try {
    // Validate attachment
    if (
      !attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) &&
      attachment.isVoiceMessage !== true
    ) {
      throw new Error(`Invalid attachment type: ${attachment.contentType}. Expected audio.`);
    }

    // Transcribe the audio with retry logic (3 attempts)
    // Note: Personality is optional for transcription (not currently used by Whisper API)
    const result = await withRetry(() => transcribeAudio(attachment), {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: `Audio transcription (${attachment.name})`,
    });

    logger.info(
      {
        jobId: job.id,
        requestId,
        processingTimeMs: result.totalTimeMs,
        attempts: result.attempts,
        transcriptLength: result.value.length,
      },
      '[AudioTranscriptionJob] Audio transcription completed'
    );

    return {
      requestId,
      success: true,
      content: result.value,
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      sourceReferenceNumber,
      metadata: {
        processingTimeMs: result.totalTimeMs,
        duration: attachment.duration,
      },
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;

    logger.error(
      { err: error, jobId: job.id, requestId },
      '[AudioTranscriptionJob] Audio transcription failed'
    );

    return {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      sourceReferenceNumber,
      metadata: {
        processingTimeMs,
        duration: attachment.duration,
      },
    };
  }
}
