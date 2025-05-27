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

// Create a singleton instance
const fetcher = new ProfileInfoFetcher();

/**
 * Fetch information about a profile
 * @param {string} profileName - The profile's username
 * @param {string} [userId] - Optional Discord user ID for user-specific authentication
 * @returns {Promise<Object>} The profile information object
 */
async function fetchProfileInfo(profileName, userId = null) {
  return fetcher.fetchProfileInfo(profileName, userId);
}

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @param {string} [userId] - Optional user ID for authentication
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName, userId = null) {
  logger.info(`[ProfileInfoFetcher] Getting avatar URL for: ${profileName}`);

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
  fetcher.clearCache();
}

// Export the module
module.exports = {
  fetchProfileInfo,
  getProfileAvatarUrl,
  getProfileDisplayName,
  // For testing
  _testing: {
    clearCache,
    getCache: () => fetcher.getCache(),
    // Allow tests to inject dependencies
    setFetchImplementation: (impl) => {
      fetcher.client.fetchImplementation = impl;
    },
    // Expose internals for testing
    getRateLimiter: () => fetcher.rateLimiter,
    getFetcher: () => fetcher
  },
};