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
      console.log(`[PersonalityManager] Loading personalities from file:`, Object.keys(personalities));
      for (const [key, value] of Object.entries(personalities)) {
        console.log(`[PersonalityManager] Loading personality: ${key} -> ${value.fullName}`);
        // Skip entries where the key doesn't match the fullName (duplicate entries from previous bug)
        if (key !== value.fullName) {
          console.log(`[PersonalityManager] WARNING: Key ${key} doesn't match fullName ${value.fullName} - skipping this entry`);
          continue;
        }
        personalityData.set(key, value);
      }
      console.log(`[PersonalityManager] Loaded ${personalityData.size} personalities`);
    }
    
    // Load aliases
    const aliases = await loadData(ALIASES_FILE);
    if (aliases) {
      console.log(`[PersonalityManager] Loading aliases from file:`, aliases);
      for (const [key, value] of Object.entries(aliases)) {
        personalityAliases.set(key, value);
      }
      console.log(`[PersonalityManager] Loaded ${personalityAliases.size} aliases`);
    }
  } catch (error) {
    console.error('[PersonalityManager] Error initializing personality manager:', error);
    throw error;
  }
}

/**
 * Save all personality data
 */
async function saveAllPersonalities() {
  try {
    // Convert Maps to objects for storage
    const personalities = {};
    for (const [key, value] of personalityData.entries()) {
      personalities[key] = value;
    }
    
    const aliases = {};
    for (const [key, value] of personalityAliases.entries()) {
      aliases[key] = value;
    }
    
    console.log(`[PersonalityManager] Saving ${Object.keys(personalities).length} personalities and ${Object.keys(aliases).length} aliases`);
    
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
  console.log(`[PersonalityManager] Registering new personality: ${fullName} for user: ${userId}`);
  
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
      console.log(`[PersonalityManager] Fetching profile info for: ${fullName}`);
      // Try to get the display name
      const profileName = await getProfileDisplayName(fullName);
      if (profileName) {
        console.log(`[PersonalityManager] Got display name: ${profileName}`);
        personality.displayName = profileName;
      }
      
      // Try to get the avatar URL
      const avatarUrl = await getProfileAvatarUrl(fullName);
      if (avatarUrl) {
        console.log(`[PersonalityManager] Got avatar URL: ${avatarUrl}`);
        personality.avatarUrl = avatarUrl;
      }
    } catch (error) {
      console.error(`[PersonalityManager] Error fetching info for ${fullName}:`, error);
      // Continue with the process even if fetching fails
    }
  }
  
  // Store the personality data first - do this before setting aliases
  console.log(`[PersonalityManager] Storing personality with fullName key: ${fullName}`);
  personalityData.set(fullName, personality);
  
  // Save the personality data immediately
  await saveAllPersonalities();
  console.log(`[PersonalityManager] Saved personality data for: ${fullName}`);
  
  // Create the default alias (lowercase version of displayName) as a separate operation
  if (personality.displayName) {
    const defaultAlias = safeToLowerCase(personality.displayName);
    console.log(`[PersonalityManager] Setting default alias: ${defaultAlias} -> ${fullName}`);
    
    // Make sure we don't create a duplicate entry by using the alias as a key in personalityData
    if (defaultAlias !== safeToLowerCase(fullName)) {
      await setPersonalityAlias(defaultAlias, fullName);
      console.log(`[PersonalityManager] Set and saved alias: ${defaultAlias} -> ${fullName}`);
    } else {
      console.log(`[PersonalityManager] Skipping default alias since it matches fullName: ${defaultAlias}`);
    }
  } else {
    console.log(`[PersonalityManager] No display name available, using full name as alias`);
    const defaultAlias = safeToLowerCase(fullName);
    await setPersonalityAlias(defaultAlias, fullName);
    console.log(`[PersonalityManager] Set and saved fallback alias: ${defaultAlias} -> ${fullName}`);
  }
  
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
 * Helper function to safely get lowercase version of a string
 * @param {*} str - The input string or value to convert
 * @returns {string} The lowercase string or empty string if input was invalid
 */
function safeToLowerCase(str) {
  if (!str) return '';
  return String(str).toLowerCase();
}

/**
 * Set an alias for a personality
 * @param {string} alias - The alias to set
 * @param {string} fullName - Full personality name
 * @returns {Promise<boolean>} Success indicator
 */
async function setPersonalityAlias(alias, fullName) {
  console.log(`[PersonalityManager] Setting alias: ${alias} -> ${fullName}`);
  
  if (!alias) {
    console.error(`[PersonalityManager] Cannot set empty alias for ${fullName}`);
    return false;
  }
  
  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = safeToLowerCase(alias);
  
  // Verify the personality exists
  if (!personalityData.has(fullName)) {
    console.error(`[PersonalityManager] Cannot set alias to non-existent personality: ${fullName}`);
    return false;
  }
  
  // Set the alias
  console.log(`[PersonalityManager] Setting alias mapping: ${normalizedAlias} -> ${fullName}`);
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
  if (!alias) {
    console.warn(`[PersonalityManager] Attempted to get personality with empty alias`);
    return null;
  }
  
  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = safeToLowerCase(alias);
  console.log(`[PersonalityManager] Looking up personality by normalized alias: ${normalizedAlias}`);
  
  // Look up the full name from the alias
  const fullName = personalityAliases.get(normalizedAlias);
  if (!fullName) {
    console.log(`[PersonalityManager] No personality found for alias: ${normalizedAlias}`);
    return null;
  }
  
  console.log(`[PersonalityManager] Found fullName for alias ${normalizedAlias}: ${fullName}`);
  
  // Return the personality data
  const personality = getPersonality(fullName);
  if (!personality) {
    console.warn(`[PersonalityManager] Found alias ${normalizedAlias} -> ${fullName}, but personality doesn't exist`);
  }
  
  return personality;
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