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
  constructor({ dataPath = './data', filename = 'personalities.json' } = {}) {
    super();
    this.dataPath = dataPath;
    this.filePath = path.join(dataPath, filename);
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

        // Check if this is legacy format (flat structure without personalities/aliases properties)
        if (
          parsedData &&
          typeof parsedData === 'object' &&
          !parsedData.personalities &&
          !parsedData.aliases
        ) {
          // Check if it has personality-like data (has properties with fullName)
          const hasLegacyData = Object.values(parsedData).some(
            item => item && typeof item === 'object' && (item.fullName || item.addedBy)
          );

          if (hasLegacyData) {
            logger.info('[FilePersonalityRepository] Detected legacy format, migrating...');
            await this._migrateLegacyData(parsedData);
            return;
          }
        }

        // Ensure the parsed data has the expected structure
        if (!parsedData || typeof parsedData !== 'object') {
          throw new Error('Invalid file structure');
        }

        // Ensure required properties exist
        this._cache = {
          personalities: parsedData.personalities || {},
          aliases: parsedData.aliases || {},
        };

        logger.info('[FilePersonalityRepository] Loaded personalities from file');
      } catch (error) {
        if (
          error.code === 'ENOENT' ||
          error instanceof SyntaxError ||
          error.message === 'Invalid file structure'
        ) {
          // File doesn't exist or is corrupted, create empty structure
          logger.info(
            `[FilePersonalityRepository] Personalities file not found or corrupted (${error.message}), creating new one`
          );
          this._cache = {
            personalities: {},
            aliases: {},
          };
          await this._persist();
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

      // Sync alias mappings
      // First, remove any aliases that previously pointed to this personality
      Object.entries(this._cache.aliases).forEach(([alias, id]) => {
        if (id === personality.personalityId.value) {
          delete this._cache.aliases[alias];
        }
      });

      // Then add current aliases
      if (personality.aliases && Array.isArray(personality.aliases)) {
        personality.aliases.forEach(alias => {
          const aliasValue = alias.value || alias;
          // Only add if not already pointing to another personality
          if (
            !this._cache.aliases[aliasValue] ||
            this._cache.aliases[aliasValue] === personality.personalityId.value
          ) {
            this._cache.aliases[aliasValue] = personality.personalityId.value;
          } else {
            logger.warn(
              `[FilePersonalityRepository] Alias "${aliasValue}" already points to ${this._cache.aliases[aliasValue]}, not adding to ${personality.personalityId.value}`
            );
          }
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

      // Ensure cache structure exists
      if (!this._cache || !this._cache.personalities) {
        logger.warn(
          '[FilePersonalityRepository] Cache not properly initialized, returning empty list'
        );
        return personalities;
      }

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
   * Find personality by name or alias with proper resolution order
   * @param {string} nameOrAlias - Name or alias to search for
   * @returns {Promise<Personality|null>}
   */
  async findByNameOrAlias(nameOrAlias) {
    await this._ensureInitialized();

    try {
      const normalized = nameOrAlias.toLowerCase();

      // Log for debugging
      logger.debug(`[FilePersonalityRepository] findByNameOrAlias called with: ${nameOrAlias}`);

      // Check if cache is initialized
      if (!this._cache || !this._cache.personalities) {
        logger.warn('[FilePersonalityRepository] Cache not initialized in findByNameOrAlias');
        return null;
      }

      // 1. First check for exact name match (profile.name or personality ID)
      for (const data of Object.values(this._cache.personalities)) {
        if (data.removed) continue;

        // Check exact name match
        if (
          data.profile?.name?.toLowerCase() === normalized ||
          data.id?.toLowerCase() === normalized ||
          data.personalityId?.toLowerCase() === normalized
        ) {
          return this._hydrate(data);
        }
      }

      // 2. Then check explicit aliases (global alias mapping)
      const personalityId = Object.entries(this._cache.aliases).find(
        ([key]) => key.toLowerCase() === normalized
      )?.[1];

      if (personalityId) {
        const data = this._cache.personalities[personalityId];
        if (data && !data.removed) {
          return this._hydrate(data);
        }
      }

      // 3. Finally check display names as a fallback
      for (const data of Object.values(this._cache.personalities)) {
        if (data.removed) continue;

        if (data.profile?.displayName?.toLowerCase() === normalized) {
          return this._hydrate(data);
        }
      }

      return null;
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to find by name or alias:', error);
      throw new Error(`Failed to find personality: ${error.message}`);
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
        // New format - use object constructor to preserve all fields
        profile = new PersonalityProfile({
          mode: data.profile.mode || 'local',
          name: data.profile.name || data.id || data.personalityId,
          displayName:
            data.profile.displayName || data.profile.name || data.id || data.personalityId,
          prompt: data.profile.prompt || `You are ${data.profile.name || data.id}`,
          modelPath: data.profile.modelPath || '/default',
          maxWordCount: data.profile.maxWordCount || 1000,
          avatarUrl: data.profile.avatarUrl,
          bio: data.profile.bio,
          systemPrompt: data.profile.systemPrompt,
          temperature: data.profile.temperature,
          maxTokens: data.profile.maxTokens,
        });
      } else {
        // Legacy format - convert to new format using object constructor
        profile = new PersonalityProfile({
          mode: data.profile.mode || 'local',
          name: data.profile.displayName || data.id || data.personalityId,
          displayName: data.profile.displayName || data.id || data.personalityId,
          prompt: data.profile.systemPrompt || `You are ${data.profile.displayName || data.id}`,
          modelPath: '/default',
          maxWordCount: data.profile.maxTokens || 1000,
          avatarUrl: data.profile.avatarUrl,
          errorMessage: data.profile.errorMessage,
        });
      }
    } else {
      // No profile data - create default using object constructor
      profile = new PersonalityProfile({
        mode: 'local',
        name: data.id || data.personalityId,
        displayName: data.id || data.personalityId,
        prompt: `You are ${data.id || data.personalityId}`,
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

      logger.debug('[FilePersonalityRepository] Data persisted successfully');
    } catch (error) {
      logger.error('[FilePersonalityRepository] Failed to persist data:', error);
      throw new Error(`Failed to persist data: ${error.message}`);
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

  /**
   * Migrate legacy personality data to new format
   * @private
   * @param {Object} legacyData - Legacy flat format data
   */
  async _migrateLegacyData(legacyData) {
    const migrated = {
      personalities: {},
      aliases: {},
    };

    // Also check for legacy aliases file
    const aliasesPath = path.join(this.dataPath, 'aliases.json');
    let legacyAliases = {};
    try {
      const aliasData = await fs.readFile(aliasesPath, 'utf8');
      legacyAliases = JSON.parse(aliasData) || {};
      logger.info(
        `[FilePersonalityRepository] Found legacy aliases file with ${Object.keys(legacyAliases).length} aliases`
      );
    } catch (_error) {
      logger.info('[FilePersonalityRepository] No legacy aliases file found');
    }

    // Migrate each personality
    for (const [name, data] of Object.entries(legacyData)) {
      // Skip if not a valid personality entry
      if (!data || typeof data !== 'object' || (!data.fullName && !data.addedBy)) {
        continue;
      }

      const personalityId = data.fullName || name; // Use fullName as ID for compatibility

      migrated.personalities[personalityId] = {
        id: personalityId,
        personalityId: personalityId,
        ownerId: data.addedBy || data.createdBy || 'unknown',
        profile: {
          mode: 'external',
          name: data.fullName || name,
          displayName: data.displayName || data.fullName || name,
          avatarUrl: data.avatarUrl || null,
          errorMessage: data.errorMessage || null,
        },
        aliases: [],
        createdAt: data.addedAt || data.lastUpdated || new Date().toISOString(),
        updatedAt: data.lastUpdated || new Date().toISOString(),
        removed: false,
      };
    }

    // Migrate aliases
    for (const [alias, targetName] of Object.entries(legacyAliases)) {
      const lowerAlias = alias.toLowerCase();
      migrated.aliases[lowerAlias] = targetName;

      // Add to personality's alias list if personality exists
      if (migrated.personalities[targetName]) {
        migrated.personalities[targetName].aliases.push({
          value: lowerAlias,
          originalCase: alias,
        });
      }
    }

    // Save migrated data
    this._cache = migrated;
    await this._persist();

    // Backup legacy data
    const backupPath = path.join(this.dataPath, 'personalities.legacy.json');
    await fs.writeFile(backupPath, JSON.stringify(legacyData, null, 2));
    logger.info(`[FilePersonalityRepository] Backed up legacy data to ${backupPath}`);

    // Mark as initialized
    this._initialized = true;

    logger.info(
      `[FilePersonalityRepository] Migration complete: ${Object.keys(migrated.personalities).length} personalities, ${Object.keys(migrated.aliases).length} aliases`
    );
  }
}

module.exports = { FilePersonalityRepository };
