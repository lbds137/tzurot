const { getProfileAvatarUrl, getProfileDisplayName } = require('./profileInfoFetcher');
const { saveData, loadData } = require('./dataStorage');

// In-memory personality storage
const personalityData = new Map();
const personalityAliases = new Map();

// File names for stored data
const PERSONALITIES_FILE = 'personalities';
const ALIASES_FILE = 'aliases';

/**
 * Initialize the personality manager
 */
async function initPersonalityManager() {
  try {
    // Load personalities
    const personalities = await loadData(PERSONALITIES_FILE);
    if (personalities) {
      for (const [key, value] of Object.entries(personalities)) {
        personalityData.set(key, value);
      }
      console.log(`Loaded ${personalityData.size} personalities`);
    }
    
    // Load aliases
    const aliases = await loadData(ALIASES_FILE);
    if (aliases) {
      for (const [key, value] of Object.entries(aliases)) {
        personalityAliases.set(key, value);
      }
      console.log(`Loaded ${personalityAliases.size} aliases`);
    }
  } catch (error) {
    console.error('Error initializing personality manager:', error);
    throw error;
  }
}

/**
 * Save all personality data
 */
async function saveAllPersonalities() {
  try {
    // Convert Maps to objects for storage
    const personalities = Object.fromEntries(personalityData);
    const aliases = Object.fromEntries(personalityAliases);
    
    // Save to files
    await saveData(PERSONALITIES_FILE, personalities);
    await saveData(ALIASES_FILE, aliases);
  } catch (error) {
    console.error('Error saving personalities:', error);
    throw error;
  }
}

/**
 * Register a new personality 
 * @param {string} userId - Discord user ID who owns this personality
 * @param {string} fullName - Full name/identifier of the personality
 * @param {Object} data - Personality data
 * @param {boolean} fetchInfo - Whether to fetch info from API
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
  
  // If fetchInfo is true, try to get display name and avatar
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
  
  // Save the data
  await saveAllPersonalities();
  
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
 * @returns {Promise<boolean>} Success indicator
 */
async function setPersonalityAlias(alias, fullName) {
  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = alias.toLowerCase();
  
  // Verify the personality exists
  if (!personalityData.has(fullName)) {
    return false;
  }
  
  // Set the alias
  personalityAliases.set(normalizedAlias, fullName);
  
  // Save the data
  await saveAllPersonalities();
  
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
 * @returns {Promise<boolean>} Success indicator
 */
async function removePersonality(fullName) {
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
  
  // Save the data
  await saveAllPersonalities();
  
  return true;
}

/**
 * List all personalities for a user
 * @param {string} userId - Discord user ID (optional)
 * @returns {Array} Array of personality objects
 */
function listPersonalitiesForUser(userId) {
  const userPersonalities = [];
  
  // If no userId provided, return all personalities
  if (!userId) {
    return Array.from(personalityData.values());
  }
  
  for (const personality of personalityData.values()) {
    if (personality.createdBy === userId) {
      userPersonalities.push(personality);
    }
  }
  
  return userPersonalities;
}

module.exports = {
  initPersonalityManager,
  registerPersonality,
  getPersonality,
  setPersonalityAlias,
  getPersonalityByAlias,
  removePersonality,
  listPersonalitiesForUser,
  personalityAliases
};