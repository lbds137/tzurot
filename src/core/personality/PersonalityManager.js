const PersonalityRegistry = require('./PersonalityRegistry');
const PersonalityPersistence = require('./PersonalityPersistence');
const PersonalityValidator = require('./PersonalityValidator');
const {
  getProfileAvatarUrl,
  getProfileDisplayName,
  getProfileErrorMessage,
} = require('../../profileInfoFetcher');
const logger = require('../../logger');
const avatarStorage = require('../../utils/avatarStorage');

/**
 * PersonalityManager - Main facade for personality management
 *
 * This class coordinates between the registry, persistence, and validation
 * components to provide a unified interface for personality operations.
 */
class PersonalityManager {
  constructor(options = {}) {
    this.registry = new PersonalityRegistry();
    this.persistence = new PersonalityPersistence();
    this.validator = new PersonalityValidator();
    this.initialized = false;
    this.options = options;

    // Injectable delay function for testability
    this.delay =
      options.delay ||
      (ms => {
        const timer = globalThis.setTimeout || setTimeout;
        return new Promise(resolve => timer(resolve, ms));
      });
  }

  /**
   * Initialize the personality manager
   * @param {boolean} [deferOwnerPersonalities=true] - Whether to defer loading owner personalities
   * @param {Object} [options={}] - Configuration options
   * @returns {Promise<void>}
   */
  async initialize(deferOwnerPersonalities = true, options = {}) {
    try {
      logger.info('[PersonalityManager] Initializing...');

      // Initialize avatar storage system
      await avatarStorage.initialize();
      logger.info('[PersonalityManager] Avatar storage initialized');

      // Load data from persistence
      const { personalities, aliases } = await this.persistence.load();

      // Load into registry
      this.registry.loadFromObjects(personalities, aliases);

      // Extract options with defaults
      const {
        skipBackgroundSeeding = false,
        seedingDelay = 500,
        scheduler = globalThis.setTimeout || setTimeout,
      } = options;

      // Handle owner personality seeding
      if (deferOwnerPersonalities && !skipBackgroundSeeding) {
        logger.info('[PersonalityManager] Deferring owner personality seeding to background');
        scheduler(async () => {
          try {
            await this.seedOwnerPersonalities();
            logger.info('[PersonalityManager] Background seeding completed');
          } catch (err) {
            logger.error(`[PersonalityManager] Background seeding error: ${err.message}`);
          }
        }, seedingDelay);
      } else if (!deferOwnerPersonalities) {
        logger.info('[PersonalityManager] Loading owner personalities synchronously');
        await this.seedOwnerPersonalities();
      } else {
        logger.info('[PersonalityManager] Skipping owner personality seeding');
      }

      this.initialized = true;
      logger.info('[PersonalityManager] Initialization complete');
    } catch (error) {
      logger.error(`[PersonalityManager] Initialization error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register a new personality
   * @param {string} fullName - The full name of the personality
   * @param {string} addedBy - The ID of the user adding the personality
   * @param {Object} [additionalData={}] - Additional personality data
   * @returns {Promise<{success: boolean, error?: string}>} Registration result
   */
  async registerPersonality(fullName, addedBy, additionalData = {}) {
    try {
      // Validate user ID
      const userValidation = this.validator.validateUserId(addedBy);
      if (!userValidation.isValid) {
        return { success: false, error: userValidation.error };
      }

      // Create personality data
      const personalityData = {
        fullName,
        addedBy,
        addedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        ...additionalData,
      };

      // Validate registration
      const validation = this.validator.validateRegistration(
        fullName,
        personalityData,
        this.registry.personalities
      );
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // Sanitize data
      const sanitized = this.validator.sanitizePersonalityData(personalityData);

      // Fetch profile info if requested (default true unless fetchInfo is explicitly false)
      if (additionalData.fetchInfo !== false) {
        const profileData = await this._fetchProfileData(fullName);
        Object.assign(sanitized, profileData);
      }

      // Set default displayName if not set
      if (!sanitized.displayName) {
        sanitized.displayName = fullName;
      }

      // Register in registry
      const registered = this.registry.register(fullName, sanitized);
      if (!registered) {
        return { success: false, error: 'Failed to register personality' };
      }

      // Set display name as alias if different from full name
      if (sanitized.displayName && sanitized.displayName !== fullName) {
        await this._setDisplayNameAlias(sanitized.displayName, fullName);
      }

      // Save to persistence after all setup is complete
      await this.save();

      logger.info(`[PersonalityManager] Successfully registered personality: ${fullName}`);
      return { success: true };
    } catch (error) {
      logger.error(`[PersonalityManager] Error registering personality: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get a personality by name
   * @param {string} name - The personality name
   * @param {Object} options - Options for getting personality
   * @param {boolean} options.skipRefresh - Skip refreshing missing data
   * @returns {Promise<Object|null>} The personality data or null
   */
  async getPersonality(name, options = {}) {
    const personality = this.registry.get(name);

    if (personality && !options.skipRefresh) {
      // Check if personality data is stale
      const now = Date.now();
      const lastUpdated = personality.lastUpdated ? new Date(personality.lastUpdated).getTime() : 0;
      const staleDuration = this.options.staleDuration || 60 * 60 * 1000; // Default: 1 hour
      const isStale = now - lastUpdated > staleDuration;

      // Refresh if missing critical fields or if data is stale
      if (!personality.errorMessage || isStale) {
        const message = !personality.errorMessage
          ? `[PersonalityManager] Personality ${name} missing errorMessage, refreshing...`
          : `[PersonalityManager] Personality ${name} has stale data, refreshing...`;
        logger.info(message);

        // For missing errorMessage, wait for refresh to complete
        // This ensures error handling always has access to custom error messages
        if (!personality.errorMessage) {
          try {
            await this._refreshPersonalityData(name);
            // Return the updated personality from registry
            return this.registry.get(name);
          } catch (error) {
            logger.error(`[PersonalityManager] Failed to refresh ${name}: ${error.message}`);
            // Return personality as-is if refresh fails
            return personality;
          }
        } else {
          // For stale data, refresh asynchronously to avoid blocking
          this._refreshPersonalityData(name).catch(error => {
            logger.error(`[PersonalityManager] Failed to refresh ${name}: ${error.message}`);
          });
        }
      }
    }

    return personality;
  }

  /**
   * Get a personality by alias
   * @param {string} alias - The alias to look up
   * @returns {Object|null} The personality data or null
   */
  getPersonalityByAlias(alias) {
    return this.registry.getByAlias(alias);
  }

  /**
   * Set an alias for a personality
   * @param {string} alias - The alias to set
   * @param {string} fullName - The full name of the personality
   * @param {boolean} [skipSave=false] - Whether to skip saving to disk
   * @returns {Promise<{success: boolean, error?: string}>} Result
   */
  async setPersonalityAlias(alias, fullName, skipSave = false) {
    try {
      // Validate alias
      const aliasValidation = this.validator.validateAlias(alias);
      if (!aliasValidation.isValid) {
        return { success: false, error: aliasValidation.error };
      }

      // Don't allow self-referential aliases
      if (alias === fullName) {
        logger.warn(`[PersonalityManager] Attempted to create self-referential alias: ${alias}`);
        return { success: false, error: 'Cannot create alias that matches the personality name' };
      }

      // Set the alias
      const set = this.registry.setAlias(alias, fullName);
      if (!set) {
        return { success: false, error: 'Personality not found' };
      }

      // Save unless skipped
      if (!skipSave) {
        await this.save();
      }

      return { success: true };
    } catch (error) {
      logger.error(`[PersonalityManager] Error setting alias: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a personality
   * @param {string} fullName - The full name of the personality
   * @param {string} requestingUserId - The ID of the user requesting removal
   * @returns {Promise<{success: boolean, error?: string}>} Removal result
   */
  async removePersonality(fullName, requestingUserId) {
    try {
      // Get the personality
      const personality = this.registry.get(fullName);

      // Validate removal
      const validation = this.validator.validateRemoval(fullName, requestingUserId, personality);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // Remove from registry
      const removed = this.registry.remove(fullName);
      if (!removed) {
        return { success: false, error: 'Failed to remove personality' };
      }

      // Save to persistence
      await this.save();

      logger.info(`[PersonalityManager] Successfully removed personality: ${fullName}`);
      return { success: true };
    } catch (error) {
      logger.error(`[PersonalityManager] Error removing personality: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * List personalities for a user
   * @param {string} userId - The user ID
   * @returns {Array<Object>} Array of personalities
   */
  listPersonalitiesForUser(userId) {
    return this.registry.getByUser(userId);
  }

  /**
   * Save all data to persistence
   * @returns {Promise<boolean>} True if saved successfully
   */
  async save() {
    try {
      const { personalities, aliases } = this.registry.exportToObjects();
      return await this.persistence.save(personalities, aliases);
    } catch (error) {
      logger.error(`[PersonalityManager] Error saving data: ${error.message}`);
      return false;
    }
  }

  /**
   * Seed owner personalities
   * @param {Object} options - Options for seeding
   * @param {boolean} options.skipDelays - Skip delays between personality additions
   * @returns {Promise<void>}
   */
  async seedOwnerPersonalities(options = {}) {
    // Get owner ID from environment or constants
    let ownerId = null;

    // Check environment variable first (direct, no array)
    if (process.env.BOT_OWNER_ID) {
      ownerId = process.env.BOT_OWNER_ID;
    } else {
      // Check constants as fallback
      try {
        const constants = require('../../constants');
        if (constants.USER_CONFIG && constants.USER_CONFIG.OWNER_ID) {
          ownerId = constants.USER_CONFIG.OWNER_ID;
        }
      } catch (_error) {
        // Constants not available
      }
    }

    if (!ownerId) {
      logger.info('[PersonalityManager] No bot owner ID configured, skipping seeding');
      return;
    }
    const ownerPersonalities = this.listPersonalitiesForUser(ownerId);

    // Get list of expected personalities from constants
    let expectedPersonalities = [];
    try {
      const constants = require('../../constants');
      if (constants.USER_CONFIG && constants.USER_CONFIG.OWNER_PERSONALITIES_LIST) {
        expectedPersonalities = constants.USER_CONFIG.OWNER_PERSONALITIES_LIST.split(',').map(p =>
          p.trim()
        );
      }
    } catch (_error) {
      // If constants not available, use default list
      expectedPersonalities = ['assistant', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'];
    }

    // Check which personalities are missing
    const existingNames = ownerPersonalities.map(p => p.fullName).map(name => name.toLowerCase());
    const personalitiesToAdd = expectedPersonalities.filter(
      name => !existingNames.includes(name.toLowerCase())
    );

    if (personalitiesToAdd.length === 0) {
      logger.info(
        `[PersonalityManager] Owner has all ${expectedPersonalities.length} expected personalities`
      );
      return;
    }

    logger.info(
      `[PersonalityManager] Owner has ${ownerPersonalities.length} personalities, missing ${personalitiesToAdd.length}: ${personalitiesToAdd.join(', ')}`
    );
    logger.info('[PersonalityManager] Starting personality seeding for missing entries...');

    const addedPersonalities = [];
    for (const personalityName of personalitiesToAdd) {
      try {
        const result = await this.registerPersonality(personalityName, ownerId);
        if (result.success) {
          addedPersonalities.push(personalityName);
          logger.info(`[PersonalityManager] Successfully seeded: ${personalityName}`);
        }

        // Add delay to avoid rate limiting (unless skipped)
        if (
          !options.skipDelays &&
          personalitiesToAdd.indexOf(personalityName) < personalitiesToAdd.length - 1
        ) {
          await this.delay(8000);
        }
      } catch (error) {
        logger.error(`[PersonalityManager] Error seeding ${personalityName}: ${error.message}`);
      }
    }

    logger.info(
      `[PersonalityManager] Seeding complete. Added ${addedPersonalities.length} personalities`
    );
  }

  /**
   * Get all personalities
   * @returns {Array<Object>} Array of all personalities
   */
  getAllPersonalities() {
    return this.registry.getAll();
  }

  /**
   * Set display name alias with smart collision handling
   * @private
   * @param {string} displayName - The display name to set as alias
   * @param {string} fullName - The full personality name
   * @returns {Promise<void>}
   */
  async _setDisplayNameAlias(displayName, fullName) {
    const lowerAlias = displayName.toLowerCase();

    // Check if alias already exists
    if (this.registry.aliases.has(lowerAlias)) {
      // Create a smarter alias by using parts of the full personality name
      const nameParts = fullName.split('-');
      const aliasParts = displayName.split('-');

      let alternateAlias = displayName;

      // If the personality name has more parts than the alias, try adding the next part
      if (nameParts.length > aliasParts.length) {
        // Find which part of the name corresponds to the alias
        let matchIndex = -1;
        for (let i = 0; i < nameParts.length; i++) {
          if (nameParts[i].toLowerCase() === aliasParts[0].toLowerCase()) {
            matchIndex = i;
            break;
          }
        }

        // If we found a match and there's a next part, use it
        if (matchIndex >= 0 && matchIndex + 1 < nameParts.length) {
          alternateAlias = `${displayName}-${nameParts[matchIndex + 1]}`;
        }
      }

      // If the smart alias is still taken or we couldn't create one, fall back to random
      if (
        alternateAlias === displayName ||
        this.registry.aliases.has(alternateAlias.toLowerCase())
      ) {
        // Generate a random suffix with only lowercase letters
        const chars = 'abcdefghijklmnopqrstuvwxyz';
        let randomSuffix = '';
        for (let i = 0; i < 6; i++) {
          randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        alternateAlias = `${displayName}-${randomSuffix}`;
      }

      // Set the alternate alias
      this.registry.setAlias(alternateAlias.toLowerCase(), fullName);
      logger.info(
        `[PersonalityManager] Created alternate alias ${alternateAlias} for ${fullName} (${displayName} was taken)`
      );
    } else {
      // Alias is available, use it directly
      this.registry.setAlias(lowerAlias, fullName);
      logger.info(`[PersonalityManager] Set display name alias '${lowerAlias}' for ${fullName}`);
    }
  }

  /**
   * Fetch profile data from the API
   * @private
   * @param {string} fullName - The personality name
   * @returns {Promise<Object>} Profile data object
   */
  async _fetchProfileData(fullName) {
    try {
      const [avatarUrl, displayName, errorMessage] = await Promise.all([
        getProfileAvatarUrl(fullName),
        getProfileDisplayName(fullName),
        getProfileErrorMessage(fullName),
      ]);

      const profileData = {};
      if (avatarUrl) {
        profileData.avatarUrl = avatarUrl;

        // Pre-download the avatar to avoid exposing external service URLs
        try {
          logger.info(`[PersonalityManager] Pre-downloading avatar for ${fullName}`);
          const localUrl = await avatarStorage.getLocalAvatarUrl(fullName, avatarUrl);
          if (localUrl) {
            logger.info(`[PersonalityManager] Avatar downloaded successfully for ${fullName}`);
          }
        } catch (downloadError) {
          logger.warn(
            `[PersonalityManager] Failed to pre-download avatar for ${fullName}: ${downloadError.message}`
          );
          // Continue anyway - avatar will be downloaded on first use
        }
      }
      if (displayName) profileData.displayName = displayName;
      if (errorMessage) profileData.errorMessage = errorMessage;

      return profileData;
    } catch (profileError) {
      logger.warn(
        `[PersonalityManager] Could not fetch profile info for ${fullName}: ${profileError.message}`
      );
      return {};
    }
  }

  /**
   * Refresh personality data from the API
   * @private
   * @param {string} fullName - The personality name to refresh
   * @returns {Promise<void>}
   */
  async _refreshPersonalityData(fullName) {
    try {
      const personality = this.registry.get(fullName);
      if (!personality) {
        logger.warn(`[PersonalityManager] Cannot refresh non-existent personality: ${fullName}`);
        return;
      }

      // Fetch latest data from API using shared method
      const profileData = await this._fetchProfileData(fullName);

      // Check if avatar needs updating using checksum comparison
      let avatarChanged = false;
      if (profileData.avatarUrl) {
        if (profileData.avatarUrl !== personality.profile?.avatarUrl) {
          // URL changed, check if actual image changed
          try {
            const needsUpdate = await avatarStorage.needsUpdate(fullName, profileData.avatarUrl);
            if (needsUpdate) {
              logger.info(
                `[PersonalityManager] Avatar changed for ${fullName}, will update local storage`
              );
              avatarChanged = true;
              // Pre-download the new avatar to ensure it's cached
              await avatarStorage.getLocalAvatarUrl(fullName, profileData.avatarUrl);
            } else {
              logger.info(
                `[PersonalityManager] Avatar URL changed but image unchanged for ${fullName}`
              );
            }
          } catch (error) {
            logger.error(
              `[PersonalityManager] Error checking avatar update for ${fullName}: ${error.message}`
            );
          }
        } else {
          // URL hasn't changed, but ensure avatar is downloaded
          try {
            const localUrl = await avatarStorage.getLocalAvatarUrl(fullName, profileData.avatarUrl);
            if (!localUrl) {
              logger.info(
                `[PersonalityManager] Avatar missing locally for ${fullName}, downloading...`
              );
            }
          } catch (error) {
            logger.warn(
              `[PersonalityManager] Failed to ensure avatar downloaded for ${fullName}: ${error.message}`
            );
          }
        }
      }

      // Update personality data with new fields and timestamp
      const updated = {
        ...personality,
        ...profileData,
        displayName: profileData.displayName || personality.displayName || fullName,
        lastUpdated: new Date().toISOString(),
        avatarChanged, // Track if avatar actually changed
      };

      // Update in registry
      this.registry.personalities.set(fullName, updated);

      // Save to persistence
      await this.save();

      logger.info(`[PersonalityManager] Successfully refreshed personality data for ${fullName}`);
    } catch (error) {
      logger.error(`[PersonalityManager] Error refreshing ${fullName}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get personality aliases map
   * @returns {Map} The aliases map
   */
  get personalityAliases() {
    return this.registry.aliases;
  }

  /**
   * Get the maximum word count among all aliases
   * @returns {number} The maximum word count
   */
  getMaxAliasWordCount() {
    return this.registry.maxAliasWordCount;
  }

  /**
   * Get the registry size
   * @returns {number} Number of registered personalities
   */
  get size() {
    return this.registry.size;
  }
}

// Export the class itself
module.exports = PersonalityManager;

// Factory function to create instances
module.exports.create = function (options = {}) {
  return new PersonalityManager(options);
};

// For backward compatibility, create a lazy-loaded singleton
let _instance = null;
module.exports.getInstance = function () {
  if (!_instance) {
    // In tests, inject a no-op delay to prevent real timers
    const isTestEnvironment = process.env.JEST_WORKER_ID !== undefined;
    _instance = new PersonalityManager({
      delay: isTestEnvironment ? () => Promise.resolve() : undefined,
    });
  }
  return _instance;
};

// For modules that import this directly (backward compatibility)
// We'll gradually migrate these to use getInstance()
const personalityManager = module.exports.getInstance();
Object.assign(module.exports, {
  // Re-export all methods from the instance
  initialize: (...args) => personalityManager.initialize(...args),
  registerPersonality: (...args) => personalityManager.registerPersonality(...args),
  removePersonality: (...args) => personalityManager.removePersonality(...args),
  getPersonality: async (...args) => personalityManager.getPersonality(...args),
  getPersonalityByAlias: (...args) => personalityManager.getPersonalityByAlias(...args),
  setPersonalityAlias: (...args) => personalityManager.setPersonalityAlias(...args),
  removePersonalityAlias: (...args) => personalityManager.removePersonalityAlias(...args),
  listPersonalities: (...args) => personalityManager.listPersonalities(...args),
  listPersonalitiesForUser: (...args) => personalityManager.listPersonalitiesForUser(...args),
  getAllAliasesForPersonality: (...args) => personalityManager.getAllAliasesForPersonality(...args),
  seedOwnerPersonalities: (...args) => personalityManager.seedOwnerPersonalities(...args),
  validatePersonalityName: (...args) => personalityManager.validatePersonalityName(...args),
  getAllPersonalities: (...args) => personalityManager.getAllPersonalities(...args),
  save: (...args) => personalityManager.save(...args),
  getMaxAliasWordCount: (...args) => personalityManager.getMaxAliasWordCount(...args),

  // Properties
  get personalityAliases() {
    return personalityManager.personalityAliases;
  },
  get size() {
    return personalityManager.size;
  },
});
