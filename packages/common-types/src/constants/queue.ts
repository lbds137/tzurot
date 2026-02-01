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
 * Request ID suffixes for preprocessing jobs
 */
export const JOB_REQUEST_SUFFIXES = {
  /** Suffix for audio transcription request IDs */
  AUDIO: '-audio',
  /** Suffix for image description request IDs */
  IMAGE: '-image',
} as const;

/**
 * Redis key prefixes for job data and bot state
 */
export const REDIS_KEY_PREFIXES = {
  /** Prefix for job result storage in Redis */
  JOB_RESULT: 'job-result:',
  /** Prefix for webhook message -> personality mapping */
  WEBHOOK_MESSAGE: 'webhook:',
  /** Prefix for voice transcript cache */
  VOICE_TRANSCRIPT: 'transcript:',
  /** Prefix for vision description cache (keyed by image URL) */
  VISION_DESCRIPTION: 'vision:',
  /** Key for OpenRouter models cache */
  OPENROUTER_MODELS: 'openrouter:models',
  /** Prefix for request deduplication cache */
  REQUEST_DEDUP: 'dedup:',
  /** Prefix for rate limiting counters */
  RATE_LIMIT: 'ratelimit:',
  /** Prefix for incognito mode sessions (memory writing disabled) */
  INCOGNITO: 'incognito:',
  /** Prefix for dashboard sessions (e.g., character editing) */
  SESSION: 'session:',
  /** Prefix for dashboard session message ID index (messageId -> sessionKey lookup) */
  SESSION_MSG_INDEX: 'session-msg:',
  /** Prefix for processed message idempotency check (prevents duplicate job processing) */
  PROCESSED_MESSAGE: 'processed:',
} as const;

/**
 * Redis pub/sub channels
 */
export const REDIS_CHANNELS = {
  /** Channel for broadcasting personality cache invalidation events across services */
  CACHE_INVALIDATION: 'cache:invalidation',
  /** Channel for broadcasting API key cache invalidation events across services */
  API_KEY_CACHE_INVALIDATION: 'cache:api-key-invalidation',
  /** Channel for broadcasting LLM config cache invalidation events across services */
  LLM_CONFIG_CACHE_INVALIDATION: 'cache:llm-config-invalidation',
  /** Channel for broadcasting persona cache invalidation events across services */
  PERSONA_CACHE_INVALIDATION: 'cache:persona-invalidation',
  /** Channel for broadcasting channel activation cache invalidation events across bot-client instances */
  CHANNEL_ACTIVATION_CACHE_INVALIDATION: 'cache:channel-activation-invalidation',
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
