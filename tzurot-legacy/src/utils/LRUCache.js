/**
 * Least Recently Used (LRU) Cache implementation
 *
 * TODO: Consider migrating to npm 'lru-cache' package (v11+) which provides:
 * - Async fetch with deduplication
 * - Size-based eviction
 * - Stale-while-revalidate
 * - Better performance
 * - Battle-tested edge cases
 *
 * This implementation works well for our current needs, but lru-cache
 * would provide more features and better performance.
 *
 * This cache automatically evicts the least recently used items when it reaches
 * its maximum size. Items are considered "used" when they are get, set, or has
 * operations are performed on them.
 *
 * @example
 * const cache = new LRUCache({ maxSize: 100 });
 * cache.set('key', 'value');
 * const value = cache.get('key'); // Returns 'value'
 *
 * @example With TTL (time-to-live)
 * const cache = new LRUCache({ maxSize: 100, ttl: 60000 }); // 1 minute TTL
 * cache.set('key', 'value');
 * // After 1 minute, the entry expires
 * cache.get('key'); // Returns undefined
 */
class LRUCache {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.maxSize - Maximum number of items in the cache
   * @param {number} [options.ttl] - Time to live in milliseconds (optional)
   * @param {Function} [options.onEvict] - Callback when item is evicted (key, value) => void
   */
  constructor(options = {}) {
    const { maxSize = 1000, ttl = null, onEvict = null } = options;

    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error('maxSize must be a positive integer');
    }

    this.maxSize = maxSize;
    this.ttl = ttl;
    this.onEvict = onEvict;
    this.cache = new Map();
    this.accessOrder = new Map(); // Track access times for LRU
  }

  /**
   * Get a value from the cache
   * @param {any} key - The key to retrieve
   * @returns {any} The value, or undefined if not found or expired
   */
  get(key) {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const entry = this.cache.get(key);

    // Check if expired
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return undefined;
    }

    // Update access time for LRU
    this.accessOrder.set(key, Date.now());

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param {any} key - The key to set
   * @param {any} value - The value to store
   * @returns {LRUCache} Returns this for chaining
   */
  set(key, value) {
    // If key exists, update it
    if (this.cache.has(key)) {
      this.cache.set(key, {
        value,
        timestamp: Date.now(),
      });
      this.accessOrder.set(key, Date.now());
      return this;
    }

    // If at capacity, evict least recently used
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Add new entry
    const now = Date.now();
    this.cache.set(key, {
      value,
      timestamp: now,
    });
    this.accessOrder.set(key, now);

    return this;
  }

  /**
   * Check if a key exists in the cache
   * @param {any} key - The key to check
   * @returns {boolean} True if the key exists and hasn't expired
   */
  has(key) {
    if (!this.cache.has(key)) {
      return false;
    }

    const entry = this.cache.get(key);

    // Check if expired
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.delete(key);
      return false;
    }

    // Update access time for LRU
    this.accessOrder.set(key, Date.now());

    return true;
  }

  /**
   * Delete a key from the cache
   * @param {any} key - The key to delete
   * @returns {boolean} True if the key was deleted
   */
  delete(key) {
    if (!this.cache.has(key)) {
      return false;
    }

    const entry = this.cache.get(key);
    this.cache.delete(key);
    this.accessOrder.delete(key);

    if (this.onEvict) {
      this.onEvict(key, entry.value);
    }

    return true;
  }

  /**
   * Clear all entries from the cache
   */
  clear() {
    if (this.onEvict) {
      for (const [key, entry] of this.cache.entries()) {
        this.onEvict(key, entry.value);
      }
    }

    this.cache.clear();
    this.accessOrder.clear();
  }

  /**
   * Get the current size of the cache
   * @returns {number} Number of items in the cache
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Get all keys in the cache
   * @returns {IterableIterator<any>} Iterator of keys
   */
  keys() {
    return this.cache.keys();
  }

  /**
   * Get all values in the cache
   * @returns {IterableIterator<any>} Iterator of values
   */
  values() {
    const values = [];
    for (const entry of this.cache.values()) {
      values.push(entry.value);
    }
    return values.values();
  }

  /**
   * Get all entries in the cache
   * @returns {IterableIterator<[any, any]>} Iterator of [key, value] pairs
   */
  entries() {
    const entries = [];
    for (const [key, entry] of this.cache.entries()) {
      entries.push([key, entry.value]);
    }
    return entries.values();
  }

  /**
   * Evict the least recently used item
   * @private
   */
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    // Find the least recently accessed key
    for (const [key, time] of this.accessOrder.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.delete(oldestKey);
    }
  }

  /**
   * Clean up expired entries (if TTL is set)
   * Call this periodically if you have TTL set
   */
  cleanupExpired() {
    if (!this.ttl) {
      return;
    }

    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Statistics about the cache
   */
  getStats() {
    const now = Date.now();
    let expiredCount = 0;

    if (this.ttl) {
      for (const entry of this.cache.values()) {
        if (now - entry.timestamp > this.ttl) {
          expiredCount++;
        }
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // Could be tracked with additional logic
      expiredCount,
      ttl: this.ttl,
    };
  }
}

module.exports = LRUCache;
