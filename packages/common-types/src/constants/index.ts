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
} from './ai.js';

// Timing constants
export {
  TIMEOUTS,
  INTERVALS,
  REDIS_CONNECTION,
  DATABASE_RECONNECT,
  RETRY_CONFIG,
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
  DISCORD_PROVIDER_CHOICES,
  BOT_FOOTER_TEXT,
  buildModelFooterText,
  isValidDiscordId,
  filterValidDiscordIds,
} from './discord.js';

// Error constants
export {
  TransientErrorCode,
  ERROR_MESSAGES,
  MAX_ERROR_MESSAGE_LENGTH,
  ApiErrorType,
  ApiErrorCategory,
  USER_ERROR_MESSAGES,
  generateErrorReferenceId,
  classifyHttpStatus,
  isPermanentError,
  formatErrorSpoiler,
  formatPersonalityErrorMessage,
  stripErrorSpoiler,
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
} from './timezone.js';

// Finish reason constants
export {
  FINISH_REASONS,
  isNaturalStop,
  resolveFinishReason,
  type FinishReason,
} from './finishReasons.js';

// Wallet (BYOK) constants
export { WALLET_ERROR_MESSAGES, API_KEY_FORMATS } from './wallet.js';
