/**
 * Application Constants
 *
 * Non-environment configuration values used throughout the application.
 * These are compile-time constants that don't change between environments.
 */

/**
 * Media processing limits and quality settings
 */
export const MEDIA_LIMITS = {
  /** Maximum image size before resizing (10MB) */
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,
  /** Target size for resized images (8MB) */
  IMAGE_TARGET_SIZE: 8 * 1024 * 1024,
  /** JPEG quality for resized images (0-100) */
  IMAGE_QUALITY: 85,
} as const;

/**
 * AI model default configuration
 */
export const AI_DEFAULTS = {
  /** Temperature for vision models (lower = more deterministic) */
  VISION_TEMPERATURE: 0.3,
  /** Default language for Whisper transcription */
  WHISPER_LANGUAGE: 'en',
  /** Default memory score threshold for retrieval */
  MEMORY_SCORE_THRESHOLD: 0.15,
  /** Default number of memories to retrieve */
  MEMORY_LIMIT: 15,
  /** Default conversation history window size */
  CONTEXT_WINDOW: 20,
  /** Default conversation history limit */
  HISTORY_LIMIT: 10,
  /**
   * Time buffer (in milliseconds) to prevent STM/LTM overlap
   * Excludes LTM memories within this time window of the oldest STM message
   * 10 seconds = 10000ms
   */
  STM_LTM_BUFFER_MS: 10000,
} as const;

/**
 * Timeouts, intervals, and retry configuration
 */
export const TIMEOUTS = {
  /** Delay before retrying failed queue jobs (2 seconds) */
  QUEUE_RETRY_DELAY: 2000,
  /** Cache TTL for personality/user data (5 minutes) */
  CACHE_TTL: 5 * 60 * 1000,
  /** Vision model invocation timeout (30 seconds) */
  VISION_MODEL: 30000,
  /** Whisper transcription timeout (5 minutes for long audio files) */
  WHISPER_API: 300000,
  /** Audio file download timeout (2 minutes) */
  AUDIO_FETCH: 120000,
  /** LLM API call timeout per attempt (1 minute - allows retries within global timeout) */
  LLM_API: 60000,
  /** Job wait timeout in gateway (4.5 minutes) */
  JOB_WAIT: 270000,
  /** Base timeout for job calculations (2 minutes) */
  JOB_BASE: 120000,
} as const;

/**
 * Calculate job timeout based on number of images
 *
 * Images take longer to process (vision model calls), so we scale the timeout
 * based on image count. However, we cap it at JOB_WAIT to stay under Railway's
 * 5-minute request timeout.
 *
 * @param imageCount - Number of images in the request
 * @returns Timeout in milliseconds
 */
export function calculateJobTimeout(imageCount: number): number {
  // Base timeout: 2 minutes, scale by image count (minimum 1x)
  // Cap at 4.5 minutes to stay under Railway's 5-minute limit with buffer
  return Math.min(TIMEOUTS.JOB_WAIT, TIMEOUTS.JOB_BASE * Math.max(1, imageCount));
}

/**
 * Cache and cleanup intervals
 */
export const INTERVALS = {
  /** Webhook cache TTL (10 minutes) */
  WEBHOOK_CACHE_TTL: 10 * 60 * 1000,
  /** Webhook cache cleanup interval (1 minute) */
  WEBHOOK_CLEANUP: 60000,
  /** Request deduplication detection window (5 seconds) */
  REQUEST_DEDUP_WINDOW: 5000,
  /** Request deduplication cache cleanup interval (10 seconds) */
  REQUEST_DEDUP_CLEANUP: 10000,
  /** Attachment cleanup delay after job completion (5 seconds) */
  ATTACHMENT_CLEANUP_DELAY: 5000,
  /** Typing indicator refresh interval (8 seconds) */
  TYPING_INDICATOR_REFRESH: 8000,
  /** Default delay for embed processing in referenced messages (2.5 seconds) */
  EMBED_PROCESSING_DELAY: 2500,
  /** Message age window for deduplication checks (60 seconds) */
  MESSAGE_AGE_DEDUP_WINDOW: 60000,
  /** Timestamp tolerance for message deduplication (15 seconds) */
  MESSAGE_TIMESTAMP_TOLERANCE: 15000,
} as const;

/**
 * Buffer times for various operations
 */
export const BUFFERS = {
  /** STM/LTM overlap prevention buffer (10 seconds) */
  STM_LTM: 10000,
} as const;

/**
 * Queue configuration
 */
export const QUEUE_CONFIG = {
  /** Maximum number of completed jobs to keep in history */
  COMPLETED_HISTORY_LIMIT: 100,
  /** Maximum number of failed jobs to keep in history */
  FAILED_HISTORY_LIMIT: 500,
} as const;

/**
 * Retry configuration for transient errors
 */
export const RETRY_CONFIG = {
  /** Maximum retry attempts for transient LLM errors */
  LLM_MAX_RETRIES: 2,
  /** Base delay for exponential backoff (milliseconds) */
  LLM_RETRY_BASE_DELAY: 1000,
  /** Global timeout for all LLM retry attempts combined (2 minutes) */
  LLM_GLOBAL_TIMEOUT: 120000,
} as const;

/**
 * Text truncation and preview limits
 */
export const TEXT_LIMITS = {
  /** Characters for log message previews */
  LOG_PREVIEW: 150,
  /** Characters for persona preview in logs */
  LOG_PERSONA_PREVIEW: 100,
  /** Character limit before truncating full prompt in logs */
  LOG_FULL_PROMPT: 2000,
  /** Summary truncation in admin commands */
  ADMIN_SUMMARY_TRUNCATE: 1000,
  /** Discord embed field character limit */
  DISCORD_EMBED_FIELD: 1024,
} as const;

/**
 * Application-wide settings
 */
export const APP_SETTINGS = {
  /** Default timezone for timestamp formatting */
  TIMEZONE: 'America/New_York',
} as const;

/**
 * Message role types for conversation history
 */
export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
}

/**
 * Job status types for queue processing
 */
export enum JobStatus {
  Queued = 'queued',
  Completed = 'completed',
  Failed = 'failed',
}

/**
 * Attachment types for multimodal processing
 */
export enum AttachmentType {
  Image = 'image',
  Audio = 'audio',
}
