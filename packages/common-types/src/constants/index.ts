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
  GUEST_MODE,
  isFreeModel,
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
  CLEANUP_DEFAULTS,
  SYNC_LIMITS,
  VALIDATION_TIMEOUTS,
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
  CHARACTER_VIEW_LIMITS,
  DISCORD_LIMITS,
  GATEWAY_TIMEOUTS,
  DISCORD_COLORS,
  DISCORD_MENTIONS,
  DISCORD_ID_PREFIX,
  DISCORD_SNOWFLAKE,
  DISCORD_PROVIDER_CHOICES,
  BOT_FOOTER_TEXT,
  BOT_FOOTER_PATTERNS,
  buildModelFooterText,
  isValidDiscordId,
  filterValidDiscordIds,
  buildDiscordPersonaId,
  extractDiscordId,
  type DiscordProviderChoice,
} from './discord.js';

// Error constants
export {
  TransientErrorCode,
  ERROR_NAMES,
  ERROR_MESSAGES,
  MAX_ERROR_MESSAGE_LENGTH,
  ApiErrorType,
  ApiErrorCategory,
  USER_ERROR_MESSAGES,
  HTTP_STATUS_TO_CATEGORY,
  PERMANENT_ERROR_CATEGORIES,
  TRANSIENT_ERROR_CATEGORIES,
  ERROR_SPOILER_PATTERN,
  generateErrorReferenceId,
  classifyHttpStatus,
  isPermanentError,
  isTransientError,
  formatErrorSpoiler,
  formatPersonalityErrorMessage,
  stripErrorSpoiler,
  type ApiErrorInfo,
} from './error.js';

// Media constants
export {
  MEDIA_LIMITS,
  AVATAR_LIMITS,
  CONTENT_TYPES,
  EMBED_NAMING,
  AttachmentType,
} from './media.js';

// Message constants
export {
  MessageRole,
  PLACEHOLDERS,
  MESSAGE_LIMITS,
  UNKNOWN_USER_DISCORD_ID,
  UNKNOWN_USER_NAME,
} from './message.js';

// Service constants
export {
  SERVICE_DEFAULTS,
  APP_SETTINGS,
  HealthStatus,
  UUID_REGEX,
  isValidUUID,
} from './service.js';

// Timezone constants
export {
  TIMEZONE_OPTIONS,
  TIMEZONE_DISCORD_CHOICES,
  isValidTimezone,
  getTimezoneInfo,
  type TimezoneOption,
} from './timezone.js';

// Wallet (BYOK) constants
export { WALLET_ERROR_MESSAGES, API_KEY_FORMATS, WALLET_SUCCESS_MESSAGES } from './wallet.js';
