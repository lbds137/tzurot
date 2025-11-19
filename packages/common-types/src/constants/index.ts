/**
 * Constants Barrel Export
 *
 * Re-exports all domain-separated constants from a single entry point.
 */

// AI constants
export {
  AI_DEFAULTS,
  AI_ENDPOINTS,
  MODEL_DEFAULTS,
  AIProvider,
  type DefaultModelName,
} from './ai.js';

// Timing constants
export {
  TIMEOUTS,
  INTERVALS,
  REDIS_CONNECTION,
  DATABASE_RECONNECT,
  RETRY_CONFIG,
  CIRCUIT_BREAKER,
  CACHE_CONTROL,
} from './timing.js';

// Queue constants
export {
  QUEUE_CONFIG,
  JOB_PREFIXES,
  JOB_REQUEST_SUFFIXES,
  REDIS_KEY_PREFIXES,
  REDIS_CHANNELS,
  JobStatus,
  JobType,
} from './queue.js';

// Discord constants
export {
  TEXT_LIMITS,
  DISCORD_LIMITS,
  DISCORD_COLORS,
} from './discord.js';

// Error constants
export {
  TransientErrorCode,
  ERROR_NAMES,
  ERROR_MESSAGES,
} from './error.js';

// Media constants
export {
  MEDIA_LIMITS,
  CONTENT_TYPES,
  EMBED_NAMING,
  AttachmentType,
} from './media.js';

// Message constants
export {
  MessageRole,
  PLACEHOLDERS,
} from './message.js';

// Service constants
export {
  SERVICE_DEFAULTS,
  APP_SETTINGS,
  HealthStatus,
} from './service.js';
