const { getProfileAvatarUrl, getProfileDisplayName } = require('./profileInfoFetcher');

// In-memory personality storage
// In a production environment, you'd use a database
const personalityData = new Map();
const personalityAliases = new Map();

/**
 * Register a new personality 
 * @param {string} userId - Discord user ID who owns this personality
 * @param {string} fullName - Full name/identifier of the personality
 * @param {Object} data - Personality data
 * @param {boolean} fetchInfo - Whether to fetch info from shapes.inc
 * @returns {Promise<Object>} The created personality
 */
async function registerPersonality(userId, fullName, data, fetchInfo = true) {
  // Start building the personality object
  const personality = {
    fullName,
    displayName: data.displayName || fullName,
    avatarUrl: data.avatarUrl || null,
    description: data.description || '',
    createdBy: userId,
    createdAt: Date.now()
  };
  
  // If fetchInfo is true, try to get display name and avatar from shapes.inc
  if (fetchInfo) {
    try {
      // Try to get the display name
      const profileName = await getProfileDisplayName(fullName);
      if (profileName) {
        personality.displayName = profileName;
      }
      
      // Try to get the avatar URL
      const avatarUrl = await getProfileAvatarUrl(fullName);
      if (avatarUrl) {
        personality.avatarUrl = avatarUrl;
      }
    } catch (error) {
      console.error(`Error fetching info for ${fullName}:`, error);
      // Continue with the process even if fetching fails
    }
  }

  // Store the personality
  personalityData.set(fullName, personality);
  
  // Create the default alias (lowercase version of displayName)
  const defaultAlias = personality.displayName.toLowerCase();
  setPersonalityAlias(defaultAlias, fullName);
  
  return personality;
}

/**
 * Get a personality by its full name
 * @param {string} fullName - Full personality name
 * @returns {Object|null} The personality data or null if not found
 */
function getPersonality(fullName) {
  return personalityData.get(fullName) || null;
}

/**
 * Set an alias for a personality
 * @param {string} alias - The alias to set
 * @param {string} fullName - Full personality name
 * @returns {boolean} Success indicator
 */
function setPersonalityAlias(alias, fullName) {
  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = alias.toLowerCase();
  
  // Verify the personality exists
  if (!personalityData.has(fullName)) {
    return false;
  }
  
  // Set the alias
  personalityAliases.set(normalizedAlias, fullName);
  return true;
}

/**
 * Get personality by alias
 * @param {string} alias - The alias to look up
 * @returns {Object|null} The personality data or null if not found
 */
function getPersonalityByAlias(alias) {
  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = alias.toLowerCase();
  
  // Look up the full name from the alias
  const fullName = personalityAliases.get(normalizedAlias);
  if (!fullName) {
    return null;
  }
  
  // Return the personality data
  return getPersonality(fullName);
}

/**
 * Remove a personality and all its aliases
 * @param {string} fullName - Full personality name
 * @returns {boolean} Success indicator
 */
function removePersonality(fullName) {
  // Verify the personality exists
  if (!personalityData.has(fullName)) {
    return false;
  }
  
  // Remove all aliases that point to this personality
  for (const [alias, name] of personalityAliases.entries()) {
    if (name === fullName) {
      personalityAliases.delete(alias);
    }
  }
  
  // Remove the personality itself
  personalityData.delete(fullName);
  return true;
}

/**
 * List all personalities for a user
 * @param {string} userId - Discord user ID
 * @returns {Array} Array of personality objects
 */
function listPersonalitiesForUser(userId) {
  const userPersonalities = [];
  
  for (const personality of personalityData.values()) {
    if (personality.createdBy === userId) {
      userPersonalities.push(personality);
    }
  }
  
  return userPersonalities;
}

module.exports = {
  registerPersonality,
  getPersonality,
  setPersonalityAlias,
  getPersonalityByAlias,
  removePersonality,
  listPersonalitiesForUser,
  personalityAliases
};