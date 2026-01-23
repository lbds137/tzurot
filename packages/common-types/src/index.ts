// Export config (runtime environment variables)
export * from './config/index.js';

// Export constants (compile-time constants)
export * from './constants/index.js';

// Export types
export * from './types/ai.js';
export * from './types/byok.js';
export * from './types/diagnostic.js';
export * from './types/incognito.js';

// Export schemas
export * from './schemas/index.js';
export * from './types/api-types.js';
export * from './types/discord.js';
export * from './types/discord-types.js';
export * from './types/jobs.js';
export * from './types/schemas.js';

// Export utilities
export { splitMessage, truncateText, stripBotFooters } from './utils/discord.js';
export { createLogger } from './utils/logger.js';
export {
  parseRedisUrl,
  createRedisSocketConfig,
  createBullMQRedisConfig,
  type RedisConnectionConfig,
  type RedisSocketConfig,
  type BullMQRedisConfig,
} from './utils/redis.js';
export {
  CircuitBreaker,
  type CircuitState,
  type CircuitBreakerOptions,
} from './utils/CircuitBreaker.js';
export * from './utils/dateFormatting.js';
export * from './utils/timeout.js';
export * from './utils/deterministicUuid.js';
export * from './utils/tokenCounter.js';
export * from './utils/textChunker.js';
export {
  Duration,
  DurationParseError,
  type DurationBounds,
  type DurationValidation,
} from './utils/Duration.js';
export {
  shouldShowGap,
  calculateTimeGap,
  formatTimeGap,
  formatTimeGapMarker,
  DEFAULT_TIME_GAP_CONFIG,
  type TimeGapConfig,
} from './utils/timeGap.js';
export { isBotOwner, requireBotOwner } from './utils/ownerMiddleware.js';
export {
  computePersonalityPermissions,
  computeLlmConfigPermissions,
  computePersonaPermissions,
  type EntityPermissions,
} from './utils/permissions.js';
export { TTLCache, type TTLCacheOptions } from './utils/TTLCache.js';
export { assertDefined, assertNotNull, assertExists } from './utils/typeGuards.js';
export {
  encryptApiKey,
  decryptApiKey,
  isValidEncryptedData,
  type EncryptedData,
} from './utils/encryption.js';
export {
  sanitizeLogMessage,
  sanitizeObject,
  createSanitizedSerializers,
  sanitizeLogHook,
} from './utils/logSanitizer.js';
export { escapeXmlContent, containsXmlTags } from './utils/promptSanitizer.js';
export {
  escapeXml,
  xml,
  xmlAttrs,
  xmlElement,
  xmlSelfClosing,
  XML_TAGS,
} from './utils/xmlBuilder.js';
export {
  normalizeRole,
  isRoleMatch,
  normalizeTimestamp,
  extractTimestampMs,
  normalizeConversationMessage,
  normalizeConversationHistory,
  type LooseConversationMessage,
  type NormalizedConversationMessage,
} from './utils/messageNormalization.js';

// Export services
export * from './services/prisma.js';
export * from './services/personality/index.js';
export * from './services/LlmConfigMapper.js';
export * from './services/ConversationHistoryService.js';
export * from './services/ConversationRetentionService.js';
export * from './services/ConversationSyncService.js';
export * from './services/UserService.js';
export * from './services/BaseCacheInvalidationService.js';
export * from './services/CacheInvalidationService.js';
export * from './services/ApiKeyCacheInvalidationService.js';
export * from './services/LlmConfigCacheInvalidationService.js';
export * from './services/PersonaCacheInvalidationService.js';
export * from './services/ChannelActivationCacheInvalidationService.js';
export { VoiceTranscriptCache } from './services/VoiceTranscriptCache.js';
export {
  VisionDescriptionCache,
  type VisionCacheKeyOptions,
  type VisionStoreOptions,
} from './services/VisionDescriptionCache.js';
export {
  PersistentVisionCache,
  type PersistentVisionCacheEntry,
} from './services/PersistentVisionCache.js';

// Export resolvers (cascading configuration resolution)
export * from './services/resolvers/index.js';

// Export factories (validated mock helpers for testing)
// Use these instead of manually constructing API response mocks
export * from './factories/index.js';
