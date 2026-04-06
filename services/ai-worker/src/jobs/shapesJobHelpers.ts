/**
 * Shared Shapes.inc Job Helpers
 *
 * Extracted from ShapesExportJob and ShapesImportJob to eliminate duplicated
 * error handling. Both jobs follow the same retry decision → log → re-throw
 * or mark-failed flow; only the DB model and result shape differ.
 */

import type { Job } from 'bullmq';
import { createLogger } from '@tzurot/common-types';
import { classifyShapesError } from './shapesCredentials.js';

const logger = createLogger('shapesJobHelpers');

const JOB_LABELS = {
  export: { label: 'ShapesExportJob', verb: 'Export' },
  import: { label: 'ShapesImportJob', verb: 'Import' },
} as const;

export interface ShapesJobErrorContext<TResult> {
  /** Which job type is reporting the error. */
  jobType: 'export' | 'import';
  /** The caught error. */
  error: unknown;
  /** The BullMQ job instance (for attempt tracking). */
  job: Job<unknown>;
  /** The job ID for logging. */
  jobId: string | undefined;
  /** The shapes.inc slug for logging. */
  sourceSlug: string;
  /** Persist the failure to the DB (called only when NOT retrying). */
  markFailed: (errorMessage: string) => Promise<void>;
  /** Build the typed failure result for the caller. */
  buildFailureResult: (errorMessage: string) => TResult;
}

/**
 * Shared error handler for shapes.inc export and import jobs.
 *
 * 1. Classifies the error as retryable or non-retryable
 * 2. Logs with structured context (attempt count, retry decision)
 * 3. Re-throws retryable errors for BullMQ retry (if attempts remain)
 * 4. Otherwise marks the DB record as failed and returns a failure result
 */
export async function handleShapesJobError<TResult>(
  ctx: ShapesJobErrorContext<TResult>
): Promise<TResult> {
  const { isRetryable, errorMessage } = classifyShapesError(ctx.error);
  const maxAttempts = ctx.job.opts.attempts ?? 1;
  const willRetry = isRetryable && ctx.job.attemptsMade < maxAttempts - 1;

  const { label, verb } = JOB_LABELS[ctx.jobType];

  const logMessage = willRetry
    ? `[${label}] Retryable error — BullMQ will retry`
    : isRetryable
      ? `[${label}] Retries exhausted — marking as failed`
      : `[${label}] ${verb} failed (non-retryable)`;

  logger.error(
    {
      err: ctx.error,
      jobId: ctx.jobId,
      sourceSlug: ctx.sourceSlug,
      errorType: ctx.error instanceof Error ? ctx.error.constructor.name : typeof ctx.error,
      attemptsMade: ctx.job.attemptsMade,
      maxAttempts,
      willRetry,
    },
    logMessage
  );

  // Re-throw retryable errors for BullMQ retry if attempts remain.
  // On the final attempt, fall through to mark the DB record as 'failed'
  // so users don't see a permanently stuck 'in_progress' status.
  if (willRetry) {
    throw ctx.error;
  }

  await ctx.markFailed(errorMessage);
  return ctx.buildFailureResult(errorMessage);
}
