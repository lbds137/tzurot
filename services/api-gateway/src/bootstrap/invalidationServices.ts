/**
 * Cache-invalidation publishers
 *
 * The one-per-channel invalidation services the gateway constructs over the
 * shared cache Redis. Each is a thin pub/sub wrapper with no further wiring of
 * its own, so they group here; anything that also SUBSCRIBES (personality,
 * config cascade, system settings) stays in the server bootstrap next to its
 * handler.
 *
 * The gateway publishes on these and does not subscribe to them: it mutates its
 * own in-process caches synchronously at each write site, and the broadcast is
 * what reaches the other services' long-lived caches.
 */

import type { Redis } from 'ioredis';
import {
  ApiKeyCacheInvalidationService,
  DenylistCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  SttResolverCacheInvalidationService,
  TtsConfigCacheInvalidationService,
  UserCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('api-gateway-invalidation');

/** The publisher set handed to `RouteDeps`. */
export interface ChannelInvalidationServices {
  apiKeyCacheInvalidation: ApiKeyCacheInvalidationService;
  llmConfigCacheInvalidation: LlmConfigCacheInvalidationService;
  ttsConfigCacheInvalidation: TtsConfigCacheInvalidationService;
  sttResolverCacheInvalidation: SttResolverCacheInvalidationService;
  denylistInvalidation: DenylistCacheInvalidationService;
  userCacheInvalidation: UserCacheInvalidationService;
}

/** Build every publish-side invalidation service over one Redis client. */
export function createChannelInvalidationServices(cacheRedis: Redis): ChannelInvalidationServices {
  const services: ChannelInvalidationServices = {
    apiKeyCacheInvalidation: new ApiKeyCacheInvalidationService(cacheRedis),
    llmConfigCacheInvalidation: new LlmConfigCacheInvalidationService(cacheRedis),
    ttsConfigCacheInvalidation: new TtsConfigCacheInvalidationService(cacheRedis),
    sttResolverCacheInvalidation: new SttResolverCacheInvalidationService(cacheRedis),
    denylistInvalidation: new DenylistCacheInvalidationService(cacheRedis),
    userCacheInvalidation: new UserCacheInvalidationService(cacheRedis),
  };
  logger.info({ channels: Object.keys(services) }, 'Cache invalidation publishers initialized');
  return services;
}
