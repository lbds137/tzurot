/**
 * Queue Constants
 *
 * Job queue configuration, status, types, and prefixes.
 */

/**
 * Queue configuration
 */
export const QUEUE_CONFIG = {
  /** Maximum number of completed jobs to keep in history */
  COMPLETED_HISTORY_LIMIT: 100,
  /** Maximum number of failed jobs to keep in history */
  FAILED_HISTORY_LIMIT: 500,
  /** Maximum number of completed scheduled jobs to keep */
  SCHEDULED_COMPLETED_LIMIT: 10,
  /** Maximum number of failed scheduled jobs to keep */
  SCHEDULED_FAILED_LIMIT: 50,
} as const;

/**
 * Job ID prefixes for different job types
 */
export const JOB_PREFIXES = {
  /** Prefix for AI generation jobs */
  GENERATE: 'req-',
  /** Prefix for transcription-only jobs */
  TRANSCRIBE: 'transcribe-',
} as const;

/**
 * Job status types for queue processing
 */
export enum JobStatus {
  Queued = 'queued',
  Processing = 'processing',
  Completed = 'completed',
  Failed = 'failed',
}

/**
 * Job types for queue processing
 */
export enum JobType {
  Generate = 'generate',
  Transcribe = 'transcribe',
}
