/**
 * @tzurot/cache-invalidation
 *
 * Redis pub/sub cache-invalidation infrastructure, extracted from
 * `@tzurot/common-types` so the shared type package stays types/schemas/utils.
 * A generic `BaseCacheInvalidationService<TEvent>` (publish + subscribe + the
 * event-validator helpers) plus one concrete invalidator per cached domain.
 *
 * This is stateful runtime infra (each instance owns a Redis subscriber
 * connection), genuinely shared by all three services — every service both
 * publishes (when it mutates data) and subscribes (to invalidate its local
 * caches). Consumers inject a `Redis` client; the channel-name constants live
 * in `@tzurot/common-types` (`REDIS_CHANNELS`, alongside the BullMQ queue names).
 */

export {
  type AllInvalidationEvent,
  BaseCacheInvalidationService,
  createEventValidator,
  createStandardEventValidator,
  type EventFieldSpec,
  type EventTypeSpec,
  type EventValidator,
  type StandardInvalidationEvent,
  type UserInvalidationEvent,
} from './BaseCacheInvalidationService.js';
export {
  CacheInvalidationService,
  isValidInvalidationEvent,
  type PersonalityCacheTarget,
} from './CacheInvalidationService.js';
export {
  ApiKeyCacheInvalidationService,
  type ApiKeyInvalidationEvent,
} from './ApiKeyCacheInvalidationService.js';
export { LlmConfigCacheInvalidationService } from './LlmConfigCacheInvalidationService.js';
export {
  PersonaCacheInvalidationService,
  type PersonaInvalidationEvent,
} from './PersonaCacheInvalidationService.js';
export {
  ChannelActivationCacheInvalidationService,
  type ChannelActivationInvalidationEvent,
} from './ChannelActivationCacheInvalidationService.js';
export {
  ConfigCascadeCacheInvalidationService,
  type ConfigCascadeInvalidationEvent,
} from './ConfigCascadeCacheInvalidationService.js';
export {
  DenylistCacheInvalidationService,
  type DenylistEntryRef,
  type DenylistInvalidationEvent,
  isValidDenylistInvalidationEvent,
} from './DenylistCacheInvalidationService.js';
export { TtsConfigCacheInvalidationService } from './TtsConfigCacheInvalidationService.js';
export { SttResolverCacheInvalidationService } from './SttResolverCacheInvalidationService.js';
export {
  SystemSettingsCacheInvalidationService,
  type SystemSettingsInvalidationEvent,
  isValidSystemSettingsInvalidationEvent,
} from './SystemSettingsCacheInvalidationService.js';
