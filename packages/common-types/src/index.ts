// Export config (runtime environment variables)
export * from './config/index.js';

// Export constants (compile-time constants)
export * from './constants/index.js';

// Export types
export * from './types/ai.js';
export * from './types/audio-provider.js';
export * from './types/configResolution.js';
export * from './types/personaResolution.js';
export * from './types/conversationMessage.js';
export * from './types/sttProvider.js';
export * from './types/diagnostic.js';
export * from './types/incognito.js';

// Export schemas
export * from './schemas/index.js';
export * from './types/api-types.js';
export * from './types/discord.js';
export * from './types/discord-types.js';
export * from './types/gateway-context.js';
export * from './types/jobs.js';
export * from './types/summon-anonymity.js';
export * from './types/shapes-import.js';
export * from './types/schemas/index.js';

// Export utilities
export {
  splitMessage,
  truncateText,
  stripBotFooters,
  stripDmPrefix,
  normalizeMessageForContext,
  extractMessagePrefixName,
  findLeadingMentionsEnd,
  stripLeadingMentions,
} from './utils/discord.js';
export { generateClonedName, stripCopySuffix } from './utils/presetCloneName.js';
export { createLogger } from './utils/logger.js';
export {
  parseRedisUrl,
  createBullMQRedisConfig,
  createIORedisClient,
  initCoreRedisServices,
  type CoreRedisServices,
} from './utils/redis.js';
export * from './utils/dateFormatting.js';
export * from './utils/errors.js';
export * from './utils/timeout.js';
export * from './utils/deterministicUuid.js';
export * from './utils/attachmentCacheKey.js';
export * from './utils/processLifecycle.js';
export * from './utils/tokenCounter.js';
export * from './utils/contextWindowCap.js';
export * from './utils/textChunker.js';
export * from './utils/autocompleteFormat.js';
export { Duration, DurationParseError } from './utils/Duration.js';
export {
  shouldShowGap,
  calculateTimeGap,
  formatTimeGapMarker,
  type TimeGapConfig,
} from './utils/timeGap.js';
export { isBotOwner } from './utils/ownerMiddleware.js';
export { normalizeSlugForUser } from './utils/slugUtils.js';
export {
  computePersonalityPermissions,
  computeLlmConfigPermissions,
  type EntityPermissions,
} from './utils/permissions.js';
export { TTLCache } from './utils/TTLCache.js';
export { assertDefined } from './utils/typeGuards.js';
// Generated command option schemas
export * from './generated/commandOptions.js';
export { encryptApiKey, decryptApiKey } from './utils/encryption.js';
export { escapeXmlContent } from './utils/promptSanitizer.js';
export { escapeXml } from './utils/xmlBuilder.js';
export { formatLocationAsXml } from './utils/environmentFormatter.js';
export { normalizeRole, normalizeTimestamp } from './utils/messageNormalization.js';

// Export services
export * from './services/prisma.js';
export * from './services/poolConfig.js';
// Identity / provisioning services (UserService, PersonaResolver,
// PersonalityService, RoutingContextResolver) live in `@tzurot/identity`. The
// shared persona contract (CorePersonaConfig / PersonaResolverLike) stays here
// in types/personaResolution.ts so common-types utils + bot-client can type
// against it without depending on the Prisma-backed identity package.
// Config-resolution RESOLVERS (BaseConfigResolver, Llm/Tts/SttResolver,
// ConfigCascadeResolver — the cascade-resolution logic) live in
// `@tzurot/config-resolver`. The config MAPPERS + tts provider TYPES stay here:
// they're data shapes consumed by common-types schemas + personality loading,
// so moving them would cycle. The Redis pub/sub cache-invalidation cluster
// (BaseCacheInvalidationService + 9 invalidators + the event validators) now
// lives in `@tzurot/cache-invalidation` — it's stateful runtime infra (each
// instance owns a Redis subscriber), not types. Only the REDIS_CHANNELS
// constant stays here (a pure constant bundled with the BullMQ queue names in
// constants/queue.ts; the package imports the cache-channel subset from it).
export * from './services/LlmConfigMapper.js';
export * from './services/TtsConfigMapper.js';
export * from './services/tts/TtsProvider.js';
export * from './services/tts/TtsProviderError.js';
// Prisma-backed conversation persistence (ConversationHistoryService,
// ConversationSyncService, ConversationMessageMapper, referenceImageDescriptions)
// lives in `@tzurot/conversation-history`. The data SHAPES it produces
// (ConversationMessage / CrossChannelHistoryGroup) stay here in
// types/conversationMessage.ts, and the PURE sync-diff util stays too — both are
// consumed by bot-client, which can't depend on the Prisma-backed package.
export * from './services/historyCutoff.js';
export * from './services/conversationSyncDiff.js';
export * from './utils/historyMerger.js';
export * from './utils/extendedContextPersonaResolver.js';
export * from './utils/referenceEnrichment.js';
export * from './utils/messageLinkParser.js';
export * from './utils/mentionRewriter.js';
export * from './utils/crossChannelEnvironment.js';
export { VoiceTranscriptCache } from './services/VoiceTranscriptCache.js';

// NOTE: validated mock factories live in `@tzurot/test-factories` — they're
// test-only mock-builders, not runtime types, so they don't belong in the
// shared type package. Import `mockLlmConfig*`, `mockPersona*`, etc. from
// `@tzurot/test-factories`.

// NOTE: the route manifest (`./routes/`) and the typed HTTP clients
// (`./clients/`) live in the `@tzurot/clients` package. Import
// `ROUTE_MANIFEST`, `UserClient`/`OwnerClient`/`ServiceClient`, the transport
// helpers, and the branded actor/subject types from there. common-types keeps
// the contract schemas (`schemas/api/*`) that the manifest references —
// `@tzurot/clients` depends on this package one-way.
