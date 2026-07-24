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

  // Individual component timeouts (PER ATTEMPT - with 3 retries via job chain)
  /** Vision model invocation timeout per attempt (90 seconds - handles slow models and high-res images) */
  VISION_MODEL: 90000,
  /** Voice engine / STT transcription budget per call (8 minutes).
   * The voice-engine chunks audio longer than its chunk threshold into windows
   * (see server.py STT_CHUNK_*), so this covers a chunked transcription up to the
   * ~12-min cap (MAX_AUDIO_DURATION_SEC) on Railway CPU. NeMo Parakeet runs ~0.5×
   * realtime on CPU; a 6-min single blob took ~213s in prod and blew the prior 180s
   * value. Conservative — tune down from the `inference_sec` / `rtf` fields the
   * voice-engine logs per transcription. Also the default per-call HTTP timeout for
   * VoiceEngineClient, so it applies to TTS too (a generous max, harmless there). */
  VOICE_ENGINE_API: 480000,
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
  /** Client-side (bot-client) timeout for STT transcription gateway requests (9 min).
   * Must exceed AUDIO_FETCH (30s) + VOICE_ENGINE_API (480s) + a queue/network
   * margin — otherwise the bot-client AbortSignal fires while ai-worker is still
   * mid-call. 540s = 30 + 480 + 30s margin. Stays under JOB_WAIT (10 min) so the
   * gateway keeps the job alive (and caches the transcript) slightly longer than the
   * bot waits — on a real hang the bot still surfaces "taking too long" first.
   * Conservative for the ~12-min audio cap; tune alongside VOICE_ENGINE_API from prod
   * logs. NOTE: a first-message Railway-serverless cold-start (~135s) stacks on top of
   * the transcription and can clip this for a long first message — the keep-warm
   * backlog item addresses that. Bump if AUDIO_FETCH or VOICE_ENGINE_API change. */
  STT_GATEWAY: 540_000,
  /** BullMQ worker lock duration — dead-process detection latency, NOT max job
   * runtime. Workers auto-renew every active job's lock on a lockDuration/4
   * cadence, so a live process holds a job indefinitely (long vision/STT jobs
   * never stall), and a hung-but-alive worker renews forever — in-process job
   * timeouts (calculateJobTimeout → MAX_JOB_RUNTIME) are the hung-job defense,
   * not this. The lock only expires when the process DIES (deploy, crash, OOM);
   * the stalled checker then re-queues the job for a real re-run
   * (maxStalledCount 1). 5 min bounds orphan invisibility at ~6 min (expiry +
   * stall sweep) while tolerating minutes of event-loop or Redis stall without
   * false positives (BullMQ's own default is 30 s). */
  WORKER_LOCK_DURATION: 5 * 60 * 1000,
  /** Ceiling for in-process job timeouts (the calculateJobTimeout clamp) — the
   * true "max job runtime" safety net for a LIVE job. Formerly conflated with
   * WORKER_LOCK_DURATION; lock renewal makes the two independent: the lock
   * detects dead processes, this cap bounds how long a live job may run. */
  MAX_JOB_RUNTIME: 20 * 60 * 1000,
  /** Default timeout for bot-client → api-gateway internal RPC calls (5 s).
   * Covers small JSON request/response shapes (channel lookups, session
   * writes, confirm-delivery acks, settings reads, diagnostic patches).
   * Short enough that a hung gateway surfaces quickly; long enough to
   * cover Railway internal-network latency under normal load. */
  GATEWAY_RPC: 5_000,
  /** Timeout for bot-client → api-gateway bulk-payload reads (10 s).
   * Used for endpoints that return larger payloads — currently the
   * denylist cache bootstrap. Distinct from GATEWAY_RPC because the
   * payload size and parse time are meaningfully larger. */
  GATEWAY_BULK_FETCH: 10_000,
  /** Timeout for bot-client → api-gateway `/ai/generate` job submission (60 s).
   * Long outlier because api-gateway currently downloads all extended-context
   * attachments synchronously inside the handler before responding; response
   * time scales with attachment payload size. Observed prod cases of
   * 12-attachment requests (~several MB total) taking >10 s. Structural
   * fix (move downloads to ai-worker lazy-load) tracked in backlog. */
  AI_GENERATE_SUBMIT: 60_000,
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
  /** Default delay for embed processing in referenced messages (2.5 seconds) */
  EMBED_PROCESSING_DELAY: 2500,
  /** Message age window for deduplication checks (60 seconds) */
  MESSAGE_AGE_DEDUP_WINDOW: 60000,
  /** Timestamp tolerance for message deduplication (15 seconds) */
  MESSAGE_TIMESTAMP_TOLERANCE: 15000,
  /** Webhook message tracking TTL in Redis (7 days in seconds) */
  WEBHOOK_MESSAGE_TTL: 7 * 24 * 60 * 60,
  /**
   * Voice transcript cache TTL in Redis (1 hour in seconds). Matches
   * VISION_DESCRIPTION_TTL: the cache key is derived from the immutable
   * attachment id / query-stripped CDN path (see `deriveAttachmentCacheKey`),
   * so a transcript stays valid as long as the attachment exists — a generous
   * TTL is pure upside and the value is a small string. Re-derivation for
   * aged-out extended-context voice no longer depends on this cache (the worker
   * falls back to the DB row), so this is a hot-path optimization, not a
   * correctness dependency.
   */
  VOICE_TRANSCRIPT_TTL: 60 * 60,
  /** Vision description cache TTL in Redis (1 hour in seconds - image URLs are stable for a while) */
  VISION_DESCRIPTION_TTL: 60 * 60,
  /**
   * Vision failure cache TTLs (L1 Redis only — no L2 PostgreSQL persistence).
   *
   * Per-category lookup lives in `VISION_FAILURE_CACHE_POLICY` in `error.ts`.
   * These three TTLs cover the spectrum:
   *
   * - SHORT (5 min) — categories that fail-fast on retry but whose underlying state
   *   may change (auth glitches, quota resets). Caching too long would freeze a
   *   transient OpenRouter blip into permanent broken-vision for an attachment.
   * - LONG (60 min) — categories bound to attachment properties that won't change
   *   mid-conversation (content policy, dead URL, missing model).
   * - DEFAULT (10 min) — generic retryable-transient cooldown to avoid re-hammering
   *   the upstream during an outage; matches the prior `VISION_FAILURE_TTL`.
   */
  VISION_FAILURE_TTL_SHORT: 5 * 60,
  VISION_FAILURE_TTL: 10 * 60,
  VISION_FAILURE_TTL_LONG: 60 * 60,
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
   * Default grace period (days) a soft-deleted conversation_history row
   * survives before it is hard-deleted (cleanupSoftDeletedMessages).
   */
  DAYS_TO_KEEP_SOFT_DELETED: 30,
  /**
   * Days to keep HANDLED feedback (status read/archived). Untriaged rows
   * (status 'new') are never purged — the owner hasn't seen them yet.
   */
  DAYS_TO_KEEP_HANDLED_FEEDBACK: 90,
  /**
   * Days to keep SETTLED release-delivery ledger rows. Standing-DM rows
   * (sent, not yet deleted) and pending rows are never purged — the former
   * back /notifications cleanup and delete-previous; the latter belong to
   * the incomplete-broadcast sweep, not retention.
   */
  DAYS_TO_KEEP_SETTLED_DELIVERIES: 90,
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
 * External API timeouts for audio-provider operations
 */
export const VALIDATION_TIMEOUTS = {
  /** Timeout for API key validation requests (30 seconds - allows for slow networks and provider load) */
  API_KEY_VALIDATION: 30_000,
  /** Timeout for audio-provider API calls (voice list/get/delete) across both
   *  ElevenLabs and Mistral. 30 seconds covers slow networks and burst load
   *  on either provider's voices endpoints. */
  EXTERNAL_AUDIO_API_CALL: 30_000,
  /** Timeout for the shapes.inc catalog fetch (`GET /shapes`). Shorter than the
   *  others because the shapes list endpoint is a simple read, not an inference
   *  or auth round-trip. Shared so the route's `externalCallBudgetMs` and the
   *  handler's AbortController reference one value. */
  EXTERNAL_SHAPES_API_CALL: 15_000,
  /** Timeout for the GitHub releases-list fetch in the reconcile sweep — a
   *  single-page JSON read against api.github.com. Shared so the internal
   *  route's `externalCallBudgetMs` and the fetcher's AbortController
   *  reference one value. */
  EXTERNAL_GITHUB_API_CALL: 10_000,
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
