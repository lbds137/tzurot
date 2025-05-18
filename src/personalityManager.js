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
  
  // Skip automatic profile info fetching if requested by commands.js
  // This prevents race conditions where profile info is fetched twice
  if (fetchInfo) {
    console.log(`[PersonalityManager] Fetching profile info for: ${fullName}`);
    try {
      // Try to get the display name and avatar URL concurrently for efficiency
      const [profileName, avatarUrl] = await Promise.all([
        getProfileDisplayName(fullName),
        getProfileAvatarUrl(fullName)
      ]);
      
      if (profileName) {
        console.log(`[PersonalityManager] Got display name: ${profileName}`);
        personality.displayName = profileName;
      }
      
      if (avatarUrl) {
        console.log(`[PersonalityManager] Got avatar URL: ${avatarUrl}`);
        personality.avatarUrl = avatarUrl;
      }
      
      // Verify the retrieved data is valid
      if (personality.displayName) {
        console.log(`[PersonalityManager] Verified display name: ${personality.displayName}`);
      } else {
        console.warn(`[PersonalityManager] No display name retrieved, using fullName as fallback`);
        personality.displayName = fullName;
      }
      
      if (personality.avatarUrl) {
        console.log(`[PersonalityManager] Verified avatar URL: ${personality.avatarUrl}`);
      }
    } catch (error) {
      console.error(`[PersonalityManager] Error fetching info for ${fullName}:`, error);
      // Continue with the process even if fetching fails
    }
  } else {
    console.log(`[PersonalityManager] Skipping auto-fetch of profile info as requested - will be handled by caller`);
  }
  
  // Store the personality data first - do this before setting aliases
  console.log(`[PersonalityManager] Storing personality with fullName key: ${fullName}`, JSON.stringify({
    fullName: personality.fullName,
    displayName: personality.displayName,
    hasAvatar: !!personality.avatarUrl
  }));
  personalityData.set(fullName, personality);
  
  // Save the personality data immediately
  await saveAllPersonalities();
  console.log(`[PersonalityManager] Saved personality data for: ${fullName}`);
  
  // CRITICAL FIX: We're setting aliases here AND in commands.js which is causing duplicate embeds
  // We'll only set an initial basic alias here, and let commands.js handle the display name alias
  
  // Just set a basic self-referential alias using the full name for initial registration
  // This ensures the personality can at least be found by its own name
  const selfAlias = safeToLowerCase(fullName);
  
  // Check if this alias already exists to avoid duplicate settings
  if (!personalityAliases.has(selfAlias)) {
    console.log(`[PersonalityManager] Setting basic self alias: ${selfAlias} -> ${fullName}`);
    try {
      // Set the alias directly without calling the function to avoid triggering a save
      personalityAliases.set(selfAlias, fullName);
      
      // We already called saveAllPersonalities() above, so we don't need to do it again
      // This prevents multiple embed responses by avoiding multiple saves
      console.log(`[PersonalityManager] Set basic self alias (saving handled by caller): ${selfAlias} -> ${fullName}`);
    } catch (error) {
      console.error(`[PersonalityManager] Error setting basic self alias:`, error);
      // Continue despite error
    }
  } else {
    console.log(`[PersonalityManager] Basic self alias ${selfAlias} already exists - skipping`);
  }
  
  // We skip setting the display name alias here as it will be handled in commands.js
  console.log(`[PersonalityManager] Display name alias handling deferred to commands.js`);
  
  
  // Double-check that we're returning a valid personality object
  if (!personality || !personality.fullName) {
    console.error(`[PersonalityManager] ERROR: About to return invalid personality object:`, personality);
    // Create a minimal valid personality object as fallback
    return {
      fullName: fullName,
      displayName: personality?.displayName || fullName,
      avatarUrl: personality?.avatarUrl || null,
      description: personality?.description || '',
      createdBy: userId,
      createdAt: Date.now()
    };
  }
  
  console.log(`[PersonalityManager] Successfully returning personality:`, {
    fullName: personality.fullName,
    displayName: personality.displayName
  });
  
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
 * Set an alias for a personality with enhanced duplicate checking
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
  
  // CRITICAL FIX: Check if this alias already exists and points to the same personality
  if (personalityAliases.has(normalizedAlias)) {
    const existingTarget = personalityAliases.get(normalizedAlias);
    
    // If the alias already points to the same personality, just return success without saving
    if (existingTarget === fullName) {
      console.log(`[PersonalityManager] Alias ${normalizedAlias} already points to ${fullName} - no changes needed`);
      return true;
    }
    
    // If it points to a different personality, log a warning but continue
    console.warn(`[PersonalityManager] Alias ${normalizedAlias} currently points to ${existingTarget}, will be changed to ${fullName}`);
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
  personalityAliases,
  saveAllPersonalities  // Added this export
};