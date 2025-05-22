/**
 * Profile Info Fetcher
 *
 * This module is responsible for fetching profile information from the API,
 * handling caching, rate limiting, and error recovery.
 *
 * TODO: Future improvements
 * - Implement more sophisticated caching with stale-while-revalidate pattern
 * - Add circuit breaker pattern for failing endpoints
 * - Improve testability by making request queue processing more accessible to tests
 * - Consider adding telemetry for profile fetching to track performance
 * - Replace plain objects with classes for better type safety
 */

// Import dependencies
const nodeFetch = require('node-fetch');
const { getProfileInfoEndpoint } = require('../config');
const logger = require('./logger');
const RateLimiter = require('./utils/rateLimiter');
const auth = require('./auth'); // Import auth module for user tokens

// Cache for profile information to reduce API calls
const profileInfoCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Track ongoing requests to avoid multiple simultaneous API calls for the same personality
const ongoingRequests = new Map();

// Create a rate limiter for profile info requests
const rateLimiter = new RateLimiter({
  minRequestSpacing: 3000, // 3 seconds between requests
  maxConcurrent: 1,
  maxConsecutiveRateLimits: 3,
  cooldownPeriod: 60000, // 1 minute cooldown if we hit too many rate limits
  maxRetries: 5,
  logPrefix: '[ProfileInfoFetcher]',
});

// Use this fetch implementation which allows for easier testing
// Wrapped in a function to make it easier to mock in tests
const fetchImplementation = (...args) => nodeFetch(...args);

/**
 * Fetch information about a profile
 * @param {string} profileName - The profile's username
 * @param {string} [userId] - Optional Discord user ID for user-specific authentication
 * @returns {Promise<Object>} The profile information object
 */
async function fetchProfileInfo(profileName, userId = null) {
  // Create a unique key that includes both profile name and userId to prevent auth leakage
  const requestKey = userId ? `${profileName}:${userId}` : profileName;

  // If there's already an ongoing request with the same profile name and userId, return its promise
  if (ongoingRequests.has(requestKey)) {
    logger.info(
      `[ProfileInfoFetcher] Reusing existing request for: ${profileName} (userId: ${userId || 'none'})`
    );
    return ongoingRequests.get(requestKey);
  }

  // Create a new promise that will be completed when the request is done
  let resolvePromise;
  const requestPromise = new Promise(resolve => {
    resolvePromise = resolve;
  });

  // Add this request to the ongoing requests map immediately with the proper key
  ongoingRequests.set(requestKey, requestPromise);

  // Create a context object with the user ID to pass through the rate limiter
  const _context = { userId };

  // Use the rate limiter to handle this request with the user context
  rateLimiter.enqueue(async (_, _enqueueContext) => {
    try {
      logger.info(`[ProfileInfoFetcher] Fetching profile info for: ${profileName}`);

      // Check if we have a valid cached entry
      if (profileInfoCache.has(profileName)) {
        const cacheEntry = profileInfoCache.get(profileName);
        // If cache entry is still valid, return it
        if (Date.now() - cacheEntry.timestamp < CACHE_DURATION) {
          logger.info(`[ProfileInfoFetcher] Using cached profile data for: ${profileName}`);
          resolvePromise(cacheEntry.data);
          return;
        }
      }

      // Get the endpoint from our config
      const endpoint = getProfileInfoEndpoint(profileName);
      logger.debug(`[ProfileInfoFetcher] Using endpoint: ${endpoint}`);

      // Use the userId passed to this function directly, not from rate limiter context
      // This ensures we don't have context leakage between concurrent requests

      // Fetch the profile data with user authentication if available
      const data = await fetchWithRetry(endpoint, profileName, userId);

      // If we couldn't get the data, resolve with null
      if (!data) {
        resolvePromise(null);
        return;
      }

      // Cache the result
      profileInfoCache.set(profileName, {
        data,
        timestamp: Date.now(),
      });
      logger.debug(`[ProfileInfoFetcher] Cached profile data for: ${profileName}`);

      // Resolve the promise with the data
      resolvePromise(data);
    } catch (error) {
      logger.error(
        `[ProfileInfoFetcher] Error fetching profile info for ${profileName}: ${error.message}`
      );
      resolvePromise(null);
    } finally {
      // Always clean up - remove from ongoing requests
      ongoingRequests.delete(requestKey);
    }
  });

  return requestPromise;
}

/**
 * Fetch data from the API with retry and rate limit handling
 * @param {string} endpoint - The API endpoint to fetch from
 * @param {string} profileName - The profile name (for logging)
 * @param {string} [userId] - Optional Discord user ID for user-specific authentication
 * @returns {Promise<Object|null>} - The fetched data or null on failure
 */
async function fetchWithRetry(endpoint, profileName, userId = null) {
  let retryCount = 0;
  const maxRetries = rateLimiter.maxRetries;

  // Create an AbortController for timeout handling
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    while (retryCount <= maxRetries) {
      try {
        // Prepare headers for the request
        const headers = {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: 'https://discord.com/',
        };

        // Add auth headers if user ID is provided and has a valid token
        if (userId && auth.hasValidToken(userId)) {
          const userToken = auth.getUserToken(userId);
          logger.debug(`[ProfileInfoFetcher] Using user-specific auth token for user ${userId}`);
          headers['X-App-ID'] = auth.APP_ID;
          headers['X-User-Auth'] = userToken;
        }

        const response = await fetchImplementation(endpoint, {
          headers,
          signal: controller.signal,
        });

        // If we get a successful response, clear rate limit counter
        if (response.ok) {
          rateLimiter.recordSuccess();

          // Parse and return the data
          const data = await response.json();
          logger.debug(
            `[ProfileInfoFetcher] Received profile data: ${JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')}`
          );

          // Verify we have the expected fields
          if (!data) {
            logger.error(`[ProfileInfoFetcher] Received empty data for: ${profileName}`);
          } else if (!data.name) {
            logger.warn(
              `[ProfileInfoFetcher] Profile data missing 'name' field for: ${profileName}`
            );
          } else if (!data.id) {
            logger.warn(`[ProfileInfoFetcher] Profile data missing 'id' field for: ${profileName}`);
          }

          return data;
        }

        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          retryCount = await rateLimiter.handleRateLimit(
            profileName,
            retryAfter ? parseInt(retryAfter, 10) : null,
            retryCount
          );

          // If we've hit max retries, give up
          if (retryCount >= maxRetries) {
            logger.error(`[ProfileInfoFetcher] Max retries reached for ${profileName}`);
            return null;
          }

          // Otherwise, continue to next retry iteration
          continue;
        }

        // For other errors, log and return null
        logger.error(
          `[ProfileInfoFetcher] API response error: ${response.status} ${response.statusText} for ${profileName}`
        );
        return null;
      } catch (fetchError) {
        // Handle network errors, like timeouts or connection issues
        if (fetchError.name === 'AbortError' || fetchError.type === 'aborted') {
          logger.warn(
            `[ProfileInfoFetcher] Request timed out for ${profileName}, retry ${retryCount + 1}/${maxRetries}`
          );
          retryCount++;

          if (retryCount <= maxRetries) {
            // Add some jitter to avoid synchronized retries
            const jitter = Math.floor(Math.random() * 500);
            const waitTime = 2000 * Math.pow(2, retryCount) + jitter;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue; // Try again
          } else {
            logger.error(
              `[ProfileInfoFetcher] Max retries reached for ${profileName} after timeout`
            );
            return null;
          }
        }

        // For other fetch errors, log and return null
        logger.error(
          `[ProfileInfoFetcher] Network error during profile fetch for ${profileName}: ${fetchError.message}`
        );
        return null;
      }
    }

    // If we get here, we've exhausted retries
    return null;
  } finally {
    // Always clear the timeout
    clearTimeout(timeoutId);
  }
}

// Import additional utilities
const urlValidator = require('./utils/urlValidator');

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName, userId = null) {
  logger.info(`[ProfileInfoFetcher] Getting avatar URL for: ${profileName}`);

  // Create a context object with the user ID if provided
  const _context = userId ? { userId } : {};

  // Use the rateLimiter to execute the request with context
  const profileInfo = await fetchProfileInfo(profileName, userId);

  if (!profileInfo) {
    logger.warn(`[ProfileInfoFetcher] No profile info found for avatar: ${profileName}`);
    return null;
  }

  try {
    // Check if avatar is directly available in the response (new API format)
    if (profileInfo.avatar) {
      logger.debug(
        `[ProfileInfoFetcher] Using avatar directly from API response: ${profileInfo.avatar}`
      );

      // Validate the URL format
      if (!urlValidator.isValidUrlFormat(profileInfo.avatar)) {
        logger.warn(`[ProfileInfoFetcher] Received invalid avatar from API: ${profileInfo.avatar}`);
      } else {
        return profileInfo.avatar;
      }
    }

    // Check if avatar_url is available in the response (old API format)
    if (profileInfo.avatar_url) {
      logger.debug(
        `[ProfileInfoFetcher] Using avatar_url directly from API response: ${profileInfo.avatar_url}`
      );

      // Validate the URL format
      if (!urlValidator.isValidUrlFormat(profileInfo.avatar_url)) {
        logger.warn(
          `[ProfileInfoFetcher] Received invalid avatar_url from API: ${profileInfo.avatar_url}`
        );
      } else {
        return profileInfo.avatar_url;
      }
    }

    // No avatar URL found in profile info
    logger.warn(`[ProfileInfoFetcher] No avatar or avatar_url found for profile: ${profileName}`);
    return null;
  } catch (error) {
    logger.error(`[ProfileInfoFetcher] Error generating avatar URL: ${error.message}`);
    return null;
  }
}

/**
 * Get the display name for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The display name or null if not found
 */
async function getProfileDisplayName(profileName, userId = null) {
  logger.info(`[ProfileInfoFetcher] Getting display name for: ${profileName}`);

  // Create a context object with the user ID if provided
  const _context = userId ? { userId } : {};

  // Use the rateLimiter to execute the request with context
  const profileInfo = await fetchProfileInfo(profileName, userId);

  if (!profileInfo) {
    logger.warn(`[ProfileInfoFetcher] No profile info found for display name: ${profileName}`);
    return profileName; // Return profileName as fallback instead of null
  }

  if (!profileInfo.name) {
    logger.warn(`[ProfileInfoFetcher] No name field in profile info for: ${profileName}`);
    return null; // Return null to indicate failure
  }

  logger.debug(`[ProfileInfoFetcher] Found display name for ${profileName}: ${profileInfo.name}`);
  return profileInfo.name;
}

/**
 * Clears the profile info cache
 * Exported for testing purposes
 */
function clearCache() {
  profileInfoCache.clear();
}

// Export the module
module.exports = {
  fetchProfileInfo,
  getProfileAvatarUrl,
  getProfileDisplayName,
  // For testing
  _testing: {
    clearCache,
    getCache: () => profileInfoCache,
    setFetchImplementation: newImpl => {
      // This allows tests to override the fetchImplementation
      Object.defineProperty(module.exports, 'fetchImplementation', {
        value: newImpl,
        writable: true,
      });
    },
    // Expose our utils for testing
    getRateLimiter: () => rateLimiter,
  },
};
