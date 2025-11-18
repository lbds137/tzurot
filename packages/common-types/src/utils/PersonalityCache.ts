/**
 * PersonalityCache
 *
 * Generic LRU (Least Recently Used) cache with TTL (Time To Live) support.
 * Extracted from PersonalityService to enable reusability and testability.
 *
 * Features:
 * - Time-based expiration (TTL)
 * - Size-based eviction (LRU)
 * - Automatic cleanup of expired entries
 *
 * @template T - Type of cached values
 */

import { createLogger } from './logger.js';

const logger = createLogger('PersonalityCache');

export interface PersonalityCacheOptions {
  /** Time-to-live for cache entries in milliseconds */
  ttl?: number;
  /** Maximum number of entries to cache */
  maxSize?: number;
}

export class PersonalityCache<T> {
  private cache: Map<string, T>;
  private expiry: Map<string, number>;
  private lastAccess: Map<string, number>;
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(options: PersonalityCacheOptions = {}) {
    this.cache = new Map();
    this.expiry = new Map();
    this.lastAccess = new Map();
    this.ttl = options.ttl ?? 5 * 60 * 1000; // Default: 5 minutes
    this.maxSize = options.maxSize ?? 100; // Default: 100 entries
  }

  /**
   * Get value from cache if not expired
   * Updates last access time for LRU tracking
   */
  get(key: string): T | null {
    const expiryTime = this.expiry.get(key);

    // Check if entry exists and is not expired
    if (expiryTime === undefined || Date.now() > expiryTime) {
      // Entry doesn't exist or is expired - clean up
      this.cache.delete(key);
      this.expiry.delete(key);
      this.lastAccess.delete(key);
      return null;
    }

    // Update last access time for LRU tracking
    this.lastAccess.set(key, Date.now());
    return this.cache.get(key) ?? null;
  }

  /**
   * Set value in cache with expiry and LRU eviction
   */
  set(key: string, value: T): void {
    // Evict least recently used entries if cache is full
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, value);
    this.expiry.set(key, Date.now() + this.ttl);
    this.lastAccess.set(key, Date.now());
  }

  /**
   * Check if key exists in cache and is not expired
   */
  has(key: string): boolean {
    const expiryTime = this.expiry.get(key);

    if (expiryTime === undefined || Date.now() > expiryTime) {
      // Entry doesn't exist or is expired - clean up
      this.cache.delete(key);
      this.expiry.delete(key);
      this.lastAccess.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    this.expiry.delete(key);
    this.lastAccess.delete(key);
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.expiry.clear();
    this.lastAccess.clear();
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict least recently used cache entries
   * @private
   */
  private evictLRU(): void {
    if (this.lastAccess.size === 0) {
      return;
    }

    // Find the least recently used entry
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, lastAccess] of this.lastAccess.entries()) {
      if (lastAccess < lruTime) {
        lruTime = lastAccess;
        lruKey = key;
      }
    }

    // Remove the LRU entry
    if (lruKey !== null && lruKey.length > 0) {
      this.cache.delete(lruKey);
      this.expiry.delete(lruKey);
      this.lastAccess.delete(lruKey);
      logger.debug(`Evicted LRU cache entry: ${lruKey}`);
    }
  }
}
