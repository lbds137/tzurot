const { getProfileAvatarUrl, getProfileDisplayName } = require('./profileInfoFetcher');
const { saveData, loadData } = require('./dataStorage');
const logger = require('./logger');

// In-memory personality storage
const personalityData = new Map();
const personalityAliases = new Map();

// File names for stored data
const PERSONALITIES_FILE = 'personalities';
const ALIASES_FILE = 'aliases';

/**
 * Initialize the personality manager
 * @param {boolean} [deferOwnerPersonalities=false] - Whether to defer loading owner personalities
 * @returns {Promise<void>}
 */
async function initPersonalityManager(deferOwnerPersonalities = true) {
  try {
    // Load personalities
    const personalities = await loadData(PERSONALITIES_FILE);
    if (personalities) {
      logger.info(
        `[PersonalityManager] Loading personalities from file: ${Object.keys(personalities).length} found`
      );
      for (const [key, value] of Object.entries(personalities)) {
        // Skip entries where the key doesn't match the fullName (duplicate entries from previous bug)
        if (key !== value.fullName) {
          logger.warn(
            `[PersonalityManager] Key ${key} doesn't match fullName ${value.fullName} - skipping this entry`
          );
          continue;
        }
        personalityData.set(key, value);
      }
      logger.info(`[PersonalityManager] Loaded ${personalityData.size} personalities`);
    }

    // Load aliases
    const aliases = await loadData(ALIASES_FILE);
    if (aliases) {
      logger.info(`[PersonalityManager] Loading aliases from file: ${Object.keys(aliases).length} found`);
      for (const [key, value] of Object.entries(aliases)) {
        personalityAliases.set(key, value);
      }
      logger.info(`[PersonalityManager] Loaded ${personalityAliases.size} aliases`);
    }
    
    // Pre-seed personalities for the bot owner if needed
    if (deferOwnerPersonalities) {
      // Schedule owner personalities loading to happen in the background
      logger.info('[PersonalityManager] Deferring owner personality seeding to run in background');
      setTimeout(() => {
        seedOwnerPersonalities()
          .then(() => logger.info('[PersonalityManager] Background owner personality seeding completed'))
          .catch(err => logger.error(`[PersonalityManager] Background owner personality seeding error: ${err.message}`));
      }, 500); // Small delay to let other initialization finish
    } else {
      // Directly load owner personalities (the old way)
      logger.info('[PersonalityManager] Loading owner personalities synchronously');
      await seedOwnerPersonalities();
    }
  } catch (error) {
    logger.error(`[PersonalityManager] Error initializing personality manager: ${error}`);
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

    logger.info(
      `[PersonalityManager] Saving ${Object.keys(personalities).length} personalities and ${Object.keys(aliases).length} aliases`
    );

    // Save to files
    await saveData(PERSONALITIES_FILE, personalities);
    await saveData(ALIASES_FILE, aliases);
  } catch (error) {
    logger.error(`Error saving personalities: ${error}`);
    throw error;
  }
}

/**
 * Registers a new personality for a user with optional profile information fetching
 *
 * @param {string} userId - The Discord user ID of the personality owner
 * @param {string} fullName - The full name/identifier of the personality
 * @param {Object} data - Additional data for configuring the personality
 * @param {string} [data.displayName] - Display name to use (falls back to fullName)
 * @param {string} [data.avatarUrl] - URL to profile avatar
 * @param {string} [data.description] - Description of the personality
 * @param {boolean} [fetchInfo=true] - Whether to fetch additional profile info automatically
 * @returns {Promise<Object>} The complete registered personality object
 *
 * @description
 * This core function creates a new personality entry in the system.
 * It performs the following steps:
 * 1. Creates a basic personality object with the provided information
 * 2. If fetchInfo is true, retrieves display name and avatar URL from profile service
 * 3. Creates display name aliases for improved usability
 * 4. Adds the personality to the internal registry
 * 5. Persists the personality data to storage
 *
 * The fetchInfo parameter is critical for preventing race conditions when
 * registering personalities and fetching profile info from multiple code paths.
 */
async function registerPersonality(userId, fullName, data, fetchInfo = true) {
  logger.info(`[PersonalityManager] Registering new personality: ${fullName} for user: ${userId}`);

  // Start building the personality object
  const personality = {
    fullName,
    displayName: data.displayName || fullName,
    avatarUrl: data.avatarUrl || null,
    description: data.description || '',
    createdBy: userId,
    createdAt: Date.now(),
  };

  // Skip automatic profile info fetching if requested by commands.js
  // This prevents race conditions where profile info is fetched twice
  if (fetchInfo) {
    logger.info(`[PersonalityManager] Fetching profile info for: ${fullName}`);
    try {
      // Try to get the display name and avatar URL concurrently for efficiency
      const [profileName, avatarUrl] = await Promise.all([
        getProfileDisplayName(fullName),
        getProfileAvatarUrl(fullName),
      ]);

      // Log the raw results to help with debugging
      logger.debug(`[PersonalityManager] Raw profile fetch results - name: ${profileName}, avatar: ${avatarUrl}`);

      // Check if we successfully got a display name
      if (profileName) {
        logger.info(`[PersonalityManager] Got display name: ${profileName}`);
        personality.displayName = profileName;
      } else {
        // If we didn't get a display name from the API, maintain the default
        logger.warn(`[PersonalityManager] Failed to get display name from API, keeping default: ${personality.displayName}`);
      }

      // Check if we successfully got an avatar URL
      if (avatarUrl) {
        logger.info(`[PersonalityManager] Got avatar URL: ${avatarUrl}`);
        personality.avatarUrl = avatarUrl;
      } else {
        // If we didn't get an avatar URL, log this clearly
        logger.warn(`[PersonalityManager] Failed to get avatar URL from API, keeping default: ${personality.avatarUrl || 'null'}`);
      }

      // Verify the retrieved data is valid
      if (personality.displayName) {
        logger.info(`[PersonalityManager] Verified display name: ${personality.displayName}`);
      } else {
        logger.warn(`[PersonalityManager] No display name retrieved, using fullName as fallback`);
        personality.displayName = fullName;
      }

      if (personality.avatarUrl) {
        logger.info(`[PersonalityManager] Verified avatar URL: ${personality.avatarUrl}`);
      }
    } catch (error) {
      logger.error(`[PersonalityManager] Error fetching info for ${fullName}: ${error}`);
      // Continue with the process even if fetching fails
    }
  } else {
    logger.info(
      `[PersonalityManager] Skipping auto-fetch of profile info as requested - will be handled by caller`
    );
  }

  // Store the personality data first - do this before setting aliases
  logger.info(
    `[PersonalityManager] Storing personality with fullName key: ${fullName} ${JSON.stringify({
      fullName: personality.fullName,
      displayName: personality.displayName,
      hasAvatar: !!personality.avatarUrl,
    })}`
  );
  personalityData.set(fullName, personality);

  // Save the personality data immediately
  await saveAllPersonalities();
  logger.info(`[PersonalityManager] Saved personality data for: ${fullName}`);

  // CRITICAL FIX: We're fixing duplication between this function and commands.js
  // The only alias we set here is the self-referential alias using the full name
  // But we NEVER save - commands.js will handle all saving operations

  // CRITICAL FIX: Don't set self-referential alias here at all!
  // This was causing the first embed to be sent too early
  // Instead, commands.js will handle ALL alias creation including the self-referential one

  // Log this critical change for debugging
  logger.info(
    `[PersonalityManager] ⚠️ CRITICAL FIX: Skipping self-referential alias creation here to prevent double embeds`
  );
  logger.info(`[PersonalityManager] All alias handling and saving deferred to commands.js`);

  // Double-check that we're returning a valid personality object
  if (!personality || !personality.fullName) {
    logger.error(
      `[PersonalityManager] ERROR: About to return invalid personality object: ${JSON.stringify(personality)}`
    );
    // Create a minimal valid personality object as fallback
    return {
      fullName: fullName,
      displayName: personality?.displayName || fullName,
      avatarUrl: personality?.avatarUrl || null,
      description: personality?.description || '',
      createdBy: userId,
      createdAt: Date.now(),
    };
  }

  logger.info(`[PersonalityManager] Successfully returning personality: ${JSON.stringify({
    fullName: personality.fullName,
    displayName: personality.displayName,
  })}`);

  return personality;
}

/**
 * Retrieves a personality from the registry by its full name
 *
 * @param {string} fullName - The full name/identifier of the personality to retrieve
 * @returns {Object|null} The complete personality object or null if not found
 *
 * @description
 * This is a critical lookup function used throughout the system to access
 * personality data. It's case-sensitive and requires the exact full name.
 * Returns null if the personality doesn't exist to allow for safe fallbacks.
 *
 * For case-insensitive or alias-based lookups, use getPersonalityByAlias instead.
 *
 * @example
 * // Get personality data for a specific profile
 * const personality = getPersonality("dr-albert-hoffman");
 * if (personality) {
 *   // Use the personality data
 *   console.log(`Found: ${personality.displayName}`);
 * }
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
 * Set an alias for a personality with enhanced duplicate checking and collision handling
 * @param {string} alias - The alias to set
 * @param {string} fullName - Full personality name
 * @param {boolean} skipSave - Skip saving to prevent multiple embed responses
 * @param {boolean} isDisplayName - Whether this alias is from a display name (affects collision handling)
 * @returns {Promise<Object>} Result object with success flag and any alternate aliases created
 */
async function setPersonalityAlias(alias, fullName, skipSave = true, isDisplayName = false) {
  // CRITICAL FIX: Default skipSave to true to prevent ANY automatic saves
  logger.info(
    `[PersonalityManager] Setting alias: ${alias} -> ${fullName} (skipSave: ${skipSave}, isDisplayName: ${isDisplayName})`
  );

  const result = {
    success: false,
    alternateAliases: [], // Track any alternate aliases created for collisions
  };

  if (!alias) {
    logger.error(`[PersonalityManager] Cannot set empty alias for ${fullName}`);
    return result;
  }

  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = safeToLowerCase(alias);

  // Verify the personality exists
  if (!personalityData.has(fullName)) {
    logger.error(`[PersonalityManager] Cannot set alias to non-existent personality: ${fullName}`);
    return result;
  }

  // CRITICAL FIX: Check if this alias already exists and points to the same personality
  if (personalityAliases.has(normalizedAlias)) {
    const existingTarget = personalityAliases.get(normalizedAlias);

    // If the alias already points to the same personality, just return success without saving
    if (existingTarget === fullName) {
      logger.info(
        `[PersonalityManager] Alias ${normalizedAlias} already points to ${fullName} - no changes needed`
      );
      result.success = true;
      return result;
    }

    // Handle aliases from display names differently - avoid collisions by appending the personality's initials
    if (isDisplayName) {
      logger.warn(
        `[PersonalityManager] Display name alias ${normalizedAlias} already exists for ${existingTarget}!`
      );

      // For display name collisions, we'll generate a unique alias by including a portion of the full name
      // We'll take the first character of each word in the full name
      const words = fullName.split('-');
      const initials = words.map(word => word.charAt(0)).join('');
      const altAlias = `${normalizedAlias}-${initials}`;

      logger.info(
        `[PersonalityManager] Creating alternate alias for display name collision: ${altAlias} -> ${fullName}`
      );
      personalityAliases.set(altAlias, fullName);

      // Add to the list of alternate aliases
      result.alternateAliases.push(altAlias);

      // We never automatically save here - this will be done at the end of the add process
      logger.info(
        `[PersonalityManager] No automatic save for alternate alias - will be saved at end of process`
      );

      result.success = true;
      return result;
    }

    // For manual aliases, we'll warn and overwrite
    logger.warn(
      `[PersonalityManager] Alias ${normalizedAlias} currently points to ${existingTarget}, will be changed to ${fullName}`
    );
  }

  // Set the alias
  logger.info(`[PersonalityManager] Setting alias mapping: ${normalizedAlias} -> ${fullName}`);
  personalityAliases.set(normalizedAlias, fullName);

  // CRITICAL: We never automatically save here - the caller is responsible for calling saveAllPersonalities
  // exactly once at the very end of the process
  logger.info(`[PersonalityManager] No automatic save for alias - will be saved at end of process`);

  result.success = true;
  return result;
}

/**
 * Retrieves a personality using a friendly alias or nickname
 *
 * @param {string} alias - The alias or nickname to look up
 * @returns {Object|null} The complete personality object or null if not found
 *
 * @description
 * This function provides a more flexible lookup mechanism than getPersonality().
 * It:
 * 1. Performs case-insensitive matching
 * 2. Looks up personalities by their aliases/nicknames
 * 3. Handles display names as aliases automatically
 * 4. Includes proper error handling for null input
 *
 * This is the recommended way to look up personalities from user input,
 * as it's more forgiving and matches how users typically refer to personalities.
 *
 * @example
 * // Users can type "albert" instead of "dr-albert-hoffman"
 * const personality = getPersonalityByAlias("albert");
 */
function getPersonalityByAlias(alias) {
  if (!alias) {
    logger.warn(`[PersonalityManager] Attempted to get personality with empty alias`);
    return null;
  }

  // Convert alias to lowercase for case-insensitive lookup
  const normalizedAlias = safeToLowerCase(alias);
  logger.debug(
    `[PersonalityManager] Looking up personality by normalized alias: ${normalizedAlias}`
  );

  // Look up the full name from the alias
  const fullName = personalityAliases.get(normalizedAlias);
  if (!fullName) {
    logger.debug(`[PersonalityManager] No personality found for alias: ${normalizedAlias}`);
    return null;
  }

  logger.debug(`[PersonalityManager] Found fullName for alias ${normalizedAlias}: ${fullName}`);

  // Return the personality data
  const personality = getPersonality(fullName);
  if (!personality) {
    logger.warn(
      `[PersonalityManager] Found alias ${normalizedAlias} -> ${fullName}, but personality doesn't exist`
    );
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

/**
 * Pre-seeds the bot owner with default personalities from constants.js
 * Only adds personalities if they don't already exist for the owner
 * Uses parallel processing to avoid blocking app startup
 */
async function seedOwnerPersonalities() {
  // Import constants
  const { USER_CONFIG } = require('./constants');
  
  // Check if USER_CONFIG is defined with owner personalities
  if (!USER_CONFIG || !USER_CONFIG.OWNER_ID || !USER_CONFIG.OWNER_PERSONALITIES_LIST) {
    logger.debug('[PersonalityManager] No owner personalities defined in constants, skipping auto-seeding');
    return;
  }
  
  const ownerId = USER_CONFIG.OWNER_ID;
  // Parse the comma-separated list into an array
  const personalitiesList = USER_CONFIG.OWNER_PERSONALITIES_LIST.trim();
  const ownerPersonalities = personalitiesList ? personalitiesList.split(',').map(p => p.trim()) : [];
  
  // Get current owner personalities
  const existingPersonalities = listPersonalitiesForUser(ownerId);
  const existingPersonalityNames = new Set(existingPersonalities.map(p => p.fullName));
  
  logger.info(`[PersonalityManager] Checking auto-seeding for owner (${ownerId}): ${ownerPersonalities.length} personalities defined`);
  logger.info(`[PersonalityManager] Owner already has ${existingPersonalities.length} personalities`);
  
  // Filter out personalities that already exist or are empty
  const personalitiesToAdd = ownerPersonalities.filter(name => 
    name && !existingPersonalityNames.has(name)
  );
  
  if (personalitiesToAdd.length === 0) {
    logger.info('[PersonalityManager] No new personalities needed to be seeded.');
    return;
  }
  
  logger.info(`[PersonalityManager] Will seed ${personalitiesToAdd.length} new personalities in parallel`);
  
  // Create an array of promises for parallel execution
  const personalityPromises = personalitiesToAdd.map(async (personalityName) => {
    logger.info(`[PersonalityManager] Auto-seeding owner personality: ${personalityName}`);
    try {
      // Register the personality for the owner
      const personality = await registerPersonality(ownerId, personalityName, {
        description: `Auto-added from constants.js for bot owner`
      }, true); // true = fetch profile info
      
      // After registration, the display name will be populated
      if (personality && personality.displayName) {
        logger.info(`[PersonalityManager] Added ${personalityName} with display name: ${personality.displayName}`);
        
        // Handle self-referential alias (similar to the add command)
        await setPersonalityAlias(personalityName.toLowerCase(), personalityName, true); // Skip save
        
        // For consistency with the add command, also set display name as an alias if different
        if (personality.displayName.toLowerCase() !== personalityName.toLowerCase()) {
          await setPersonalityAlias(personality.displayName.toLowerCase(), personalityName, true); // Skip save
        }
      }
      
      logger.info(`[PersonalityManager] Successfully added owner personality: ${personalityName}`);
      return personality;
    } catch (error) {
      logger.error(`[PersonalityManager] Error auto-seeding personality ${personalityName}: ${error.message}`);
      return null;
    }
  });
  
  // Execute all registration requests in parallel and wait for completion
  try {
    const results = await Promise.all(personalityPromises);
    const addedPersonalities = results.filter(p => p !== null);
    
    // Finally, save all personalities and aliases if any were added
    if (addedPersonalities.length > 0) {
      await saveAllPersonalities();
      logger.info(`[PersonalityManager] Successfully auto-seeded ${addedPersonalities.length} personalities for owner`);
    } else {
      logger.info('[PersonalityManager] No personalities were successfully seeded.');
    }
  } catch (error) {
    logger.error(`[PersonalityManager] Error during parallel personality seeding: ${error.message}`);
  }
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
  saveAllPersonalities,
  seedOwnerPersonalities, // Export for testing/manual seeding
};
