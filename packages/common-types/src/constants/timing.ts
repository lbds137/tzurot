/**
 * Timing Constants
 *
 * Timeouts, intervals, retry configuration, and circuit breaker settings.
 */

/**
 * Timeouts for various operations
 *
 * IMPORTANT: Component timeouts are INDEPENDENT. Each component gets its full
 * timeout budget regardless of other components. Job timeout is the SUM of
 * component timeouts, not a zero-sum allocation.
 */
export const TIMEOUTS = {
  /** Delay before retrying failed queue jobs (2 seconds) */
  QUEUE_RETRY_DELAY: 2000,
  /** Cache TTL for personality/user data (5 minutes) */
  CACHE_TTL: 5 * 60 * 1000,
  /** Base job timeout for requests with no attachments (2 minutes) */
  JOB_BASE: 120000,

  // Individual component timeouts (PER ATTEMPT - with 3 retries via job chain)
  /** Vision model invocation timeout per attempt (90 seconds - handles slow models and high-res images) */
  VISION_MODEL: 90000,
  /** Whisper transcription timeout per attempt (180 seconds - handles long voice messages up to ~15 min) */
  WHISPER_API: 180000,
  /** Audio file download timeout (30 seconds - Discord CDN is fast) */
  AUDIO_FETCH: 30000,
  /** LLM invocation timeout for all retry attempts combined (8 minutes) */
  LLM_INVOCATION: 480000,
  /** LLM API call timeout per single attempt (3 minutes) */
  LLM_PER_ATTEMPT: 180000,

  /** System overhead for memory, DB, queue, network operations (15 seconds) */
  SYSTEM_OVERHEAD: 15000,
  /** Job wait timeout in gateway (10 minutes - Railway safety buffer) */
  JOB_WAIT: 600000,
  /** BullMQ worker lock duration - maximum time a job can run before being considered stalled (20 minutes - safety net for hung jobs) */
  WORKER_LOCK_DURATION: 20 * 60 * 1000,
} as const;

/**
 * Cache and cleanup intervals
 */
export const INTERVALS = {
  // Common time durations (in milliseconds)
  /** One hour in milliseconds (3,600,000ms) */
  ONE_HOUR_MS: 60 * 60 * 1000,

  /** API key cache TTL (10 seconds - balance between performance and responsiveness to key rotation) */
  API_KEY_CACHE_TTL: 10 * 1000,
  /** In-memory cache cleanup interval for expired entries (5 minutes) */
  CACHE_CLEANUP: 5 * 60 * 1000,
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
  /** Typing indicator refresh interval (8 seconds - Discord expires at 10s) */
  TYPING_INDICATOR_REFRESH: 8000,
  /** Job polling interval for synchronous-style waiting (1 second) */
  JOB_POLL_INTERVAL: 1000,
  /** Default delay for embed processing in referenced messages (2.5 seconds) */
  EMBED_PROCESSING_DELAY: 2500,
  /** Message age window for deduplication checks (60 seconds) */
  MESSAGE_AGE_DEDUP_WINDOW: 60000,
  /** Timestamp tolerance for message deduplication (15 seconds) */
  MESSAGE_TIMESTAMP_TOLERANCE: 15000,
  /** Webhook message tracking TTL in Redis (7 days in seconds) */
  WEBHOOK_MESSAGE_TTL: 7 * 24 * 60 * 60,
  /** Voice transcript cache TTL in Redis (5 minutes in seconds) */
  VOICE_TRANSCRIPT_TTL: 5 * 60,
  /** Vision description cache TTL in Redis (1 hour in seconds - image URLs are stable for a while) */
  VISION_DESCRIPTION_TTL: 60 * 60,
  /** Vision failure cache TTL for transient errors (10 minutes - cooldown before retry) */
  VISION_FAILURE_TTL: 10 * 60,
  /** Vision failure cache TTL for permanent errors (1 hour - longer cooldown, L2 is source of truth) */
  VISION_FAILURE_PERMANENT_TTL: 60 * 60,
  /** OpenRouter models cache TTL in Redis (24 hours in seconds) */
  OPENROUTER_MODELS_TTL: 24 * 60 * 60,
} as const;

/**
 * Redis connection configuration
 */
export const REDIS_CONNECTION = {
  /** Time to establish Redis connection (20 seconds - increased for Railway latency) */
  CONNECT_TIMEOUT: 20000,
  /** Timeout for Redis command execution (30 seconds - for slow Railway Redis) */
  COMMAND_TIMEOUT: 30000,
  /** TCP keepalive interval (30 seconds) */
  KEEPALIVE: 30000,
} as const;

/**
 * Database notification listener reconnection configuration
 */
export const DATABASE_RECONNECT = {
  /** Initial reconnection delay (1 second) */
  INITIAL_DELAY: 1000,
  /** Maximum reconnection delay (1 minute) */
  MAX_DELAY: 60000,
  /** Maximum reconnection attempts before giving up */
  MAX_ATTEMPTS: 20,
  /** Exponential backoff multiplier (2^attempt) */
  BACKOFF_MULTIPLIER: 2,
} as const;

/**
 * Retry configuration for transient errors
 *
 * IMPORTANT: All components use MAX_ATTEMPTS: 3 (1 initial + 2 retries) for consistency.
 * Component-specific timeouts are in TIMEOUTS section.
 */
export const RETRY_CONFIG = {
  /** Standard retry attempts for ALL components (1 initial + 2 retries = 3 total attempts) */
  MAX_ATTEMPTS: 3,
  /** Initial delay before first retry (1 second) */
  INITIAL_DELAY_MS: 1000,
  /** Maximum delay between retries (10 seconds) */
  MAX_DELAY_MS: 10000,
  /** Backoff multiplier for exponential backoff (2^attempt) */
  BACKOFF_MULTIPLIER: 2,

  // Redis-specific retry configuration
  /** Maximum Redis retry attempts before giving up */
  REDIS_MAX_RETRIES: 10,
  /** Base delay multiplier for Redis retries (milliseconds) */
  REDIS_RETRY_MULTIPLIER: 100,
  /** Maximum delay for Redis retries (3 seconds) */
  REDIS_MAX_DELAY: 3000,
  /** Max retries per Redis request for direct Redis clients (BullMQ uses null instead) */
  REDIS_RETRIES_PER_REQUEST: 3,
} as const;

/**
 * HTTP Cache-Control header values
 */
export const CACHE_CONTROL = {
  /** Cache duration for avatar images (7 days in seconds) */
  AVATAR_MAX_AGE: 604800,
} as const;

/**
 * Cleanup defaults for database maintenance
 *
 * These values are used for scheduled cleanup of old data to prevent
 * unbounded growth while preserving recent history for context.
 */
export const CLEANUP_DEFAULTS = {
  /** Default days to keep conversation history before cleanup (30 days) */
  DAYS_TO_KEEP_HISTORY: 30,
  /**
   * Default days to keep tombstones before cleanup (30 days)
   * Tombstones only need to exist long enough for db-sync to propagate deletions
   */
  DAYS_TO_KEEP_TOMBSTONES: 30,
  /** Minimum allowed days to keep (1 day) */
  MIN_DAYS: 1,
  /** Maximum allowed days to keep (365 days) */
  MAX_DAYS: 365,
} as const;

/**
 * Database sync and retention batch processing limits
 *
 * These values are used to bound database queries and prevent OOM errors
 * when processing large datasets during cleanup and sync operations.
 */
export const SYNC_LIMITS = {
  /** Batch size for retention cleanup operations (prevents OOM on large deletes) */
  RETENTION_BATCH_SIZE: 1000,
  /** Maximum messages to fetch when looking up by Discord IDs */
  MAX_DISCORD_ID_LOOKUP: 500,
  /** Default limit for time window queries in sync operations */
  DEFAULT_TIME_WINDOW_LIMIT: 200,
  /** Maximum messages to fetch/delete in a single batch operation */
  MAX_MESSAGE_BATCH: 1000,
  /** Maximum personalities to load from database catalog */
  MAX_PERSONALITY_CATALOG: 1000,
  /** Maximum search results for personality lookup */
  MAX_PERSONALITY_SEARCH: 100,
} as const;

/**
 * External API validation timeouts
 */
export const VALIDATION_TIMEOUTS = {
  /** Timeout for API key validation requests (30 seconds - allows for slow networks and provider load) */
  API_KEY_VALIDATION: 30000,
} as const;

/**
 * Test configuration timeouts
 */
export const TEST_TIMEOUTS = {
  /** Integration test timeout (30 seconds - allows for database/Redis operations) */
  INTEGRATION_TEST: 30000,
  /** Integration test hook timeout (30 seconds - matches test timeout) */
  INTEGRATION_HOOK: 30000,
} as const;
