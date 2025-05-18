// Import dependencies
const nodeFetch = require('node-fetch');
const { getProfileInfoEndpoint, getAvatarUrlFormat } = require('../config');

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
    console.log(`[ProfileInfoFetcher] Fetching profile info for: ${profileName}`);

    // Check if we have a valid cached entry
    if (profileInfoCache.has(profileName)) {
      const cacheEntry = profileInfoCache.get(profileName);
      // If cache entry is still valid, return it
      if (Date.now() - cacheEntry.timestamp < CACHE_DURATION) {
        console.log(`[ProfileInfoFetcher] Using cached profile data for: ${profileName}`);
        return cacheEntry.data;
      }
    }

    // Get the endpoint from our config
    const endpoint = getProfileInfoEndpoint(profileName);
    console.log(`[ProfileInfoFetcher] Using endpoint: ${endpoint}`);

    // Check if API key is set
    if (!process.env.SERVICE_API_KEY) {
      console.warn(`[ProfileInfoFetcher] SERVICE_API_KEY environment variable is not set!`);
    }

    // Fetch the data from the API with authorization
    console.log(`[ProfileInfoFetcher] Sending API request for: ${profileName}`);
    const response = await fetchImplementation(endpoint, {
      headers: {
        Authorization: `Bearer ${process.env.SERVICE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(
        `[ProfileInfoFetcher] API response error: ${response.status} ${response.statusText}`
      );
      throw new Error(`Failed to fetch profile info: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(
      `[ProfileInfoFetcher] Received profile data:`,
      JSON.stringify(data).substring(0, 200) + (JSON.stringify(data).length > 200 ? '...' : '')
    );

    // Verify we have the expected fields
    if (!data) {
      console.error(`[ProfileInfoFetcher] Received empty data for: ${profileName}`);
    } else if (!data.name) {
      console.warn(`[ProfileInfoFetcher] Profile data missing 'name' field for: ${profileName}`);
    } else if (!data.id) {
      console.warn(`[ProfileInfoFetcher] Profile data missing 'id' field for: ${profileName}`);
    }

    // Cache the result
    profileInfoCache.set(profileName, {
      data,
      timestamp: Date.now(),
    });
    console.log(`[ProfileInfoFetcher] Cached profile data for: ${profileName}`);

    return data;
  } catch (error) {
    console.error(`[ProfileInfoFetcher] Error fetching profile info for ${profileName}:`, error);
    return null;
  }
}

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName) {
  console.log(`[ProfileInfoFetcher] Getting avatar URL for: ${profileName}`);
  const profileInfo = await fetchProfileInfo(profileName);

  if (!profileInfo || !profileInfo.id) {
    console.warn(`[ProfileInfoFetcher] No profile ID found for avatar: ${profileName}`);
    return null;
  }

  try {
    // Get the avatar URL format
    const avatarUrlFormat = getAvatarUrlFormat();

    // Replace the placeholder with the actual profile ID
    const avatarUrl = avatarUrlFormat.replace('{id}', profileInfo.id);
    console.log(`[ProfileInfoFetcher] Generated avatar URL for ${profileName}: ${avatarUrl}`);
    return avatarUrl;
  } catch (error) {
    console.error(`[ProfileInfoFetcher] Error generating avatar URL: ${error.message}`);
    return null;
  }
}

/**
 * Get the display name for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The display name or null if not found
 */
async function getProfileDisplayName(profileName) {
  console.log(`[ProfileInfoFetcher] Getting display name for: ${profileName}`);
  const profileInfo = await fetchProfileInfo(profileName);

  if (!profileInfo) {
    console.warn(`[ProfileInfoFetcher] No profile info found for display name: ${profileName}`);
    return profileName; // Fallback to using the full name as display name
  }

  if (!profileInfo.name) {
    console.warn(`[ProfileInfoFetcher] No name field in profile info for: ${profileName}`);
    return profileName; // Fallback to using the full name as display name
  }

  console.log(`[ProfileInfoFetcher] Found display name for ${profileName}: ${profileInfo.name}`);
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