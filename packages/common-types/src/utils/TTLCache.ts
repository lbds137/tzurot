/**
 * TTLCache
 *
 * Generic LRU cache with TTL support, powered by the battle-tested lru-cache package.
 * Provides a simple API for caching with automatic expiration and LRU eviction.
 *
 * Features:
 * - Time-based expiration (TTL)
 * - Size-based eviction (LRU)
 * - Optimized performance from lru-cache library
 *
 * @template T - Type of cached values
 */

import { LRUCache } from 'lru-cache';
import { createLogger } from './logger.js';

const logger = createLogger('TTLCache');

interface TTLCacheOptions {
  /** Time-to-live for cache entries in milliseconds */
  ttl?: number;
  /** Maximum number of entries to cache */
  maxSize?: number;
  /**
   * Custom time function for testing with fake timers.
   * Must return milliseconds (like performance.now()).
   * @internal For testing only
   */
  now?: () => number;
}

export class TTLCache<T extends NonNullable<unknown>> {
  private cache: LRUCache<string, T>;

  constructor(options: TTLCacheOptions = {}) {
    const cacheOptions: LRUCache.Options<string, T, unknown> = {
      max: options.maxSize ?? 100,
      ttl: options.ttl ?? 5 * 60 * 1000, // Default: 5 minutes
      updateAgeOnGet: false, // TTL is from set time, not access time
      dispose: (_value, key) => {
        logger.debug(`Evicted cache entry: ${key}`);
      },
    };

    // Allow custom time function for testing with fake timers
    // lru-cache caches performance.now at module load time, so fake timers don't work
    // unless we provide a custom time function via the 'perf' option
    // See: https://github.com/isaacs/node-lru-cache/issues/345
    if (options.now !== undefined) {
      cacheOptions.ttlAutopurge = false; // Disable background purging in tests
      // lru-cache v11+ uses perf.now() for TTL calculations
      (
        cacheOptions as LRUCache.Options<string, T, unknown> & { perf: { now: () => number } }
      ).perf = { now: options.now };
    }

    this.cache = new LRUCache<string, T>(cacheOptions);
  }

  /**
   * Get value from cache if not expired
   */
  get(key: string): T | null {
    const value = this.cache.get(key);
    return value ?? null;
  }

  /**
   * Set value in cache with TTL
   */
  set(key: string, value: T): void {
    this.cache.set(key, value);
  }

  /**
   * Check if key exists in cache and is not expired
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }
}
