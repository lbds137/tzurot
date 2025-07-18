const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');
const { PersonalityProfile } = require('../../domain/personality/PersonalityProfile');
const { Alias } = require('../../domain/personality/Alias');
const { Personality } = require('../../domain/personality/Personality');
const { PersonalityId } = require('../../domain/personality/PersonalityId');
const { UserId } = require('../../domain/personality/UserId');
const { AIModel } = require('../../domain/ai/AIModel');
const { PersonalityConfiguration } = require('../../domain/personality/PersonalityConfiguration');

/**
 * File-based repository for personality persistence
 */
class FilePersonalityRepository {
  /**
   * @param {Object} options
   * @param {string} options.dataPath - Path to data directory
   * @param {string} options.filename - Filename for personality data
   */
  constructor({ dataPath = './data', filename = 'personalities.json' } = {}) {
    this.dataPath = dataPath;
    this.filePath = path.join(dataPath, filename);
    this._cache = {
      personalities: {},
      aliases: {},
    };
    this._initialized = false;
  }

  /**
   * Initialize the repository and load data
   */
  async initialize() {
    if (this._initialized) {
      return;
    }

    // Ensure data directory exists
    await fs.mkdir(this.dataPath, { recursive: true });

    try {
      // Try to load existing data
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsedData = JSON.parse(data);

      // No legacy format support - data must have correct structure

      // Ensure the parsed data has the expected structure
      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('Invalid file structure');
      }

      // Ensure required properties exist
      this._cache.personalities = parsedData.personalities || {};
      this._cache.aliases = parsedData.aliases || {};

      logger.info(
        `[FilePersonalityRepository] Loaded ${Object.keys(this._cache.personalities).length} personalities and ${Object.keys(this._cache.aliases).length} aliases from ${this.filePath}`
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet - create empty structure
        logger.info('[FilePersonalityRepository] No existing data file found, starting fresh');
        await this._persist();
      } else {
        logger.error(`[FilePersonalityRepository] Error loading data file: ${error.message}`);
        throw error;
      }
    }

    this._initialized = true;
  }

  /**
   * Find all personalities owned by a user
   * @param {string} ownerId - User ID
   * @returns {Promise<Personality[]>}
   */
  async findByOwner(ownerId) {
    try {
      const ownerIdString = ownerId.toString ? ownerId.toString() : ownerId;
      const personalities = [];
      for (const data of Object.values(this._cache.personalities)) {
        if (data.ownerId === ownerIdString && !data.removed) {
          personalities.push(this._hydrate(data));
        }
      }
      return personalities;
    } catch (error) {
      throw new Error(`Failed to find personalities by owner: ${error.message}`);
    }
  }

  /**
   * Find personality by ID
   * @param {string} personalityId - Personality ID
   * @returns {Promise<Personality|null>}
   */
  async findById(personalityId) {
    try {
      const id = personalityId.toString ? personalityId.toString() : personalityId;
      const data = this._cache.personalities[id];
      if (!data || data.removed) {
        return null;
      }
      return this._hydrate(data);
    } catch (error) {
      throw new Error(`Failed to find personality by id: ${error.message}`);
    }
  }

  /**
   * Find personality by alias
   * @param {string} alias - Alias value
   * @returns {Promise<Personality|null>}
   */
  async findByAlias(alias) {
    try {
      const targetId = this._cache.aliases[alias.toLowerCase()];
      if (!targetId) {
        return null;
      }

      // Check if the personality exists
      const personality = await this.findById(targetId);

      // If personality doesn't exist, clean up orphaned alias
      if (!personality) {
        delete this._cache.aliases[alias.toLowerCase()];
        await this._persist();
        return null;
      }

      return personality;
    } catch (error) {
      throw new Error(`Failed to find personality by alias: ${error.message}`);
    }
  }

  /**
   * Find all aliases for a personality
   * @param {string} personalityId - Personality ID
   * @returns {Promise<string[]>}
   */
  async findAliasesByPersonalityId(personalityId) {
    const aliases = [];
    for (const [alias, targetId] of Object.entries(this._cache.aliases)) {
      if (targetId === personalityId) {
        aliases.push(alias);
      }
    }
    return aliases;
  }

  /**
   * Find a personality by ID that includes alias information
   * This is used when we need to display all aliases for a personality
   * @param {string} personalityId - Personality ID
   * @returns {Promise<Personality|null>}
   */
  async findByIdWithAliases(personalityId) {
    const personality = await this.findById(personalityId);
    if (!personality) {
      return null;
    }

    // Get all aliases for this personality
    const aliases = await this.findAliasesByPersonalityId(personalityId);

    // Add aliases to the personality object
    // Note: This modifies the personality object, which is okay since
    // we're creating a new instance from _hydrate
    personality.aliases = aliases.map(alias => new Alias(alias));

    return personality;
  }

  /**
   * Save or update a personality
   * @param {Personality} personality - Personality to save
   * @returns {Promise<void>}
   */
  async save(personality) {
    // Ensure repository is initialized
    if (!this._initialized) {
      await this.initialize();
    }

    try {
      const data = {
        id: personality.id,
        ownerId: personality.ownerId.toString(),
        profile: {
          mode: personality.profile.mode,
          name: personality.profile.name,
          displayName: personality.profile.displayName,
          avatarUrl: personality.profile.avatarUrl,
          errorMessage: personality.profile.errorMessage,
          prompt: personality.profile.prompt,
          modelPath: personality.profile.modelPath,
          maxWordCount: personality.profile.maxWordCount,
          bio: personality.profile.bio,
          systemPrompt: personality.profile.systemPrompt,
          temperature: personality.profile.temperature,
          maxTokens: personality.profile.maxTokens,
        },
        model: {
          name: personality.model.name,
          endpoint: personality.model.endpoint,
          capabilities: personality.model.capabilities,
        },
        configuration: personality.configuration ? personality.configuration.toJSON() : null,
        aliases: personality.aliases.map(alias => ({
          value: alias.value,
          originalCase: alias.originalCase,
        })),
        createdAt:
          personality.createdAt instanceof Date
            ? personality.createdAt.toISOString()
            : personality.createdAt,
        updatedAt:
          personality.updatedAt instanceof Date
            ? personality.updatedAt.toISOString()
            : personality.updatedAt,
        removed: false,
      };

      this._cache.personalities[personality.id] = data;

      // Update alias cache
      // First, remove any existing aliases for this personality
      for (const [alias, targetId] of Object.entries(this._cache.aliases)) {
        if (targetId === personality.id) {
          delete this._cache.aliases[alias];
        }
      }

      // Then add the new aliases
      for (const alias of personality.aliases) {
        const lowerAlias = alias.value.toLowerCase();
        const existingTarget = this._cache.aliases[lowerAlias];

        // Check if alias already points to a different personality
        if (existingTarget && existingTarget !== personality.id) {
          logger.warn(
            `[FilePersonalityRepository] Alias "${alias.value}" already points to ${existingTarget}, not updating to ${personality.id}`
          );
          continue;
        }

        this._cache.aliases[lowerAlias] = personality.id;
      }

      await this._persist();
    } catch (error) {
      throw new Error(`Failed to save personality: ${error.message}`);
    }
  }

  /**
   * Remove a personality (soft delete)
   * @param {string} personalityId - Personality ID
   * @returns {Promise<void>}
   */
  async remove(personalityId) {
    const data = this._cache.personalities[personalityId];
    if (data) {
      data.removed = true;
      data.updatedAt = new Date().toISOString();
      await this._persist();
    }
  }

  /**
   * Check if a personality name is available
   * @param {string} name - Personality name to check
   * @returns {Promise<boolean>}
   */
  async isNameAvailable(name) {
    const normalizedName = name.toLowerCase();
    for (const data of Object.values(this._cache.personalities)) {
      if (!data.removed && data.profile?.name?.toLowerCase() === normalizedName) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get personality by name
   * @param {string} name - Personality name
   * @returns {Promise<Personality|null>}
   */
  async findByName(name) {
    const normalizedName = name.toLowerCase();
    for (const [id, data] of Object.entries(this._cache.personalities)) {
      if (!data.removed) {
        // Check various name fields
        const profileName = data.profile?.name?.toLowerCase();
        const displayName = data.profile?.displayName?.toLowerCase();
        const personalityId = id.toLowerCase();

        if (
          profileName === normalizedName ||
          displayName === normalizedName ||
          personalityId === normalizedName
        ) {
          return this._hydrate(data);
        }
      }
    }
    return null;
  }

  /**
   * Find all personalities
   * @returns {Promise<Personality[]>}
   */
  async findAll() {
    try {
      const personalities = [];
      for (const data of Object.values(this._cache.personalities)) {
        if (!data.removed) {
          personalities.push(this._hydrate(data));
        }
      }
      return personalities;
    } catch (error) {
      throw new Error(`Failed to find all personalities: ${error.message}`);
    }
  }

  /**
   * Save an alias mapping
   * @param {string} alias - Alias value
   * @param {string} personalityId - Target personality ID
   * @returns {Promise<void>}
   */
  async saveAlias(alias, personalityId) {
    this._cache.aliases[alias.toLowerCase()] = personalityId;
    await this._persist();
  }

  /**
   * Remove an alias mapping
   * @param {string} alias - Alias to remove
   * @returns {Promise<void>}
   */
  async removeAlias(alias) {
    delete this._cache.aliases[alias.toLowerCase()];
    await this._persist();
  }

  /**
   * Get all alias mappings
   * @returns {Promise<Object>} Map of alias -> personalityId
   */
  async getAllAliases() {
    return { ...this._cache.aliases };
  }

  /**
   * Check if an alias is available
   * @param {string} alias - Alias to check
   * @returns {Promise<boolean>}
   */
  async isAliasAvailable(alias) {
    return !Object.prototype.hasOwnProperty.call(this._cache.aliases, alias.toLowerCase());
  }

  /**
   * Find personality by name or alias
   * @param {string} nameOrAlias - Name or alias to search for
   * @returns {Promise<Personality|null>}
   */
  async findByNameOrAlias(nameOrAlias) {
    try {
      const normalizedName = nameOrAlias.toLowerCase();

      // First check if it's an alias
      const byAlias = await this.findByAlias(nameOrAlias);
      if (byAlias) {
        return byAlias;
      }

      // Then check display name
      for (const [, data] of Object.entries(this._cache.personalities)) {
        if (!data.removed) {
          const displayName = data.profile?.displayName?.toLowerCase();

          if (displayName === normalizedName) {
            return this._hydrate(data);
          }
        }
      }

      // Finally check exact name (profile.name) or personality ID
      for (const [id, data] of Object.entries(this._cache.personalities)) {
        if (!data.removed) {
          const profileName = data.profile?.name?.toLowerCase();
          const personalityId = id.toLowerCase();

          if (profileName === normalizedName || personalityId === normalizedName) {
            return this._hydrate(data);
          }
        }
      }

      return null;
    } catch (error) {
      throw new Error(`Failed to find by name or alias: ${error.message}`);
    }
  }

  /**
   * Get all personalities with basic info (for listing)
   * @returns {Promise<Array>}
   */
  async getAllBasicInfo() {
    const personalities = [];
    for (const [id, data] of Object.entries(this._cache.personalities)) {
      if (!data.removed) {
        personalities.push({
          id,
          name: data.profile?.name || id,
          displayName: data.profile?.displayName || data.profile?.name || id,
          ownerId: data.ownerId,
          aliases: await this.findAliasesByPersonalityId(id),
        });
      }
    }
    return personalities;
  }

  /**
   * Persist data to file
   * @private
   */
  async _persist() {
    try {
      const dataToSave = {
        personalities: this._cache.personalities,
        aliases: this._cache.aliases,
        version: '2.0.0',
        lastUpdated: new Date().toISOString(),
      };

      await fs.writeFile(this.filePath, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
      throw new Error(`Failed to persist data: ${error.message}`);
    }
  }

  /**
   * Hydrate a personality from stored data
   * @private
   * @param {Object} data - Stored personality data
   * @returns {Personality}
   */
  _hydrate(data) {
    // Create profile from stored data
    let profile;
    if (data.profile) {
      const profileMode = data.profile.mode || 'local';
      
      // Build profile data based on mode
      const profileData = {
        mode: profileMode,
        name: data.profile.name || data.id,
        displayName: data.profile.displayName || data.profile.name || data.id,
        avatarUrl: data.profile.avatarUrl,
        errorMessage: data.profile.errorMessage,
      };
      
      // Only add local-mode fields if not external
      if (profileMode !== 'external') {
        profileData.prompt = data.profile.prompt || `You are ${data.profile.name || data.id}`;
        profileData.modelPath = data.profile.modelPath || '/default';
        profileData.maxWordCount = data.profile.maxWordCount || 1000;
        profileData.bio = data.profile.bio;
        profileData.systemPrompt = data.profile.systemPrompt;
        profileData.temperature = data.profile.temperature;
        profileData.maxTokens = data.profile.maxTokens;
      } else {
        // For external mode, include lastFetched if available
        profileData.lastFetched = data.profile.lastFetched;
      }
      
      // Use object constructor to preserve all fields
      profile = new PersonalityProfile(profileData);
    } else {
      // No profile data - create default using object constructor
      profile = new PersonalityProfile({
        mode: 'local',
        name: data.id,
        displayName: data.id,
        prompt: `You are ${data.id}`,
        modelPath: '/default',
        maxWordCount: 1000,
      });
    }

    // Create model from stored data or use default
    let model;
    if (data.model) {
      model = new AIModel(
        data.model.name || 'default',
        data.model.endpoint || '/default',
        data.model.capabilities || {}
      );
    } else {
      model = new AIModel('default', '/default', {});
    }

    // Create aliases from stored data
    const aliases = [];
    if (data.aliases && Array.isArray(data.aliases)) {
      for (const aliasData of data.aliases) {
        if (aliasData && aliasData.value) {
          aliases.push(new Alias(aliasData.value, aliasData.originalCase));
        }
      }
    }

    // Create the personality with proper value objects
    const personalityId = new PersonalityId(data.id);

    // Handle missing ownerId
    if (!data.ownerId) {
      throw new Error(`Personality ${data.id} has no ownerId`);
    }

    const userId = new UserId(data.ownerId);

    // Create the personality using the factory method
    const personality = Personality.create(personalityId, userId, profile, model);

    // Set configuration if available
    if (data.configuration) {
      personality.configuration = PersonalityConfiguration.fromJSON(data.configuration);
    }

    // Set additional properties
    personality.aliases = aliases;
    personality.removed = data.removed || false;

    // Set timestamps if available
    if (data.createdAt) {
      personality.createdAt = new Date(data.createdAt);
    }
    if (data.updatedAt) {
      personality.updatedAt = new Date(data.updatedAt);
    }

    // Clear uncommitted events since this is hydration from storage
    personality.markEventsAsCommitted();

    return personality;
  }

  /**
   * Save batch data (used for imports/migrations)
   * @private
   */
  async _save(data) {
    this._cache = data;
    await this._persist();
  }

  /**
   * Delete a personality and its aliases
   * @param {PersonalityId} personalityId - Personality ID to delete
   * @returns {Promise<void>}
   */
  async delete(personalityId) {
    try {
      const id = personalityId.toString ? personalityId.toString() : personalityId;
      const data = this._cache.personalities[id];

      if (!data) {
        return; // Nothing to delete
      }

      // Remove all aliases for this personality
      for (const [alias, targetId] of Object.entries(this._cache.aliases)) {
        if (targetId === id) {
          delete this._cache.aliases[alias];
        }
      }

      // Delete the personality
      delete this._cache.personalities[id];

      await this._persist();
    } catch (error) {
      throw new Error(`Failed to delete personality: ${error.message}`);
    }
  }

  /**
   * Check if a personality exists
   * @param {PersonalityId} personalityId - Personality ID to check
   * @returns {Promise<boolean>}
   */
  async exists(personalityId) {
    const id = personalityId.toString ? personalityId.toString() : personalityId;
    const data = this._cache.personalities[id];
    return !!(data && !data.removed);
  }

  /**
   * Create a backup of the current data
   * @returns {Promise<string>} Path to the backup file
   */
  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const backupPath = path.join(this.dataPath, `personalities-backup-${timestamp}.json`);

      const dataToBackup = {
        personalities: this._cache.personalities,
        aliases: this._cache.aliases,
        version: '2.0.0',
        backupDate: new Date().toISOString(),
      };

      await fs.writeFile(backupPath, JSON.stringify(dataToBackup, null, 2), 'utf8');
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Get statistics about the repository
   * @returns {Promise<Object>} Repository statistics
   */
  async getStats() {
    const stats = {
      totalPersonalities: 0,
      totalAliases: 0,
      owners: 0,
    };

    const uniqueOwners = new Set();

    for (const [, data] of Object.entries(this._cache.personalities)) {
      if (!data.removed) {
        stats.totalPersonalities++;
        if (data.ownerId) {
          uniqueOwners.add(data.ownerId);
        }
      }
    }

    stats.totalAliases = Object.keys(this._cache.aliases).length;
    stats.owners = uniqueOwners.size;

    return stats;
  }
}

module.exports = { FilePersonalityRepository };
