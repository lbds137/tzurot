const fetch = require('node-fetch');
const { getProfileInfoEndpoint, getAvatarUrlFormat } = require('../config');

// Cache for profile information to reduce API calls
const profileInfoCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Fetch information about a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<Object>} The profile information object
 */
async function fetchProfileInfo(profileName) {
  try {
    // Check if we have a valid cached entry
    if (profileInfoCache.has(profileName)) {
      const cacheEntry = profileInfoCache.get(profileName);
      // If cache entry is still valid, return it
      if (Date.now() - cacheEntry.timestamp < CACHE_DURATION) {
        return cacheEntry.data;
      }
    }

    // Get the endpoint from our obfuscated config
    const endpoint = getProfileInfoEndpoint(profileName);

    // Fetch the data from the API
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch profile info: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Cache the result
    profileInfoCache.set(profileName, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  } catch (error) {
    console.error(`Error fetching profile info for ${profileName}:`, error);
    return null;
  }
}

/**
 * Get the avatar URL for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The avatar URL or null if not found
 */
async function getProfileAvatarUrl(profileName) {
  const profileInfo = await fetchProfileInfo(profileName);
  
  if (!profileInfo || !profileInfo.id) {
    return null;
  }
  
  // Get the avatar URL format from our obfuscated config
  const avatarUrlFormat = getAvatarUrlFormat();
  
  // Replace the placeholder with the actual profile ID
  return avatarUrlFormat.replace('{id}', profileInfo.id);
}

/**
 * Get the display name for a profile
 * @param {string} profileName - The profile's username
 * @returns {Promise<string|null>} The display name or null if not found
 */
async function getProfileDisplayName(profileName) {
  const profileInfo = await fetchProfileInfo(profileName);
  
  if (!profileInfo || !profileInfo.name) {
    return null;
  }
  
  return profileInfo.name;
}

module.exports = {
  fetchProfileInfo,
  getProfileAvatarUrl,
  getProfileDisplayName
};