const fs = require('fs').promises;
const path = require('path');
const { AuthenticationRepository } = require('../../domain/authentication');
const { UserAuth } = require('../../domain/authentication');
const logger = require('../../logger');

/**
 * FileAuthenticationRepository - File-based implementation of AuthenticationRepository
 *
 * This adapter implements persistence for user authentication using the file system.
 * In production, this would likely be replaced with a secure database adapter.
 *
 * Note: This implementation stores sensitive tokens - in production, these would
 * be encrypted at rest.
 */
class FileAuthenticationRepository extends AuthenticationRepository {
  /**
   * @param {Object} options
   * @param {string} options.dataPath - Path to data directory
   * @param {string} options.filename - Filename for auth data
   * @param {number} options.tokenCleanupInterval - Interval for token cleanup (ms)
   * @param {Function} options.setInterval - Injectable timer function for testing
   * @param {Function} options.clearInterval - Injectable timer function for testing
   */
  constructor({
    dataPath = './data',
    filename = 'authentication.json',
    tokenCleanupInterval = 60 * 60 * 1000, // 1 hour
    setInterval,
    clearInterval,
  } = {}) {
    super();
    this.dataPath = dataPath;
    this.filePath = path.join(dataPath, filename);
    this.tokenCleanupInterval = tokenCleanupInterval;
    // Injectable timers for testing
    this._setInterval = setInterval || require('timers').setInterval;
    this._clearInterval = clearInterval || require('timers').clearInterval;
    this._cache = null; // In-memory cache
    this._initialized = false;
    this._cleanupTimer = null;
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

      // Check for legacy auth_tokens.json file first
      const legacyPath = path.join(this.dataPath, 'auth_tokens.json');
      try {
        const legacyData = await fs.readFile(legacyPath, 'utf8');
        const legacyTokens = JSON.parse(legacyData);

        logger.info(
          '[FileAuthenticationRepository] Found legacy auth_tokens.json, migrating to new format'
        );
        this._cache = await this._migrateFromLegacyFormat(legacyTokens);
        await this._persist();

        // Rename legacy file to prevent re-migration
        await fs.rename(legacyPath, `${legacyPath}.migrated`);
        logger.info(
          '[FileAuthenticationRepository] Legacy migration complete, renamed to auth_tokens.json.migrated'
        );
      } catch (legacyError) {
        if (legacyError.code !== 'ENOENT') {
          logger.warn('[FileAuthenticationRepository] Error reading legacy file:', legacyError);
        }

        // No legacy file or error reading it, try loading current format
        try {
          const data = await fs.readFile(this.filePath, 'utf8');
          const parsedData = JSON.parse(data);

          // Handle migration from old DDD format to new format (dev only)
          if (parsedData.userAuth && parsedData.tokens) {
            logger.info(
              '[FileAuthenticationRepository] Migrating from old DDD format to new format'
            );
            this._cache = await this._migrateFromOldFormat(parsedData);
            await this._persist();
          } else {
            this._cache = parsedData;
          }
        } catch (error) {
          if (error.code === 'ENOENT') {
            // File doesn't exist, create it
            this._cache = {};
            await this._persist();
          } else {
            throw error;
          }
        }
      }

      // Clean up expired tokens on startup
      await this._cleanupExpiredTokens();

      // Start periodic cleanup
      this._startCleanupTimer();

      this._initialized = true;
      logger.info('[FileAuthenticationRepository] Initialized successfully');
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to initialize:', error);
      throw new Error(`Failed to initialize repository: ${error.message}`);
    }
  }

  /**
   * Save user authentication
   * @param {UserAuth} userAuth - User auth to save
   * @returns {Promise<void>}
   */
  async save(userAuth) {
    await this._ensureInitialized();

    try {
      const data = userAuth.toJSON();

      // Simple structure - one user, one auth record
      this._cache[userAuth.userId.toString()] = {
        ...data,
        userId: userAuth.userId.toString(),
        savedAt: new Date().toISOString(),
      };

      await this._persist();

      logger.info(`[FileAuthenticationRepository] Saved user auth: ${userAuth.userId.toString()}`);
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to save user auth:', error);
      throw new Error(`Failed to save user auth: ${error.message}`);
    }
  }

  /**
   * Find user authentication by user ID
   * @param {string} userId - User ID
   * @returns {Promise<UserAuth|null>}
   */
  async findByUserId(userId) {
    await this._ensureInitialized();

    try {
      const data = this._cache[userId];
      if (!data) {
        return null;
      }

      return this._hydrate(data);
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to find by user ID:', error);
      throw new Error(`Failed to find user auth: ${error.message}`);
    }
  }

  /**
   * Find user authentication by token
   * @param {string} token - Token value
   * @returns {Promise<UserAuth|null>}
   */
  async findByToken(token) {
    await this._ensureInitialized();

    try {
      // Search through all users to find the one with this token
      for (const userData of Object.values(this._cache)) {
        if (userData.token && userData.token.value === token) {
          return this._hydrate(userData);
        }
      }

      return null;
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to find by token:', error);
      throw new Error(`Failed to find user auth by token: ${error.message}`);
    }
  }

  /**
   * Delete user authentication
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async delete(userId) {
    await this._ensureInitialized();

    try {
      if (this._cache[userId]) {
        delete this._cache[userId];
        await this._persist();
        logger.info(`[FileAuthenticationRepository] Deleted user auth: ${userId}`);
      }
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to delete:', error);
      throw new Error(`Failed to delete user auth: ${error.message}`);
    }
  }

  /**
   * Check if user exists
   * @param {string} userId - User ID
   * @returns {Promise<boolean>}
   */
  async exists(userId) {
    await this._ensureInitialized();
    return !!this._cache[userId];
  }

  /**
   * Count all authenticated users
   * @returns {Promise<number>}
   */
  async countAuthenticated() {
    await this._ensureInitialized();
    return Object.keys(this._cache).length;
  }

  /**
   * @deprecated Use BlacklistRepository instead
   * Find all blacklisted users
   * @returns {Promise<UserAuth[]>}
   */
  async findBlacklisted() {
    await this._ensureInitialized();

    try {
      const results = [];

      for (const userData of Object.values(this._cache)) {
        if (userData.blacklisted) {
          const userAuth = this._hydrate(userData);
          if (userAuth) {
            results.push(userAuth);
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to find blacklisted:', error);
      throw new Error(`Failed to find blacklisted users: ${error.message}`);
    }
  }

  /**
   * Find all users with expired tokens
   * @returns {Promise<UserAuth[]>}
   */
  async findExpiredTokens() {
    await this._ensureInitialized();

    try {
      const results = [];
      const now = Date.now();

      for (const userData of Object.values(this._cache)) {
        if (userData.token && userData.token.expiresAt) {
          const expiresAt = new Date(userData.token.expiresAt).getTime();
          if (expiresAt < now) {
            const userAuth = this._hydrate(userData);
            if (userAuth) {
              results.push(userAuth);
            }
          }
        }
      }

      return results;
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to find expired tokens:', error);
      throw new Error(`Failed to find expired tokens: ${error.message}`);
    }
  }

  /**
   * Hydrate a UserAuth from stored data
   * @private
   */
  _hydrate(data) {
    try {
      // Ensure we have the required data
      if (!data || !data.userId || !data.token) {
        logger.warn('[FileAuthenticationRepository] Cannot hydrate user without userId and token');
        return null;
      }

      // Use the fromData factory method
      const userAuth = UserAuth.fromData(data);

      // Mark as hydrated from persistence
      userAuth.markEventsAsCommitted();

      return userAuth;
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to hydrate user auth:', {
        error: error.message,
        userId: data?.userId,
        hasToken: !!data?.token,
        tokenValue: data?.token?.value ? 'present' : 'missing',
      });
      return null;
    }
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

      logger.debug('[FileAuthenticationRepository] Data persisted successfully');
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to persist data:', error);
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
   * Clean up expired tokens
   * @private
   */
  async _cleanupExpiredTokens() {
    // In the simplified structure, we don't actually remove expired tokens
    // The domain logic handles token expiry checking
    // This method is kept for interface compatibility but does nothing
    logger.debug('[FileAuthenticationRepository] Token cleanup check completed');
  }

  /**
   * Start cleanup timer
   * @private
   */
  _startCleanupTimer() {
    if (this._cleanupTimer) {
      this._clearInterval(this._cleanupTimer);
    }

    this._cleanupTimer = this._setInterval(async () => {
      try {
        await this._cleanupExpiredTokens();
      } catch (error) {
        logger.error('[FileAuthenticationRepository] Cleanup error:', error);
      }
    }, this.tokenCleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  async shutdown() {
    if (this._cleanupTimer) {
      this._clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    logger.info('[FileAuthenticationRepository] Shutdown complete');
  }

  /**
   * Migrate from old format to new format
   * @private
   */
  async _migrateFromOldFormat(oldData) {
    const newData = {};

    // Migrate each user from the old format
    for (const [userId, userData] of Object.entries(oldData.userAuth)) {
      // Find the most recent valid token for this user
      let mostRecentToken = null;

      if (userData.token) {
        // User already has a single token in the data
        mostRecentToken = userData.token;
      } else if (userData.tokens && userData.tokens.length > 0) {
        // Find the most recent non-revoked, non-expired token
        const now = Date.now();
        let latestTime = 0;

        for (const tokenData of userData.tokens) {
          if (tokenData.revokedAt) continue;
          if (tokenData.expiresAt && new Date(tokenData.expiresAt).getTime() < now) continue;

          const tokenTime = new Date(
            tokenData.createdAt || userData.savedAt || Date.now()
          ).getTime();
          if (tokenTime > latestTime) {
            latestTime = tokenTime;
            mostRecentToken = {
              value: tokenData.value,
              expiresAt: tokenData.expiresAt,
            };
          }
        }
      }

      // Create the simplified user data
      newData[userId] = {
        userId: userData.userId,
        token: mostRecentToken,
        nsfwStatus: userData.nsfwStatus || { verified: false, verifiedAt: null },
        savedAt: userData.savedAt || new Date().toISOString(),
      };
    }

    logger.info(
      `[FileAuthenticationRepository] Migrated ${Object.keys(newData).length} users to new format`
    );
    return newData;
  }

  /**
   * Migrate from legacy format (auth_tokens.json + nsfw_verified.json) to new format
   * @private
   */
  async _migrateFromLegacyFormat(legacyTokens) {
    const newData = {};

    // Also try to load nsfw_verified.json if it exists
    let nsfwVerifiedData = {};
    try {
      const nsfwPath = path.join(this.dataPath, 'nsfw_verified.json');
      const nsfwContent = await fs.readFile(nsfwPath, 'utf8');
      nsfwVerifiedData = JSON.parse(nsfwContent);
      logger.info(
        '[FileAuthenticationRepository] Found nsfw_verified.json, will merge with auth data'
      );
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn('[FileAuthenticationRepository] Error reading nsfw_verified.json:', error);
      }
    }

    // Migrate each user from the legacy format
    for (const [userId, tokenData] of Object.entries(legacyTokens)) {
      // Skip invalid entries
      if (!tokenData || !tokenData.token) {
        logger.warn(
          `[FileAuthenticationRepository] Skipping invalid legacy entry for user ${userId}`
        );
        continue;
      }

      // Get NSFW verification status if available
      const nsfwInfo = nsfwVerifiedData[userId] || {};

      // Create the new user data
      newData[userId] = {
        userId: userId,
        token: {
          value: tokenData.token,
          expiresAt: null, // Ignore expiration as requested
        },
        nsfwStatus: {
          verified: nsfwInfo.verified || false,
          verifiedAt: nsfwInfo.verifiedAt ? new Date(nsfwInfo.verifiedAt).toISOString() : null,
        },
        savedAt: new Date().toISOString(),
      };
    }

    // Rename nsfw_verified.json if we migrated from it
    if (Object.keys(nsfwVerifiedData).length > 0) {
      try {
        const nsfwPath = path.join(this.dataPath, 'nsfw_verified.json');
        await fs.rename(nsfwPath, `${nsfwPath}.migrated`);
        logger.info(
          '[FileAuthenticationRepository] Renamed nsfw_verified.json to nsfw_verified.json.migrated'
        );
      } catch (error) {
        logger.warn('[FileAuthenticationRepository] Could not rename nsfw_verified.json:', error);
      }
    }

    logger.info(
      `[FileAuthenticationRepository] Migrated ${Object.keys(newData).length} users from legacy format`
    );
    return newData;
  }
}

module.exports = { FileAuthenticationRepository };
