/**
 * ProfileInfoFetcher - Main orchestrator for fetching profile information
 *
 * This module coordinates between the cache, client, and rate limiter
 * to efficiently fetch profile information while respecting rate limits.
 */

const { getProfileInfoEndpoint } = require('../../../config');
const logger = require('../../logger');
const ProfileInfoCache = require('./ProfileInfoCache');
const ProfileInfoClient = require('./ProfileInfoClient');
const RateLimiter = require('../../utils/rateLimiter');

class ProfileInfoFetcher {
  constructor(options = {}) {
    this.cache = new ProfileInfoCache(options.cache);
    this.client = new ProfileInfoClient(options.client);

    // Inject authentication service to avoid circular dependency
    this.authService = options.authService || null;

    // If rateLimiter options are provided, create a new instance with those options
    if (options.rateLimiter && !(options.rateLimiter instanceof RateLimiter)) {
      this.rateLimiter = new RateLimiter({
        minRequestSpacing: 6000,
        maxConcurrent: 1,
        maxConsecutiveRateLimits: 3,
        cooldownPeriod: 60000,
        maxRetries: 5,
        logPrefix: '[ProfileInfoFetcher]',
        ...options.rateLimiter,
      });
    } else {
      this.rateLimiter =
        options.rateLimiter ||
        new RateLimiter({
          minRequestSpacing: 6000,
          maxConcurrent: 1,
          maxConsecutiveRateLimits: 3,
          cooldownPeriod: 60000,
          maxRetries: 5,
          logPrefix: '[ProfileInfoFetcher]',
        });
    }

    this.ongoingRequests = new Map();
    this.maxRetries = options.maxRetries || this.rateLimiter.maxRetries || 5;
    this.logPrefix = '[ProfileInfoFetcher]';

    // Allow injection of delay function for testing
    this.delay =
      options.delay ||
      (ms => {
        const timer = globalThis.setTimeout || setTimeout;
        return new Promise(resolve => timer(resolve, ms));
      });
  }

  /**
   * Get user authentication data from DDD system
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Auth data with token and appId or null
   */
  async getUserAuth(userId) {
    if (!userId) return null;

    // If no auth service injected, return null (authentication not available)
    if (!this.authService) {
      logger.debug(`${this.logPrefix} No auth service injected, returning null for user ${userId}`);
      return null;
    }

    try {
      const status = await this.authService.getAuthenticationStatus(userId);

      if (!status.isAuthenticated || !status.user?.token) {
        return null;
      }

      // Get app ID from config (similar to legacy authManager.APP_ID)
      const config = require('../../../config');
      const appId = config.serviceAppId || process.env.SERVICE_APP_ID;

      return {
        token: status.user.token.value,
        appId: appId,
      };
    } catch (error) {
      logger.error(`${this.logPrefix} Error getting user auth:`, error);
      return null;
    }
  }

  /**
   * Fetch profile information with caching and rate limiting
   * @param {string} profileName - The profile name
   * @param {string} [userId] - Optional user ID for authentication
   * @returns {Promise<Object|null>} The profile data or null
   */
  async fetchProfileInfo(profileName, userId = null) {
    // Create unique request key
    const requestKey = userId ? `${profileName}:${userId}` : profileName;

    // Check for ongoing request
    if (this.ongoingRequests.has(requestKey)) {
      logger.info(`${this.logPrefix} Reusing existing request for: ${profileName}`);
      return this.ongoingRequests.get(requestKey);
    }

    // Create promise for this request
    const requestPromise = this._executeRequest(profileName, userId, requestKey);
    this.ongoingRequests.set(requestKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.ongoingRequests.delete(requestKey);
    }
  }

  /**
   * Execute the actual request with rate limiting
   * @private
   */
  async _executeRequest(profileName, userId, _requestKey) {
    return new Promise(resolve => {
      this.rateLimiter.enqueue(async () => {
        try {
          logger.info(`${this.logPrefix} Fetching profile info for: ${profileName}`);

          // Check cache first
          const cachedData = this.cache.get(profileName);
          if (cachedData) {
            logger.info(`${this.logPrefix} Using cached profile data for: ${profileName}`);
            resolve(cachedData);
            return;
          }

          // Fetch from API
          const data = await this._fetchWithRetry(profileName, userId);

          if (data) {
            this.cache.set(profileName, data);
          }

          resolve(data);
        } catch (error) {
          logger.error(
            `${this.logPrefix} Error fetching profile info for ${profileName}: ${error.message}`
          );
          resolve(null);
        }
      });
    });
  }

  /**
   * Fetch with retry logic
   * @private
   */
  async _fetchWithRetry(profileName, userId = null) {
    const endpoint = getProfileInfoEndpoint(profileName);
    logger.debug(`${this.logPrefix} Using endpoint: ${endpoint}`);

    // Build headers
    const headers = {};
    const userAuth = await this.getUserAuth(userId);
    if (userAuth) {
      logger.debug(`${this.logPrefix} Using user-specific auth token for user ${userId}`);
      headers['X-App-ID'] = userAuth.appId;
      headers['X-User-Auth'] = userAuth.token;
    }

    let retryCount = 0;
    while (retryCount <= this.maxRetries) {
      const result = await this.client.fetch(endpoint, headers);

      if (result.success) {
        this.rateLimiter.recordSuccess();
        if (this.client.validateProfileData(result.data, profileName)) {
          return result.data;
        }
        return null;
      }

      // Handle rate limiting
      if (result.status === 429) {
        const retryAfter = result.headers?.get?.('retry-after');
        retryCount = await this.rateLimiter.handleRateLimit(
          profileName,
          retryAfter ? parseInt(retryAfter, 10) : null,
          retryCount
        );

        if (retryCount >= this.maxRetries) {
          logger.error(`${this.logPrefix} Max retries reached for ${profileName}`);
          return null;
        }
        continue;
      }

      // Handle timeout with retry
      if (result.error === 'timeout') {
        retryCount++;
        logger.warn(
          `${this.logPrefix} Request timed out for ${profileName}, retry ${retryCount}/${this.maxRetries}`
        );

        if (retryCount <= this.maxRetries) {
          const jitter = Math.floor(Math.random() * 500);
          const waitTime = 2000 * Math.pow(2, retryCount) + jitter;
          await this.delay(waitTime);
          continue;
        } else {
          logger.error(`${this.logPrefix} Max retries reached for ${profileName} after timeout`);
          return null;
        }
      }

      // Other errors, don't retry
      return null;
    }

    return null;
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Delete a specific profile from cache
   * @param {string} profileName - The profile name to delete
   * @returns {boolean} True if the profile was deleted
   */
  deleteFromCache(profileName) {
    return this.cache.delete(profileName);
  }

  /**
   * Get cache instance (for testing)
   */
  getCache() {
    return this.cache.cache;
  }
}

module.exports = ProfileInfoFetcher;
