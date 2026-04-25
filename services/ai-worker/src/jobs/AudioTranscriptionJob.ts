/**
 * Audio Transcription Job Processor
 *
 * Handles audio transcription preprocessing jobs.
 * Extracts audio attachments and transcribes them using available STT providers.
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
import { transcribeAudio } from '../services/multimodal/AudioProcessor.js';
import { withRetry } from '../utils/retry.js';
import { checkQueueAge } from '../utils/jobAgeGate.js';

const logger = createLogger('AudioTranscriptionJob');

/**
 * Process audio transcription job
 *
 * @param job - BullMQ job with audio transcription data
 * @param elevenlabsApiKey - Optional ElevenLabs BYOK key for premium STT
 */
export async function processAudioTranscriptionJob(
  job: Job<AudioTranscriptionJobData>,
  elevenlabsApiKey?: string
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
      'Job validation failed'
    );
    throw new Error(`Audio transcription job validation failed: ${validation.error.message}`);
  }

  const { requestId, attachment, sourceReferenceNumber } = validation.data;

  // Queue-age gate: fail fast with a classified ExpiredJobError if this job
  // sat in the queue long enough that its Discord CDN URL has likely expired.
  // Without this, an expired URL would surface as an opaque HTTP 403 inside
  // AudioProcessor.fetchAudioBuffer, indistinguishable from "voice engine
  // unreachable" in dashboards. The LLM generation pipeline has the same
  // guard in DownloadAttachmentsStep; this keeps the two job families
  // consistent.
  checkQueueAge(job, logger);

  logger.info(
    {
      jobId: job.id,
      requestId,
      duration: attachment.duration,
      size: attachment.size,
    },
    'Processing audio transcription job'
  );

  try {
    // Validate attachment
    if (
      !attachment.contentType.startsWith(CONTENT_TYPES.AUDIO_PREFIX) &&
      attachment.isVoiceMessage !== true
    ) {
      throw new Error(`Invalid attachment type: ${attachment.contentType}. Expected audio.`);
    }

    // Transcribe the audio with retry logic (3 attempts).
    // Config errors ("No STT provider available") are non-retryable — fast-fail
    // instead of wasting ~30s on guaranteed-identical failures.
    const result = await withRetry(() => transcribeAudio(attachment, elevenlabsApiKey), {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      shouldRetry: err =>
        !(err instanceof Error && err.message.startsWith('No STT provider available')),
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
      'Audio transcription completed'
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

    logger.error({ err: error, jobId: job.id, requestId }, 'Audio transcription failed');

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
