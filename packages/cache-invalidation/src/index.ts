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
  CacheInvalidationService,
  isValidInvalidationEvent,
  type PersonalityCacheTarget,
} from './CacheInvalidationService.js';
export { ApiKeyCacheInvalidationService } from './ApiKeyCacheInvalidationService.js';
export { LlmConfigCacheInvalidationService } from './LlmConfigCacheInvalidationService.js';
export { PersonaCacheInvalidationService } from './PersonaCacheInvalidationService.js';
export { UserCacheInvalidationService } from './UserCacheInvalidationService.js';
export { ChannelActivationCacheInvalidationService } from './ChannelActivationCacheInvalidationService.js';
export { ConfigCascadeCacheInvalidationService } from './ConfigCascadeCacheInvalidationService.js';
export {
  DenylistCacheInvalidationService,
  type DenylistInvalidationEvent,
} from './DenylistCacheInvalidationService.js';
export { TtsConfigCacheInvalidationService } from './TtsConfigCacheInvalidationService.js';
export { SttResolverCacheInvalidationService } from './SttResolverCacheInvalidationService.js';
export { SystemSettingsCacheInvalidationService } from './SystemSettingsCacheInvalidationService.js';
