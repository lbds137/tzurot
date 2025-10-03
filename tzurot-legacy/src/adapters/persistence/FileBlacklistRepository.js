/**
 * FileBlacklistRepository - File-based implementation of BlacklistRepository
 * @module adapters/persistence/FileBlacklistRepository
 */

const fs = require('fs').promises;
const path = require('path');
const { BlacklistRepository } = require('../../domain/blacklist/BlacklistRepository');
const { BlacklistedUser } = require('../../domain/blacklist/BlacklistedUser');
const logger = require('../../logger');

/**
 * @class FileBlacklistRepository
 * @extends BlacklistRepository
 * @description File-based persistence for global blacklist
 */
class FileBlacklistRepository extends BlacklistRepository {
  /**
   * @param {Object} options
   * @param {string} options.dataPath - Path to data directory
   * @param {string} options.filename - Filename for blacklist data
   */
  constructor({ dataPath = './data', filename = 'blacklist.json' } = {}) {
    super();
    this.dataPath = dataPath;
    this.filePath = path.join(dataPath, filename);
    this._cache = null;
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

      // Try to load existing data
      try {
        const data = await fs.readFile(this.filePath, 'utf8');
        this._cache = JSON.parse(data);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, create empty structure
          logger.info('[FileBlacklistRepository] Blacklist file not found, creating new one');
          this._cache = {};
          await this._persist();
        } else {
          throw error;
        }
      }

      this._initialized = true;
      logger.info('[FileBlacklistRepository] Initialized successfully');
    } catch (error) {
      logger.error('[FileBlacklistRepository] Failed to initialize:', error);
      throw new Error(`Failed to initialize blacklist repository: ${error.message}`);
    }
  }

  /**
   * Add user to blacklist
   * @param {BlacklistedUser} blacklistedUser - User to blacklist
   * @returns {Promise<void>}
   */
  async add(blacklistedUser) {
    await this._ensureInitialized();

    try {
      const userId = blacklistedUser.userId.toString();
      this._cache[userId] = blacklistedUser.toJSON();
      await this._persist();

      logger.info(`[FileBlacklistRepository] Added user to blacklist: ${userId}`);
    } catch (error) {
      logger.error('[FileBlacklistRepository] Failed to add user to blacklist:', error);
      throw new Error(`Failed to add user to blacklist: ${error.message}`);
    }
  }

  /**
   * Remove user from blacklist
   * @param {string} userId - User ID to remove
   * @returns {Promise<void>}
   */
  async remove(userId) {
    await this._ensureInitialized();

    try {
      if (this._cache[userId]) {
        delete this._cache[userId];
        await this._persist();
        logger.info(`[FileBlacklistRepository] Removed user from blacklist: ${userId}`);
      }
    } catch (error) {
      logger.error('[FileBlacklistRepository] Failed to remove user from blacklist:', error);
      throw new Error(`Failed to remove user from blacklist: ${error.message}`);
    }
  }

  /**
   * Find blacklisted user by ID
   * @param {string} userId - User ID to find
   * @returns {Promise<BlacklistedUser|null>}
   */
  async find(userId) {
    await this._ensureInitialized();

    try {
      const data = this._cache[userId];
      if (!data) {
        return null;
      }

      return BlacklistedUser.fromData(data);
    } catch (error) {
      logger.error('[FileBlacklistRepository] Failed to find user:', error);
      throw new Error(`Failed to find blacklisted user: ${error.message}`);
    }
  }

  /**
   * Find all blacklisted users
   * @returns {Promise<BlacklistedUser[]>}
   */
  async findAll() {
    await this._ensureInitialized();

    try {
      const users = [];

      for (const data of Object.values(this._cache)) {
        try {
          users.push(BlacklistedUser.fromData(data));
        } catch (error) {
          logger.warn('[FileBlacklistRepository] Failed to hydrate blacklisted user:', error);
          // Skip invalid entries
        }
      }

      return users;
    } catch (error) {
      logger.error('[FileBlacklistRepository] Failed to find all users:', error);
      throw new Error(`Failed to find all blacklisted users: ${error.message}`);
    }
  }

  /**
   * Check if user is blacklisted
   * @param {string} userId - User ID to check
   * @returns {Promise<boolean>}
   */
  async isBlacklisted(userId) {
    await this._ensureInitialized();
    return !!this._cache[userId];
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

      logger.debug('[FileBlacklistRepository] Data persisted successfully');
    } catch (error) {
      logger.error('[FileBlacklistRepository] Failed to persist data:', error);
      throw new Error(`Failed to persist blacklist data: ${error.message}`);
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
}

module.exports = { FileBlacklistRepository };
