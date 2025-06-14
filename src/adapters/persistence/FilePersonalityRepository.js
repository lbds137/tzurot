const fs = require('fs').promises;
const path = require('path');
const {
  Personality,
  PersonalityId,
  PersonalityProfile,
  Alias,
  UserId,
} = require('../../domain/personality');
const { PersonalityRepository } = require('../../domain/personality');
const { AIModel } = require('../../domain/ai');
const logger = require('../../logger');

/**
 * FilePersonalityRepository - File-based implementation of PersonalityRepository
 *
 * This adapter implements persistence for personalities using the file system.
 * In production, this would likely be replaced with a database adapter.
 */
class FilePersonalityRepository extends PersonalityRepository {
  /**
   * @param {Object} options
   * @param {string} options.dataPath - Path to data directory
   * @param {string} options.filename - Filename for personalities data
   */
  constructor({ dataPath = './data', filename = 'ddd-personalities.json' } = {}) {
    super();
    this.dataPath = dataPath;
    this.filePath = path.join(dataPath, filename);
    this.legacyPersonalitiesPath = path.join(dataPath, 'personalities.json');
    this.legacyAliasesPath = path.join(dataPath, 'aliases.json');
    this._cache = null; // In-memory cache
    this._initialized = false;
  }

  /**
   * Initialize the repository
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataPath, { recursive: true });

      // Load existing data or create new file
      try {
        const data = await fs.readFile(this.filePath, 'utf8');
        const parsedData = JSON.parse(data);
        this._cache = parsedData;
        logger.info('[FilePersonalityRepository] Loaded from DDD file');
      } catch (error) {
        if (error.code === 'ENOENT') {
          // DDD file doesn't exist, try to load from legacy files
          logger.info('[FilePersonalityRepository] DDD file not found, loading from legacy files');
          await this._loadFromLegacyFiles();
        } else {
          throw error;
        }
      }

      this._initialized = true;
      logger.info('[FilePersonalityRepository] Initialized successfully');
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to initialize:', error);
      throw new Error(`Failed to initialize repository: ${error.message}`);
    }
  }

  /**
   * Save a personality
   * @param {Personality} personality - Personality to save
   * @returns {Promise<void>}
   */
  async save(personality) {
    await this._ensureInitialized();

    try {
      const data = personality.toJSON();

      // Store personality data
      this._cache.personalities[personality.personalityId.value] = {
        ...data,
        // Ensure proper serialization of nested objects
        profile: data.profile,
        aliases: personality.aliases
          ? personality.aliases.map(a => (a.toJSON ? a.toJSON() : a))
          : [],
        savedAt: new Date().toISOString(),
      };

      // Update alias mappings
      if (personality.aliases && Array.isArray(personality.aliases)) {
        personality.aliases.forEach(alias => {
          this._cache.aliases[alias.value] = personality.personalityId.value;
        });
      }

      await this._persist();

      logger.info(
        `[FilePersonalityRepository] Saved personality: ${personality.personalityId.value}`
      );
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to save personality:', error);
      throw new Error(`Failed to save personality: ${error.message}`);
    }
  }

  /**
   * Find a personality by ID
   * @param {PersonalityId} personalityId - ID to search for
   * @returns {Promise<Personality|null>}
   */
  async findById(personalityId) {
    await this._ensureInitialized();

    try {
      const data = this._cache.personalities[personalityId.value];
      if (!data || data.removed) {
        return null;
      }

      return this._hydrate(data);
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to find by ID:', error);
      throw new Error(`Failed to find personality: ${error.message}`);
    }
  }

  /**
   * Find personalities by owner
   * @param {UserId} ownerId - Owner ID
   * @returns {Promise<Personality[]>}
   */
  async findByOwner(ownerId) {
    await this._ensureInitialized();

    try {
      const personalities = [];

      for (const data of Object.values(this._cache.personalities)) {
        // Skip removed personalities
        if (data.removed) {
          continue;
        }

        if (data.ownerId === ownerId.value) {
          personalities.push(await this._hydrate(data));
        }
      }

      return personalities;
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to find by owner:', error);
      throw new Error(`Failed to find personalities by owner: ${error.message}`);
    }
  }

  /**
   * Find personality by name
   * @param {string} name - Name to search for
   * @returns {Promise<Personality|null>}
   */
  async findByName(name) {
    await this._ensureInitialized();

    try {
      // Ensure cache structure exists
      if (!this._cache || !this._cache.personalities) {
        return null;
      }

      // Search through all personalities for matching name
      for (const data of Object.values(this._cache.personalities)) {
        // Skip removed personalities
        if (data.removed) {
          continue;
        }

        // Check if profile name matches (case-insensitive)
        if (
          data.profile &&
          (data.profile.name?.toLowerCase() === name.toLowerCase() ||
            data.profile.displayName?.toLowerCase() === name.toLowerCase())
        ) {
          return this._hydrate(data);
        }

        // Also check personality ID as fallback
        if (
          data.id?.toLowerCase() === name.toLowerCase() ||
          data.personalityId?.toLowerCase() === name.toLowerCase()
        ) {
          return this._hydrate(data);
        }
      }

      return null;
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to find by name:', error);
      throw new Error(`Failed to find personality by name: ${error.message}`);
    }
  }

  /**
   * Find personality by alias
   * @param {string} alias - Alias to search for
   * @returns {Promise<Personality|null>}
   */
  async findByAlias(alias) {
    await this._ensureInitialized();

    try {
      // Normalize alias for case-insensitive search
      const normalizedAlias = alias.toLowerCase();

      // Check alias mappings
      const personalityId = Object.entries(this._cache.aliases).find(
        ([key]) => key.toLowerCase() === normalizedAlias
      )?.[1];

      if (!personalityId) {
        return null;
      }

      const data = this._cache.personalities[personalityId];
      if (!data || data.removed) {
        // Alias points to non-existent or removed personality, clean up
        delete this._cache.aliases[alias];
        await this._persist();
        return null;
      }

      return this._hydrate(data);
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to find by alias:', error);
      throw new Error(`Failed to find personality by alias: ${error.message}`);
    }
  }

  /**
   * Get all personalities
   * @returns {Promise<Personality[]>}
   */
  async findAll() {
    await this._ensureInitialized();

    try {
      const personalities = [];

      for (const data of Object.values(this._cache.personalities)) {
        // Skip removed personalities
        if (!data.removed) {
          personalities.push(await this._hydrate(data));
        }
      }

      return personalities;
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to find all:', error);
      throw new Error(`Failed to find all personalities: ${error.message}`);
    }
  }

  /**
   * Delete a personality
   * @param {PersonalityId} personalityId - ID to delete
   * @returns {Promise<void>}
   */
  async delete(personalityId) {
    await this._ensureInitialized();

    try {
      const data = this._cache.personalities[personalityId.value];
      if (!data) {
        return; // Already deleted
      }

      // Remove personality
      delete this._cache.personalities[personalityId.value];

      // Remove all aliases pointing to this personality
      Object.entries(this._cache.aliases).forEach(([alias, id]) => {
        if (id === personalityId.value) {
          delete this._cache.aliases[alias];
        }
      });

      await this._persist();

      logger.info(`[FilePersonalityRepository] Deleted personality: ${personalityId.value}`);
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to delete:', error);
      throw new Error(`Failed to delete personality: ${error.message}`);
    }
  }

  /**
   * Check if a personality exists
   * @param {PersonalityId} personalityId - ID to check
   * @returns {Promise<boolean>}
   */
  async exists(personalityId) {
    await this._ensureInitialized();
    return !!this._cache.personalities[personalityId.value];
  }

  /**
   * Hydrate a personality from stored data
   * @private
   */
  _hydrate(data) {
    // Create profile from stored data
    let profile;
    if (data.profile) {
      // Check if it's the new format (with name, prompt, etc) or old format (displayName, etc)
      if (data.profile.name || data.profile.prompt) {
        // New format
        profile = new PersonalityProfile(
          data.profile.name || data.id || data.personalityId,
          data.profile.prompt || `You are ${data.profile.name || data.id}`,
          data.profile.modelPath || '/default',
          data.profile.maxWordCount || 1000
        );
      } else {
        // Legacy format - convert to new format
        profile = new PersonalityProfile(
          data.profile.displayName || data.id || data.personalityId,
          data.profile.systemPrompt || `You are ${data.profile.displayName || data.id}`,
          '/default',
          data.profile.maxTokens || 1000
        );
      }
    } else {
      // No profile data - create default
      profile = new PersonalityProfile(
        data.id || data.personalityId,
        `You are ${data.id || data.personalityId}`,
        '/default',
        1000
      );
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
      model = AIModel.createDefault();
    }

    // Create personality using static factory method
    const personality = Personality.create(
      new PersonalityId(data.id || data.personalityId),
      new UserId(data.ownerId),
      profile,
      model
    );

    // Add aliases
    if (data.aliases && Array.isArray(data.aliases)) {
      data.aliases.forEach(aliasData => {
        if (typeof aliasData === 'string') {
          personality.addAlias(new Alias(aliasData));
        } else {
          personality.addAlias(new Alias(aliasData.value || aliasData.original));
        }
      });
    }

    // Mark as hydrated from persistence
    personality.markEventsAsCommitted();

    return personality;
  }

  /**
   * Persist cache to file
   * @private
   */
  async _persist() {
    try {
      const data = JSON.stringify(this._cache, null, 2);

      // Write to temp file first for atomic operation
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, data, 'utf8');

      // Rename to actual file
      await fs.rename(tempPath, this.filePath);

      // Also persist in legacy format for compatibility
      await this._persistLegacyFormat();

      logger.debug('[FilePersonalityRepository] Data persisted successfully');
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to persist data:', error);
      throw new Error(`Failed to persist data: ${error.message}`);
    }
  }

  /**
   * Load data from legacy files
   * @private
   */
  async _loadFromLegacyFiles() {
    try {
      this._cache = {
        personalities: {},
        aliases: {},
      };

      // Try to load legacy personalities
      try {
        const legacyData = await fs.readFile(this.legacyPersonalitiesPath, 'utf8');
        const legacyPersonalities = JSON.parse(legacyData);

        // Check if it's already in new format (nested structure)
        if (legacyPersonalities.personalities && legacyPersonalities.aliases) {
          // It's actually the new format in the legacy file
          this._cache = legacyPersonalities;
        } else {
          // Convert from legacy format
          for (const [key, value] of Object.entries(legacyPersonalities)) {
            // Skip if it's not a personality object
            if (!value || typeof value !== 'object') continue;

            // Create a personality-like structure
            const personalityId = key;
            this._cache.personalities[personalityId] = {
              id: personalityId,
              personalityId: personalityId,
              ownerId: value.addedBy || 'unknown',
              profile: {
                name: value.fullName || key,
                displayName: value.displayName || value.fullName || key,
                prompt: `You are ${value.displayName || value.fullName || key}`,
                maxWordCount: 1000,
              },
              model: {
                name: 'default',
                endpoint: '/default',
                capabilities: {},
              },
              aliases: [],
              savedAt: value.lastUpdated || new Date().toISOString(),
            };
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn('[FilePersonalityRepository] Error loading legacy personalities:', error);
        }
      }

      // Try to load legacy aliases
      try {
        const aliasData = await fs.readFile(this.legacyAliasesPath, 'utf8');
        const legacyAliases = JSON.parse(aliasData);

        // Merge aliases into cache
        Object.assign(this._cache.aliases, legacyAliases);

        // Also add aliases to personality objects
        for (const [alias, personalityId] of Object.entries(legacyAliases)) {
          if (this._cache.personalities[personalityId]) {
            if (!this._cache.personalities[personalityId].aliases) {
              this._cache.personalities[personalityId].aliases = [];
            }
            this._cache.personalities[personalityId].aliases.push({
              value: alias,
              alias: alias,
            });
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.warn('[FilePersonalityRepository] Error loading legacy aliases:', error);
        }
      }

      // Save in new format
      await this._persist();
      logger.info('[FilePersonalityRepository] Migrated from legacy files');
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to load from legacy files:', error);
      // Initialize with empty data
      this._cache = { personalities: {}, aliases: {} };
      await this._persist();
    }
  }

  /**
   * Persist data in legacy format for compatibility with old personality manager
   * @private
   */
  async _persistLegacyFormat() {
    try {
      // Convert to legacy format
      const legacyPersonalities = {};
      const legacyAliases = {};

      for (const [id, personality] of Object.entries(this._cache.personalities)) {
        // Skip removed personalities
        if (personality.removed) continue;

        // Convert to legacy format
        legacyPersonalities[id] = {
          fullName: personality.profile.name || id,
          displayName: personality.profile.displayName || personality.profile.name || id,
          addedBy: personality.ownerId,
          addedAt: personality.savedAt || new Date().toISOString(),
          lastUpdated: personality.savedAt || new Date().toISOString(),
        };

        // Add aliases to legacy format
        if (personality.aliases && Array.isArray(personality.aliases)) {
          personality.aliases.forEach(alias => {
            const aliasValue = typeof alias === 'string' ? alias : alias.value || alias.alias;
            if (aliasValue) {
              legacyAliases[aliasValue] = id;
            }
          });
        }
      }

      // Also include aliases from cache
      Object.assign(legacyAliases, this._cache.aliases);

      // Write legacy format files (only if we're not already using them)
      if (this.filePath !== this.legacyPersonalitiesPath) {
        await fs.writeFile(
          this.legacyPersonalitiesPath,
          JSON.stringify(legacyPersonalities, null, 2),
          'utf8'
        );
        await fs.writeFile(this.legacyAliasesPath, JSON.stringify(legacyAliases, null, 2), 'utf8');
      }

      logger.debug('[FilePersonalityRepository] Legacy format data persisted');
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to persist legacy format:', error);
      // Don't throw - legacy format is for compatibility only
    }
  }

  /**
   * Ensure repository is initialized
   * @private
   */
  async _ensureInitialized() {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  /**
   * Create backup of data file
   * @returns {Promise<string>} Backup file path
   */
  async createBackup() {
    await this._ensureInitialized();

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(this.dataPath, `personalities-backup-${timestamp}.json`);

      const data = JSON.stringify(this._cache, null, 2);
      await fs.writeFile(backupPath, data, 'utf8');

      logger.info(`[FilePersonalityRepository] Created backup at: ${backupPath}`);
      return backupPath;
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to create backup:', error);
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Get repository statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    await this._ensureInitialized();

    return {
      totalPersonalities: Object.keys(this._cache.personalities).length,
      totalAliases: Object.keys(this._cache.aliases).length,
      owners: [...new Set(Object.values(this._cache.personalities).map(p => p.ownerId))].length,
    };
  }
}

module.exports = { FilePersonalityRepository };
