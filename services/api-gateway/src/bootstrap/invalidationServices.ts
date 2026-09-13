/**
 * Cache-invalidation publishers
 *
 * The one-per-channel invalidation services the gateway constructs over the
 * shared cache Redis. Each is a thin pub/sub wrapper with no further wiring of
 * its own, so they group here; anything that also SUBSCRIBES (personality,
 * config cascade, system settings, persona) owns its handler elsewhere —
 * either in the server bootstrap next to it, or (persona) in
 * `personaInvalidationSubscription.ts`, which this factory's caller invokes
 * on the `personaCacheInvalidation` instance built below.
 *
 * For every other channel here, the gateway publishes and does not subscribe:
 * it mutates its own in-process caches synchronously at each write site, and
 * the broadcast is what reaches the other services' long-lived caches.
 */

import type { Redis } from 'ioredis';
import {
  ApiKeyCacheInvalidationService,
  ChannelActivationCacheInvalidationService,
  DenylistCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  PersonaCacheInvalidationService,
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
  personaCacheInvalidation: PersonaCacheInvalidationService;
  channelActivationInvalidation: ChannelActivationCacheInvalidationService;
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
    personaCacheInvalidation: new PersonaCacheInvalidationService(cacheRedis),
    channelActivationInvalidation: new ChannelActivationCacheInvalidationService(cacheRedis),
  };
  logger.info({ channels: Object.keys(services) }, 'Cache invalidation publishers initialized');
  return services;
}
