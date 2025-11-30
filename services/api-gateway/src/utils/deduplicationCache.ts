/**
 * Request Deduplication Cache
 *
 * Provides a Redis-backed deduplication cache singleton for use across the application.
 * Must be initialized with a Redis connection before use.
 *
 * The Redis-backed implementation enables horizontal scaling of API Gateway instances
 * since all instances share the same deduplication state.
 */

import type { Redis } from 'ioredis';
import { createLogger } from '@tzurot/common-types';
import {
  RedisDeduplicationCache,
  type RedisDeduplicationOptions,
} from './RedisDeduplicationCache.js';

const logger = createLogger('DeduplicationCache');

// Singleton instance
let _cache: RedisDeduplicationCache | null = null;

/**
 * Initialize the deduplication cache with a Redis connection
 * Must be called before any other deduplication cache operations
 */
export function initializeDeduplicationCache(
  redis: Redis,
  options?: RedisDeduplicationOptions
): void {
  if (_cache !== null) {
    logger.warn({}, '[DeduplicationCache] Cache already initialized, disposing old instance');
    _cache.dispose();
  }

  _cache = new RedisDeduplicationCache(redis, options);
  logger.info('[DeduplicationCache] Redis-backed deduplication cache initialized');
}

/**
 * Get the deduplication cache instance
 * @throws Error if cache has not been initialized
 */
export function getDeduplicationCache(): RedisDeduplicationCache {
  if (_cache === null) {
    throw new Error(
      'Deduplication cache not initialized. Call initializeDeduplicationCache first.'
    );
  }
  return _cache;
}

/**
 * Dispose the deduplication cache
 * Should be called during graceful shutdown
 */
export function disposeDeduplicationCache(): void {
  if (_cache !== null) {
    _cache.dispose();
    _cache = null;
    logger.info('[DeduplicationCache] Deduplication cache disposed');
  }
}

// Export the cache class for type usage
export { RedisDeduplicationCache } from './RedisDeduplicationCache.js';
export type { RedisDeduplicationOptions } from './RedisDeduplicationCache.js';
