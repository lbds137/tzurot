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
  MODEL_SLOTS,
  DEFAULT_MODEL_SLOT,
  toModelSlot,
  CONFIG_SLOT_OPTION_DESCRIPTION,
  TTS_VOICE_NAME_PREFIX,
  AIProvider,
  GUEST_MODE,
  isFreeModel,
  ZAI_VALIDATION_MODEL,
  ZAI_MODEL_PREFIX,
  isZaiCodingPlanModel,
  getZaiCodingPlanContextLength,
  zaiCodingPlanModelCapabilities,
  listZaiCodingPlanModels,
  buildModelInfoUrl,
  CONFIG_NAME_MAX_LENGTH,
} from './ai.js';
export type { ZaiCodingPlanModelInfo, ModelSlot } from './ai.js';

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
  DISCORD_PROVIDER_CHOICES,
  DISCORD_SNOWFLAKE,
  BOT_FOOTER_TEXT,
  buildModelFooterText,
  isValidDiscordId,
  filterValidDiscordIds,
} from './discord.js';

// Error constants
export {
  TransientErrorCode,
  isTransientNetworkError,
  ERROR_MESSAGES,
  MAX_ERROR_MESSAGE_LENGTH,
  ApiErrorType,
  ApiErrorCategory,
  QUOTA_FALLBACK_CATEGORIES,
  type QuotaFallbackCategoryValue,
  USER_ERROR_MESSAGES,
  VISION_FAILURE_CACHE_POLICY,
  generateErrorReferenceId,
  classifyHttpStatus,
  isPermanentError,
  formatErrorSpoiler,
  formatPersonalityErrorMessage,
  stripErrorSpoiler,
  wrapUrlsForNoEmbed,
  API_ERROR_SUBCODE,
  type ApiErrorSubcode,
} from './error.js';

// Media constants
export {
  MEDIA_LIMITS,
  AVATAR_LIMITS,
  VOICE_REFERENCE_LIMITS,
  CONTENT_TYPES,
  EMBED_NAMING,
  AttachmentType,
} from './media.js';

// Message constants
export {
  MessageRole,
  PLACEHOLDERS,
  MESSAGE_LIMITS,
  MULTI_TAG,
  NO_TEXT_CONTENT_PLACEHOLDER,
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

// Memory constants
export { MEMORY_NAMESPACE, hashContent, deterministicMemoryUuid } from './memory.js';

// Wallet (BYOK) constants
export { WALLET_ERROR_MESSAGES, API_KEY_FORMATS } from './wallet.js';

// Persona constants
export { DEFAULT_PERSONA_DESCRIPTION } from './persona.js';

// Redis cache-key prefixes (shared by services and ops tooling)
export { CACHE_KEY_PREFIXES } from './redis-keys.js';

// Release-notes section names with notification-level semantics
// (shared between the notes generator and the broadcast classifier)
export { RELEASE_LEVEL_SECTIONS } from './releaseNotes.js';

// Persona-ID placeholder prefix (pre-resolution extended-context records)
export { INTERNAL_DISCORD_ID_PREFIX } from './personaId.js';

// Known message-proxy application IDs (PluralKit/TupperBox) for authorship classification
export { KNOWN_PROXY_APP_IDS } from './proxyBots.js';

// UX vocabulary registry (entity emojis, badge legend words, display sentinels)
export {
  ENTITY_EMOJI,
  UX_SENTINELS,
  BADGE_LEGEND_WORDS,
  entityTitle,
  buildBadgeLegend,
  type UxEntityKind,
  type BadgeKey,
} from './uxVocabulary.js';
