/**
 * Queue Constants
 *
 * Job queue configuration, status, types, and prefixes.
 */

/**
 * Queue configuration
 *
 * IMPORTANT: Jobs contain full conversation history (can be 50-100KB each).
 * Keep limits low to prevent Redis bloat, especially on Railway's shared instances.
 */
export const QUEUE_CONFIG = {
  /** Maximum number of completed jobs to keep in history (reduced from 100 to prevent Redis bloat) */
  COMPLETED_HISTORY_LIMIT: 10,
  /** Maximum number of failed jobs to keep in history (reduced from 500 to prevent Redis bloat) */
  FAILED_HISTORY_LIMIT: 50,
  /** Maximum number of completed scheduled jobs to keep */
  SCHEDULED_COMPLETED_LIMIT: 10,
  /** Maximum number of failed scheduled jobs to keep */
  SCHEDULED_FAILED_LIMIT: 50,
} as const;

/**
 * Job ID prefixes for different job types
 */
export const JOB_PREFIXES = {
  /** Prefix for LLM generation jobs */
  LLM_GENERATION: 'llm-',
  /** Prefix for audio transcription jobs */
  AUDIO_TRANSCRIPTION: 'audio-',
  /** Prefix for image description jobs */
  IMAGE_DESCRIPTION: 'image-',
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
 *
 * Job chain architecture:
 * - Preprocessing jobs (AudioTranscription, ImageDescription) run first
 * - LLMGeneration job depends on preprocessing results
 * - Each job has independent timeout and retry budget
 */
export enum JobType {
  /** Audio transcription preprocessing job */
  AudioTranscription = 'audio-transcription',
  /** Image description preprocessing job */
  ImageDescription = 'image-description',
  /** LLM generation job (may depend on preprocessing jobs) */
  LLMGeneration = 'llm-generation',
}
