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
  /** Default temperature for LLM generation (0.0-2.0, higher = more creative) */
  TEMPERATURE: 0.7,
  /** Default maximum tokens for LLM responses */
  MAX_TOKENS: 4096,
  /** Temperature for vision models (lower = more deterministic) */
  VISION_TEMPERATURE: 0.3,
  /** Default language for Whisper transcription */
  WHISPER_LANGUAGE: 'en',
  /** Default memory score threshold for retrieval */
  MEMORY_SCORE_THRESHOLD: 0.15,
  /** Default number of memories to retrieve */
  MEMORY_LIMIT: 15,
  /** Default context window token budget (128k tokens) */
  CONTEXT_WINDOW_TOKENS: 131072,
  /** @deprecated Use CONTEXT_WINDOW_TOKENS instead. Legacy message-count limit. */
  HISTORY_LIMIT: 10,
  /**
   * Time buffer (in milliseconds) to prevent STM/LTM overlap
   * Excludes LTM memories within this time window of the oldest STM message
   * 10 seconds = 10000ms
   */
  STM_LTM_BUFFER_MS: 10000,
} as const;

/**
 * AI Provider API endpoints
 */
export const AI_ENDPOINTS = {
  /** OpenRouter API base URL */
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  /** OpenRouter model card base URL (for model info links) */
  OPENROUTER_MODEL_CARD_URL: 'https://openrouter.ai',
} as const;

/**
 * Timeouts, intervals, and retry configuration
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
  /** Short preview for personality cards (200 chars) */
  PERSONALITY_PREVIEW: 200,
  /** Medium preview for referenced messages (500 chars) */
  REFERENCE_PREVIEW: 500,
} as const;

/**
 * Discord API limits and constraints
 */
export const DISCORD_LIMITS = {
  /** Discord message content character limit */
  MESSAGE_LENGTH: 2000,
  /** Discord embed description character limit */
  EMBED_DESCRIPTION: 4096,
  /** Discord embed field value character limit */
  EMBED_FIELD: 1024,
  /** Maximum avatar file size (10MB) */
  AVATAR_SIZE: 10 * 1024 * 1024,
  /** Maximum webhook cache size */
  WEBHOOK_CACHE_SIZE: 100,
} as const;

/**
 * Discord brand colors (hex values)
 */
export const DISCORD_COLORS = {
  /** Discord Blurple (brand color) */
  BLURPLE: 0x5865f2,
  /** Success (green) */
  SUCCESS: 0x00ff00,
  /** Warning (orange) */
  WARNING: 0xffa500,
  /** Error (red) */
  ERROR: 0xff0000,
} as const;

/**
 * Network and service defaults
 */
export const SERVICE_DEFAULTS = {
  /** Default Redis port */
  REDIS_PORT: 6379,
  /** Default API gateway port */
  API_GATEWAY_PORT: 3000,
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
  Processing = 'processing',
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

/**
 * Job types for queue processing
 */
export enum JobType {
  Generate = 'generate',
  Transcribe = 'transcribe',
}

/**
 * Health check status values
 */
export enum HealthStatus {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Unhealthy = 'unhealthy',
  Ok = 'ok',
  Error = 'error',
}

/**
 * AI provider identifiers
 */
export enum AIProvider {
  OpenAI = 'openai',
  Gemini = 'gemini',
  Anthropic = 'anthropic',
  OpenRouter = 'openrouter',
  Local = 'local',
}

/**
 * Transient network error codes that should trigger retries
 */
export enum TransientErrorCode {
  /** Connection reset by peer */
  ECONNRESET = 'ECONNRESET',
  /** Connection timed out */
  ETIMEDOUT = 'ETIMEDOUT',
  /** DNS lookup failed */
  ENOTFOUND = 'ENOTFOUND',
  /** Connection refused */
  ECONNREFUSED = 'ECONNREFUSED',
  /** Request aborted */
  ABORTED = 'ABORTED',
}

/**
 * Error messages for LLM invocation failures
 */
export const ERROR_MESSAGES = {
  /** Error message when LLM returns empty response */
  EMPTY_RESPONSE: 'LLM returned empty response',
  /** Substring to detect empty response errors */
  EMPTY_RESPONSE_INDICATOR: 'empty response',
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
 * Common content type strings
 */
export const CONTENT_TYPES = {
  /** Image content type prefix */
  IMAGE_PREFIX: 'image/',
  /** Audio content type prefix */
  AUDIO_PREFIX: 'audio/',
  /** Default PNG image type */
  IMAGE_PNG: 'image/png',
  /** JSON content type */
  JSON: 'application/json',
  /** Binary octet stream (generic binary) */
  BINARY: 'application/octet-stream',
} as const;

/**
 * Default AI models
 */
export const DEFAULT_MODELS = {
  /** Default OpenAI embedding model */
  EMBEDDING: 'text-embedding-3-small',
} as const;

/**
 * Placeholder patterns for user and assistant names in prompts/memories
 * These are replaced with actual names at runtime
 */
export const PLACEHOLDERS = {
  /** User placeholders - all variations get replaced with the user's name */
  USER: ['{user}', '{{user}}'] as const,
  /** Assistant placeholders - all variations get replaced with the assistant/personality name */
  ASSISTANT: ['{assistant}', '{shape}', '{{char}}', '{personality}'] as const,
} as const;
