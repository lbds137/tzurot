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
} as const;

/**
 * Application-wide settings
 */
export const APP_SETTINGS = {
  /** Default timezone for timestamp formatting */
  TIMEZONE: 'America/New_York',
} as const;
