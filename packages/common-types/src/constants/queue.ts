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
 * Name of ai-worker's repeatable-cron queue (pending-memory processing,
 * cleanup jobs). Consumers: `ai-worker/index.ts` (queue + worker),
 * `tooling/deployment/maintenance.ts` (paused during destructive-migration
 * windows — its cron ticks hit Prisma and must not fire mid-migration).
 */
export const SCHEDULED_QUEUE_NAME = 'scheduled-jobs';

/**
 * Queue for async fact-extraction jobs (memory Phase 2). Worker-internal to
 * ai-worker (it both enqueues and consumes); separate from the main AI queue
 * so background extraction never competes with user-facing generation
 * concurrency, and the kill switch can stop the worker cleanly.
 */
export const FACT_EXTRACTION_QUEUE_NAME = 'fact-extraction';

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
  /** Prefix for shapes.inc import jobs */
  SHAPES_IMPORT: 'shapes-import-',
  /** Prefix for shapes.inc export jobs */
  SHAPES_EXPORT: 'shapes-export-',
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
  /**
   * Prefix for the model-AGNOSTIC "best available" vision description (two-tier
   * cache). Every consumer reads this, so a free-tier user gets a description a
   * paid model already produced. Writes are tier-promoted (a weaker model can't
   * clobber a stronger model's description). Deliberately distinct from the
   * retired legacy per-model `vision:` prefix, whose entries just aged out.
   */
  VISION_CANONICAL: 'vision:canon:',
  /** Single-flight marker: a describe for this image is in flight — concurrent
   *  callers (multi-character fan-out) coalesce onto the winner's result. */
  VISION_INFLIGHT: 'vision:inflight:',
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
  /** Prefix for vision failure negative cache (prevents re-hammering failed images) */
  VISION_FAILURE: 'vision:fail:',
  /** Prefix for TTS audio buffer storage (binary, keyed by jobId) */
  TTS_AUDIO: 'tts-audio:',
  /** Prefix for multi-tag coordinator entries (keyed by groupId) */
  MULTI_TAG_ENTRY: 'multitag:entry:',
  /** Prefix for multi-tag jobId → groupId reverse index */
  MULTI_TAG_JOB_INDEX: 'multitag:job-index:',
  /** Prefix for multi-tag sourceMessageId → groupId index (dedupe/source lookup) */
  MULTI_TAG_SOURCE_INDEX: 'multitag:source-index:',
  /** SET of jobIds whose pre-restart results must be discarded on arrival */
  MULTI_TAG_STALE_JOBS: 'multitag:stale-jobids',
  /** Prefix for the DM "we already attempted history-scan backfill" sentinel */
  MULTI_TAG_DM_BACKFILL_TRIED: 'multitag:dm-backfill-tried:',
  /** Prefix for per-slot "already delivered" dedup marker (recovery skips dispatch when present) */
  MULTI_TAG_SLOT_DELIVERED: 'multitag:slot-delivered:',
  /**
   * Prefix for the synthetic-timeout recovery marker, keyed by jobId. Written
   * when the coordinator gives up on a slot and delivers a synthetic timeout;
   * value is JSON delivery context so a late-arriving real result can be sent
   * as a follow-up instead of dropped. TTL: MULTI_TAG.REDIS_TTL_SEC.
   */
  MULTI_TAG_SYNTHETIC_TIMEOUT: 'multitag:synthetic-timeout:',
  /**
   * Prefix for batch-delete preview tokens. Key: `memory:preview:{userId}:{token}`.
   * Value: JSON-encoded filter that produced the preview. TTL: 5 min.
   * Consumer: `api-gateway/MemoryActionTokenService`.
   */
  MEMORY_PREVIEW_TOKEN: 'memory:preview:',
  /**
   * Prefix for memory purge confirmation tokens. Key:
   * `memory:purge:{userId}:{token}`. Value: JSON-encoded `{ personalityId }`
   * binding. TTL: 5 min.
   * Consumer: `api-gateway/MemoryActionTokenService`.
   */
  MEMORY_PURGE_TOKEN: 'memory:purge:',
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
  /** Channel for broadcasting TTS config cache invalidation events across services */
  TTS_CONFIG_CACHE_INVALIDATION: 'cache:tts-config-invalidation',
  /** Channel for broadcasting persona cache invalidation events across services */
  PERSONA_CACHE_INVALIDATION: 'cache:persona-invalidation',
  /** Channel for broadcasting channel activation cache invalidation events across bot-client instances */
  CHANNEL_ACTIVATION_CACHE_INVALIDATION: 'cache:channel-activation-invalidation',
  /** Channel for broadcasting config cascade cache invalidation events across services */
  CONFIG_CASCADE_CACHE_INVALIDATION: 'cache:config-cascade-invalidation',
  /** Channel for broadcasting denylist cache invalidation events across bot-client instances */
  DENYLIST_CACHE_INVALIDATION: 'cache:denylist-invalidation',
  /** Channel for broadcasting STT resolver cache invalidation events across services */
  STT_RESOLVER_CACHE_INVALIDATION: 'cache:stt-resolver-invalidation',
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
  /** Shapes.inc character import job (personality + memories) */
  ShapesImport = 'shapes-import',
  /** Shapes.inc character data export job */
  ShapesExport = 'shapes-export',
  /** Async fact extraction from verbatim episodes (memory Phase 2) */
  FactExtraction = 'fact-extraction',
}
