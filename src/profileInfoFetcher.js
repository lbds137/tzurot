/**
 * Profile Info Fetcher - Legacy compatibility layer
 *
 * This module provides backward compatibility for the old profileInfoFetcher API
 * while using the new modular architecture under the hood.
 *
 * TODO: Migrate all consumers to use the new ProfileInfoFetcher class directly
 */

const { ProfileInfoFetcher } = require('./core/api');
const logger = require('./logger');
const urlValidator = require('./utils/urlValidator');

// Create factory function for dependency injection
let fetcher = null;

function getFetcher() {
  if (!fetcher) {
    // No longer pass authManager - ProfileInfoFetcher gets auth from DDD system
    fetcher = new ProfileInfoFetcher();
  }
  return fetcher;
}

/**
 * Fetch information about a profile
 * @param {string} profileName - The profile's username
 * @param {string} [userId] - Optional Discord user ID for user-specific authentication
 * @returns {Promise<Object>} The profile information object
 */
async function fetchProfileInfo(profileName, userId = null) {
  return getFetcher().fetchProfileInfo(profileName, userId);
}

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @param {string} [userId] - Optional user ID for authentication
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName, userId = null) {
  logger.info(`[ProfileInfoFetcher] Getting avatar URL for: ${profileName}`);

  try {
    const profileInfo = await fetchProfileInfo(profileName, userId);

    if (!profileInfo) {
      logger.warn(`[ProfileInfoFetcher] No profile info found for avatar: ${profileName}`);
      return null;
    }
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
 * @param {string} [userId] - Optional user ID for authentication
 * @returns {Promise<string|null>} The display name or null if not found
 */
async function getProfileDisplayName(profileName, userId = null) {
  logger.info(`[ProfileInfoFetcher] Getting display name for: ${profileName}`);

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
  getFetcher().clearCache();
}

/**
 * Get the error message for a profile
 * @param {string} profileName - The profile's username
 * @param {string} [userId] - Optional user ID for authentication
 * @returns {Promise<string|null>} The error message or null if not found
 */
async function getProfileErrorMessage(profileName, userId = null) {
  logger.info(`[ProfileInfoFetcher] Getting error message for: ${profileName}`);

  try {
    const profileInfo = await fetchProfileInfo(profileName, userId);

    if (!profileInfo) {
      logger.warn(`[ProfileInfoFetcher] No profile info found for error message: ${profileName}`);
      return null;
    }

    // Check for error_message field in the response
    if (profileInfo.error_message) {
      logger.debug(
        `[ProfileInfoFetcher] Found error message for ${profileName}: ${profileInfo.error_message.substring(0, 100)}...`
      );
      return profileInfo.error_message;
    }

    // No error message found in profile info
    logger.debug(`[ProfileInfoFetcher] No error_message found for profile: ${profileName}`);
    return null;
  } catch (error) {
    logger.error(`[ProfileInfoFetcher] Error getting error message: ${error.message}`);
    return null;
  }
}

/**
 * Delete a specific profile from the cache
 * @param {string} profileName - The profile name to delete
 * @returns {boolean} True if the profile was deleted
 */
function deleteFromCache(profileName) {
  return getFetcher().deleteFromCache(profileName);
}

// Export the module
module.exports = {
  fetchProfileInfo,
  getProfileAvatarUrl,
  getProfileDisplayName,
  getProfileErrorMessage,
  deleteFromCache,
  // For testing
  _testing: {
    clearCache,
    getCache: () => getFetcher().getCache(),
    // Allow tests to inject dependencies
    setFetchImplementation: impl => {
      getFetcher().client.fetchImplementation = impl;
    },
    // Expose internals for testing
    getRateLimiter: () => getFetcher().rateLimiter,
    getFetcher: () => getFetcher(),
    // Allow tests to reset the singleton for clean test state
    resetFetcher: () => {
      fetcher = null;
    },
  },
};
