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
 * Timeouts, intervals, and polling configuration
 */
export const TIMEOUTS = {
  /** Polling interval for gateway job status (1 second) */
  GATEWAY_POLL_INTERVAL: 1000,
  /** Maximum polling attempts before timeout (180 = 3 minutes) */
  GATEWAY_MAX_POLL_ATTEMPTS: 180,
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
  /** LLM API call timeout (3 minutes for long context generation) */
  LLM_API: 180000,
  /** Job wait timeout in gateway (4.5 minutes) */
  JOB_WAIT: 270000,
  /** Base timeout for job calculations (2 minutes) */
  JOB_BASE: 120000,
} as const;

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
