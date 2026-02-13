/**
 * Cache Invalidation Setup
 *
 * Configures all cache invalidation services and Redis pub/sub subscriptions
 * for the AI worker. Each resolver gets its own invalidation service that
 * listens for cache bust events from api-gateway.
 */

import { Redis } from 'ioredis';
import {
  createLogger,
  PersonalityService,
  CacheInvalidationService,
  ApiKeyCacheInvalidationService,
  LlmConfigCacheInvalidationService,
  PersonaCacheInvalidationService,
  ConfigCascadeResolver,
  ConfigCascadeCacheInvalidationService,
  LlmConfigResolver,
  type PrismaClient,
} from '@tzurot/common-types';
import { ApiKeyResolver } from './services/ApiKeyResolver.js';
import { PersonaResolver } from './services/resolvers/index.js';

const logger = createLogger('ai-worker-cache');

/** Dependencies needed for cache invalidation setup */
export interface CacheInvalidationDeps {
  cacheRedis: Redis;
  prisma: PrismaClient;
}

/** Result of cache invalidation setup */
export interface CacheInvalidationResult {
  personalityService: PersonalityService;
  cacheInvalidationService: CacheInvalidationService;
  apiKeyResolver: ApiKeyResolver;
  llmConfigResolver: LlmConfigResolver;
  personaResolver: PersonaResolver;
  cascadeResolver: ConfigCascadeResolver;
  cleanupFns: (() => Promise<void>)[];
}

/**
 * Set up all cache invalidation services and subscriptions
 */
export async function setupCacheInvalidation(
  deps: CacheInvalidationDeps
): Promise<CacheInvalidationResult> {
  const { cacheRedis, prisma } = deps;
  const cleanupFns: (() => Promise<void>)[] = [];

  // PersonalityService and CacheInvalidationService
  const personalityService = new PersonalityService(prisma);
  const cacheInvalidationService = new CacheInvalidationService(cacheRedis, personalityService);
  await cacheInvalidationService.subscribe();
  cleanupFns.push(() => cacheInvalidationService.unsubscribe());
  logger.info('[AIWorker] Subscribed to personality cache invalidation events');

  // ApiKeyResolver with cache invalidation
  const apiKeyResolver = new ApiKeyResolver(prisma);
  const apiKeyCacheInvalidation = new ApiKeyCacheInvalidationService(cacheRedis);
  await apiKeyCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      apiKeyResolver.clearCache();
      logger.info('[AIWorker] Cleared all API key cache entries');
    } else {
      apiKeyResolver.invalidateUserCache(event.discordId);
      logger.info({ discordId: event.discordId }, '[AIWorker] Invalidated API key cache for user');
    }
  });
  cleanupFns.push(() => apiKeyCacheInvalidation.unsubscribe());
  logger.info('[AIWorker] ApiKeyResolver initialized with cache invalidation');

  // LlmConfigResolver with cache invalidation
  const llmConfigResolver = new LlmConfigResolver(prisma);
  const llmConfigCacheInvalidation = new LlmConfigCacheInvalidationService(cacheRedis);
  await llmConfigCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      llmConfigResolver.clearCache();
      logger.info('[AIWorker] Cleared all LLM config cache entries');
    } else if (event.type === 'user') {
      llmConfigResolver.invalidateUserCache(event.discordId);
      logger.info(
        { discordId: event.discordId },
        '[AIWorker] Invalidated LLM config cache for user'
      );
    } else {
      llmConfigResolver.clearCache();
      logger.info(
        { configId: event.configId },
        '[AIWorker] Cleared LLM config cache (config changed)'
      );
    }
  });
  cleanupFns.push(() => llmConfigCacheInvalidation.unsubscribe());
  logger.info('[AIWorker] LlmConfigResolver initialized with cache invalidation');

  // PersonaResolver with cache invalidation
  const personaResolver = new PersonaResolver(prisma);
  const personaCacheInvalidation = new PersonaCacheInvalidationService(cacheRedis);
  await personaCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      personaResolver.clearCache();
      logger.info('[AIWorker] Cleared all persona cache entries');
    } else {
      personaResolver.invalidateUserCache(event.discordId);
      logger.info({ discordId: event.discordId }, '[AIWorker] Invalidated persona cache for user');
    }
  });
  cleanupFns.push(() => personaCacheInvalidation.unsubscribe());
  logger.info('[AIWorker] PersonaResolver initialized with cache invalidation');

  // ConfigCascadeResolver with cache invalidation
  const cascadeResolver = new ConfigCascadeResolver(prisma);
  const cascadeCacheInvalidation = new ConfigCascadeCacheInvalidationService(cacheRedis);
  await cascadeCacheInvalidation.subscribe(event => {
    if (event.type === 'all') {
      cascadeResolver.clearCache();
      logger.info('[AIWorker] Cleared all config cascade cache entries');
    } else if (event.type === 'admin') {
      cascadeResolver.clearCache();
      logger.info('[AIWorker] Cleared config cascade cache (admin defaults changed)');
    } else if (event.type === 'user') {
      cascadeResolver.invalidateUserCache(event.discordId);
      logger.info(
        { discordId: event.discordId },
        '[AIWorker] Invalidated config cascade cache for user'
      );
    } else {
      cascadeResolver.invalidatePersonalityCache(event.personalityId);
      logger.info(
        { personalityId: event.personalityId },
        '[AIWorker] Invalidated config cascade cache for personality'
      );
    }
  });
  cleanupFns.push(() => cascadeCacheInvalidation.unsubscribe());
  logger.info('[AIWorker] ConfigCascadeResolver initialized with cache invalidation');

  return {
    personalityService,
    cacheInvalidationService,
    apiKeyResolver,
    llmConfigResolver,
    personaResolver,
    cascadeResolver,
    cleanupFns,
  };
}
