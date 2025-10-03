/**
 * ProfileInfoCache - Manages caching of profile information
 *
 * This module handles the caching layer for profile information,
 * reducing API calls and improving performance.
 *
 * Now uses LRUCache to prevent unbounded memory growth.
 */

const logger = require('../../logger');
const LRUCache = require('../../utils/LRUCache');

class ProfileInfoCache {
  constructor(options = {}) {
    this.cacheDuration = options.cacheDuration || 24 * 60 * 60 * 1000; // 24 hours default
    this.logPrefix = options.logPrefix || '[ProfileInfoCache]';

    // Injectable timer functions for testability
    this.setInterval = options.setInterval || setInterval;
    this.clearInterval = options.clearInterval || clearInterval;

    // Use LRUCache with a reasonable limit for profile data
    // 1000 profiles should be enough for most use cases
    this.cache = new LRUCache({
      maxSize: options.maxSize || 1000,
      ttl: this.cacheDuration,
      onEvict: (profileName, _data) => {
        logger.debug(`${this.logPrefix} Evicted profile from cache: ${profileName}`);
      },
    });

    // Set up periodic cleanup of expired entries
    if (options.enableCleanup !== false) {
      this.cleanupInterval = this.setInterval(
        () => {
          this.cache.cleanupExpired();
        },
        60 * 60 * 1000
      ); // Clean up every hour
    }
  }

  /**
   * Get a profile from cache if it exists and is valid
   * @param {string} profileName - The profile name to look up
   * @returns {Object|null} The cached profile data or null if not found/expired
   */
  get(profileName) {
    const data = this.cache.get(profileName);

    if (data) {
      logger.debug(`${this.logPrefix} Cache hit for: ${profileName}`);
      return data;
    }

    return null;
  }

  /**
   * Store profile data in cache
   * @param {string} profileName - The profile name
   * @param {Object} data - The profile data to cache
   */
  set(profileName, data) {
    this.cache.set(profileName, data);
    logger.debug(`${this.logPrefix} Cached data for: ${profileName}`);
  }

  /**
   * Check if a profile exists in cache
   * @param {string} profileName - The profile name to check
   * @returns {boolean} True if the profile is in cache and not expired
   */
  has(profileName) {
    return this.cache.has(profileName);
  }

  /**
   * Clear all cached data
   */
  clear() {
    this.cache.clear();
    logger.debug(`${this.logPrefix} Cache cleared`);
  }

  /**
   * Delete a specific profile from cache
   * @param {string} profileName - The profile name to delete
   * @returns {boolean} True if the profile was deleted, false if it didn't exist
   */
  delete(profileName) {
    const deleted = this.cache.delete(profileName);
    if (deleted) {
      logger.debug(`${this.logPrefix} Deleted profile from cache: ${profileName}`);
    }
    return deleted;
  }

  /**
   * Get the current cache size
   * @returns {number} Number of cached entries
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  stop() {
    if (this.cleanupInterval) {
      this.clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

module.exports = ProfileInfoCache;
