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
  type AudioTranscriptionJobData,
  type AudioTranscriptionResult,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { transcribeAudio } from '../services/MultimodalProcessor.js';

const logger = createLogger('AudioTranscriptionJob');

/**
 * Process audio transcription job
 */
export async function processAudioTranscriptionJob(
  job: Job<AudioTranscriptionJobData>
): Promise<AudioTranscriptionResult> {
  const startTime = Date.now();
  const { requestId, attachment } = job.data;

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
      !attachment.isVoiceMessage
    ) {
      throw new Error(
        `Invalid attachment type: ${attachment.contentType}. Expected audio.`
      );
    }

    // Transcribe the audio
    // Note: We don't need a real personality for transcription, just pass a minimal one
    const transcript = await transcribeAudio(attachment, {} as LoadedPersonality);

    const processingTimeMs = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        requestId,
        processingTimeMs,
        transcriptLength: transcript.length,
      },
      '[AudioTranscriptionJob] Audio transcription completed'
    );

    return {
      requestId,
      success: true,
      transcript,
      metadata: {
        processingTimeMs,
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
      metadata: {
        processingTimeMs,
        duration: attachment.duration,
      },
    };
  }
}
