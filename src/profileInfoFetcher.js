// Import dependencies
const nodeFetch = require('node-fetch');
const { getProfileInfoEndpoint, getAvatarUrlFormat } = require('../config');
const logger = require('./logger');

// Cache for profile information to reduce API calls
const profileInfoCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Use this fetch implementation which allows for easier testing
// Wrapped in a function to make it easier to mock in tests
const fetchImplementation = (...args) => nodeFetch(...args);

/**
 * Fetch information about a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<Object>} The profile information object
 */
async function fetchProfileInfo(profileName) {
  try {
    logger.info(`[ProfileInfoFetcher] Fetching profile info for: ${profileName}`);

    // Check if we have a valid cached entry
    if (profileInfoCache.has(profileName)) {
      const cacheEntry = profileInfoCache.get(profileName);
      // If cache entry is still valid, return it
      if (Date.now() - cacheEntry.timestamp < CACHE_DURATION) {
        logger.info(`[ProfileInfoFetcher] Using cached profile data for: ${profileName}`);
        return cacheEntry.data;
      }
    }

    // Get the endpoint from our config
    const endpoint = getProfileInfoEndpoint(profileName);
    logger.debug(`[ProfileInfoFetcher] Using endpoint: ${endpoint}`);

    // No need to check for SERVICE_API_KEY since the profile API is public
    logger.debug(`[ProfileInfoFetcher] Using public API access for profile information`)

    // Fetch the data from the API (public access)
    logger.debug(`[ProfileInfoFetcher] Sending API request for: ${profileName}`);
    
    // Create an AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetchImplementation(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://discord.com/'
        },
        signal: controller.signal
      });
      
      // Clear the timeout since we got a response
      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(
          `[ProfileInfoFetcher] API response error: ${response.status} ${response.statusText}`
      );
      throw new Error(`Failed to fetch profile info: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    logger.debug(
      `[ProfileInfoFetcher] Received profile data: ${JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')}`
    );

    // Verify we have the expected fields
    if (!data) {
      logger.error(`[ProfileInfoFetcher] Received empty data for: ${profileName}`);
    } else if (!data.name) {
      logger.warn(`[ProfileInfoFetcher] Profile data missing 'name' field for: ${profileName}`);
    } else if (!data.id) {
      logger.warn(`[ProfileInfoFetcher] Profile data missing 'id' field for: ${profileName}`);
    }

    // Cache the result
    profileInfoCache.set(profileName, {
      data,
      timestamp: Date.now(),
    });
    logger.debug(`[ProfileInfoFetcher] Cached profile data for: ${profileName}`);

    return data;
    } catch (innerError) {
      // This inner catch handles fetch-specific errors
      clearTimeout(timeoutId);
      logger.error(`[ProfileInfoFetcher] Network error during profile fetch for ${profileName}: ${innerError.message}`);
      throw innerError; // Re-throw to be caught by the outer catch
    }
  } catch (error) {
    logger.error(`[ProfileInfoFetcher] Error fetching profile info for ${profileName}: ${error.message}`);
    return null;
  }
}

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName) {
  logger.info(`[ProfileInfoFetcher] Getting avatar URL for: ${profileName}`);
  const profileInfo = await fetchProfileInfo(profileName);

  if (!profileInfo) {
    logger.warn(`[ProfileInfoFetcher] No profile info found for avatar: ${profileName}`);
    return null;
  }

  try {
    // Check if avatar_url is directly available in the response
    if (profileInfo.avatar_url) {
      logger.debug(`[ProfileInfoFetcher] Using avatar_url directly from API response: ${profileInfo.avatar_url}`);
      
      // Validate that it's a properly formatted URL
      try {
        new URL(profileInfo.avatar_url); // Will throw if invalid URL
        return profileInfo.avatar_url;
      } catch (urlError) {
        logger.warn(`[ProfileInfoFetcher] Received invalid avatar_url from API: ${profileInfo.avatar_url}`);
        // Continue to fallback instead of returning invalid URL
      }
    }
    
    // Fallback to using ID-based URL format
    if (!profileInfo.id) {
      logger.warn(`[ProfileInfoFetcher] No profile ID found for avatar: ${profileName}`);
      return null;
    }
    
    // Get the avatar URL format from config
    const avatarUrlFormat = getAvatarUrlFormat();
    
    // Validate the avatar URL format from config
    if (!avatarUrlFormat || !avatarUrlFormat.includes('{id}')) {
      logger.error(`[ProfileInfoFetcher] Invalid avatarUrlFormat: "${avatarUrlFormat}". Check AVATAR_URL_BASE env variable.`);
      return null;
    }

    // Replace the placeholder with the actual profile ID
    const avatarUrl = avatarUrlFormat.replace('{id}', profileInfo.id);
    logger.debug(`[ProfileInfoFetcher] Generated avatar URL for ${profileName}: ${avatarUrl}`);
    
    // Validate the generated URL
    try {
      new URL(avatarUrl); // Will throw if invalid URL
      return avatarUrl;
    } catch (urlError) {
      logger.error(`[ProfileInfoFetcher] Generated invalid avatar URL: ${avatarUrl}`);
      return null;
    }
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
async function getProfileDisplayName(profileName) {
  logger.info(`[ProfileInfoFetcher] Getting display name for: ${profileName}`);
  const profileInfo = await fetchProfileInfo(profileName);

  if (!profileInfo) {
    logger.warn(`[ProfileInfoFetcher] No profile info found for display name: ${profileName}`);
    return null; // Return null to indicate failure, don't automatically use profileName
  }

  if (!profileInfo.name) {
    logger.warn(`[ProfileInfoFetcher] No name field in profile info for: ${profileName}`);
    return null; // Return null to indicate failure
  }

  logger.debug(`[ProfileInfoFetcher] Found display name for ${profileName}: ${profileInfo.name}`);
  return profileInfo.name;
}

// Exported for testing only
function clearCache() {
  profileInfoCache.clear();
}

module.exports = {
  fetchProfileInfo,
  getProfileAvatarUrl,
  getProfileDisplayName,
  // For testing
  _testing: {
    clearCache,
    getCache: () => profileInfoCache,
    setFetchImplementation: (newImpl) => {
      // This allows tests to override the fetchImplementation
      Object.defineProperty(module.exports, 'fetchImplementation', {
        value: newImpl,
        writable: true
      });
    }
  }
};