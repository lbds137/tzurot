/**
 * ProfileInfoCache - Manages caching of profile information
 * 
 * This module handles the caching layer for profile information,
 * reducing API calls and improving performance.
 */

const logger = require('../../logger');

class ProfileInfoCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.cacheDuration = options.cacheDuration || 24 * 60 * 60 * 1000; // 24 hours default
    this.logPrefix = options.logPrefix || '[ProfileInfoCache]';
  }

  /**
   * Get a profile from cache if it exists and is valid
   * @param {string} profileName - The profile name to look up
   * @returns {Object|null} The cached profile data or null if not found/expired
   */
  get(profileName) {
    if (!this.cache.has(profileName)) {
      return null;
    }

    const cacheEntry = this.cache.get(profileName);
    const age = Date.now() - cacheEntry.timestamp;

    if (age > this.cacheDuration) {
      logger.debug(`${this.logPrefix} Cache expired for: ${profileName}`);
      this.cache.delete(profileName);
      return null;
    }

    logger.debug(`${this.logPrefix} Cache hit for: ${profileName}`);
    return cacheEntry.data;
  }

  /**
   * Store profile data in cache
   * @param {string} profileName - The profile name
   * @param {Object} data - The profile data to cache
   */
  set(profileName, data) {
    this.cache.set(profileName, {
      data,
      timestamp: Date.now()
    });
    logger.debug(`${this.logPrefix} Cached data for: ${profileName}`);
  }

  /**
   * Check if a profile exists in cache (regardless of expiration)
   * @param {string} profileName - The profile name to check
   * @returns {boolean} True if the profile is in cache
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
   * Get the current cache size
   * @returns {number} Number of cached entries
   */
  get size() {
    return this.cache.size;
  }
}

module.exports = ProfileInfoCache;