/**
 * Timing Constants
 *
 * Timeouts, intervals, retry configuration, and circuit breaker settings.
 */

/**
 * Timeouts for various operations
 */
export const TIMEOUTS = {
  /** Delay before retrying failed queue jobs (2 seconds) */
  QUEUE_RETRY_DELAY: 2000,
  /** Cache TTL for personality/user data (5 minutes) */
  CACHE_TTL: 5 * 60 * 1000,
  /** Vision model invocation timeout (45 seconds - increased for parallel batch processing) */
  VISION_MODEL: 45000,
  /** Whisper transcription timeout (90 seconds - realistic for voice messages) */
  WHISPER_API: 90000,
  /** Audio file download timeout (60 seconds) */
  AUDIO_FETCH: 60000,
  /** LLM API call timeout per attempt (90 seconds - increased for slow models) */
  LLM_API: 90000,
  /** Job wait timeout in gateway (4.5 minutes - Railway safety buffer) */
  JOB_WAIT: 270000,
  /** Base timeout for job calculations (2 minutes - minimum for any job) */
  JOB_BASE: 120000,
  /** System overhead for memory, DB, queue, network operations (15 seconds) */
  SYSTEM_OVERHEAD: 15000,
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
  /** Default delay for embed processing in referenced messages (2.5 seconds) */
  EMBED_PROCESSING_DELAY: 2500,
  /** Message age window for deduplication checks (60 seconds) */
  MESSAGE_AGE_DEDUP_WINDOW: 60000,
  /** Timestamp tolerance for message deduplication (15 seconds) */
  MESSAGE_TIMESTAMP_TOLERANCE: 15000,
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
  /** Default maximum retry attempts for generic retry operations */
  MAX_ATTEMPTS: 3,
  /** Initial delay before first retry (1 second) */
  INITIAL_DELAY_MS: 1000,
  /** Maximum delay between retries (10 seconds) */
  MAX_DELAY_MS: 10000,
  /** Default backoff multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
  /** Maximum Redis retry attempts before giving up */
  REDIS_MAX_RETRIES: 10,
  /** Base delay multiplier for Redis retries (milliseconds) */
  REDIS_RETRY_MULTIPLIER: 100,
  /** Maximum delay for Redis retries (3 seconds) */
  REDIS_MAX_DELAY: 3000,
  /** Max retries per Redis request */
  REDIS_RETRIES_PER_REQUEST: 3,
} as const;

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_BREAKER = {
  /** Time window for counting failures (30 seconds) */
  FAILURE_WINDOW: 30000,
  /** Time to wait before attempting recovery (60 seconds) */
  RECOVERY_TIMEOUT: 60000,
} as const;

/**
 * HTTP Cache-Control header values
 */
export const CACHE_CONTROL = {
  /** Cache duration for avatar images (7 days in seconds) */
  AVATAR_MAX_AGE: 604800,
} as const;
