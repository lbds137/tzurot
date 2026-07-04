/**
 * Audio Transcription Job Processor
 *
 * Handles audio transcription preprocessing jobs.
 * Extracts audio attachments and transcribes them using available STT providers.
 * Results are stored in Redis for dependent jobs to consume.
 */

import { type Job } from 'bullmq';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { RETRY_CONFIG } from '@tzurot/common-types/constants/timing';
import {
  type AudioTranscriptionJobData,
  type AudioTranscriptionResult,
  type SttFailureReason,
  audioTranscriptionJobDataSchema,
} from '@tzurot/common-types/types/jobs';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { isTimeoutError, isTooLongError } from '@tzurot/common-types/utils/errors';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { transcribeAudio } from '../services/multimodal/AudioProcessor.js';
import { withRetry, RetryError } from '../utils/retry.js';
import { checkQueueAge } from '../utils/jobAgeGate.js';

const logger = createLogger('AudioTranscriptionJob');

/**
 * Outer-retry eligibility for the transcription job. Three classes fast-fail —
 * re-running them just wastes time on a guaranteed-identical failure, and re-grinding
 * a timeout would blow the (now larger) budget up to 3×:
 *   - config errors ("No STT provider available") — no provider appears on retry
 *   - timeouts — audio too slow for the budget; a retry hits the same wall
 *   - too-long — a deterministic over-the-cap rejection
 * Everything else (transient network / 5xx) stays retryable.
 */
function isRetryableTranscriptionError(err: unknown): boolean {
  if (err instanceof Error && err.message.startsWith('No STT provider available')) {
    return false;
  }
  if (isTimeoutError(err) || isTooLongError(err)) {
    return false;
  }
  return true;
}

/**
 * Map a transcription failure's ROOT cause to the wire-level reason code carried in
 * the job result (Error instances can't survive the BullMQ/Redis boundary, so
 * bot-client reconstructs the right user message from this code).
 */
function classifyFailureReason(root: unknown): SttFailureReason {
  if (isTimeoutError(root)) {
    return 'timeout';
  }
  if (isTooLongError(root)) {
    return 'too_long';
  }
  if (root instanceof Error && root.message.startsWith('No STT provider available')) {
    return 'unavailable';
  }
  return 'other';
}

/**
 * Process audio transcription job
 *
 * @param job - BullMQ job with audio transcription data
 * @param sttOpts - Resolved STT provider + matching API key (caller should
 *   resolve via SttResolver.resolveProviderForTranscription, then fetch the
 *   key via ApiKeyResolver if the provider needs one)
 */
export async function processAudioTranscriptionJob(
  job: Job<AudioTranscriptionJobData>,
  sttOpts: SttDispatch
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
    const result = await withRetry(() => transcribeAudio(attachment, sttOpts), {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      shouldRetry: isRetryableTranscriptionError,
      logger,
      operationName: `Audio transcription (${attachment.name})`,
    });

    logger.info(
      {
        jobId: job.id,
        requestId,
        processingTimeMs: result.totalTimeMs,
        attempts: result.attempts,
        transcriptLength: result.value.text.length,
        requestedProvider: sttOpts.provider,
        actualProvider: result.value.actualProvider,
      },
      'Audio transcription completed'
    );

    return {
      requestId,
      success: true,
      content: result.value.text,
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      sourceReferenceNumber,
      // Report the provider that ACTUALLY produced the text. If a BYOK
      // provider was requested but fell through to voice-engine, attribution
      // must reflect voice-engine — reporting the requested provider over a
      // fallback transcript would misattribute voice-engine output as BYOK
      // output. Undefined (cache hit) → no badge rendered.
      ...(result.value.actualProvider !== undefined
        ? { provider: result.value.actualProvider }
        : {}),
      metadata: {
        processingTimeMs: result.totalTimeMs,
        duration: attachment.duration,
      },
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;

    // withRetry wraps the cause in a RetryError; unwrap to classify the root cause so
    // bot-client can render a precise message ("too long" / "taking too long") instead
    // of the generic failure.
    const root = error instanceof RetryError ? error.lastError : error;
    const failureReason = classifyFailureReason(root);

    logger.error(
      { err: error, jobId: job.id, requestId, failureReason },
      'Audio transcription failed'
    );

    return {
      requestId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      failureReason,
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
