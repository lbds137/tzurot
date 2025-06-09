const fs = require('fs').promises;
const path = require('path');
const { AuthenticationRepository } = require('../../domain/authentication');
const { UserAuth, Token } = require('../../domain/authentication');
const { UserId } = require('../../domain/personality');
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
    clearInterval
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
      
      // Load existing data or create new file
      try {
        const data = await fs.readFile(this.filePath, 'utf8');
        this._cache = JSON.parse(data);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, create it
          this._cache = { userAuth: {}, tokens: {} };
          await this._persist();
        } else {
          throw error;
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
      
      // Store user auth - maintaining backward compatibility with existing data
      // that may have multiple tokens per user
      const existingData = this._cache.userAuth[userAuth.userId.toString()];
      const existingTokens = existingData ? existingData.tokens : [];
      
      // If this user already has tokens for other personalities, preserve them
      const otherTokens = existingTokens.filter(t => 
        userAuth.token && t.personalityId !== userAuth.token.personalityId
      );
      
      // Add current token if exists
      const currentTokens = userAuth.token ? [...otherTokens, userAuth.token.toJSON()] : otherTokens;
      
      this._cache.userAuth[userAuth.userId.toString()] = {
        ...data,
        userId: userAuth.userId.toString(),
        tokens: currentTokens,
        savedAt: new Date().toISOString(),
      };
      
      // Store token separately for efficient lookup
      if (userAuth.token) {
        // The Token object doesn't have personalityId, we need to extract from auth context
        const tokenJson = userAuth.token.toJSON();
        this._cache.tokens[userAuth.token.value] = {
          userId: userAuth.userId.toString(),
          personalityId: data.personalityId || 'unknown', // Extract from userAuth data
          createdAt: new Date().toISOString(),
          expiresAt: tokenJson.expiresAt,
          revokedAt: null,
        };
      }
      
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
      const data = this._cache.userAuth[userId];
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
      const tokenData = this._cache.tokens[token];
      if (!tokenData) {
        return null;
      }
      
      // Get the user auth
      const userAuthData = this._cache.userAuth[tokenData.userId];
      if (!userAuthData) {
        // Token exists but user doesn't - cleanup orphaned token
        delete this._cache.tokens[token];
        await this._persist();
        return null;
      }
      
      return this._hydrate(userAuthData);
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to find by token:', error);
      throw new Error(`Failed to find user auth by token: ${error.message}`);
    }
  }

  /**
   * Find all authentications for a personality
   * @param {string} personalityId - Personality ID
   * @returns {Promise<UserAuth[]>}
   */
  async findByPersonalityId(personalityId) {
    await this._ensureInitialized();
    
    try {
      const results = [];
      
      for (const data of Object.values(this._cache.userAuth)) {
        // Check if user has any tokens for this personality
        const hasPersonalityToken = data.tokens.some(
          t => t.personalityId === personalityId && !t.revokedAt
        );
        
        if (hasPersonalityToken) {
          results.push(await this._hydrate(data));
        }
      }
      
      return results;
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to find by personality:', error);
      throw new Error(`Failed to find user auth by personality: ${error.message}`);
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
      const userAuth = this._cache.userAuth[userId];
      if (userAuth) {
        // Remove all associated tokens
        for (const token of (userAuth.tokens || [])) {
          delete this._cache.tokens[token.value];
        }
        
        // Remove user auth
        delete this._cache.userAuth[userId];
        
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
    return !!this._cache.userAuth[userId];
  }

  /**
   * Count all users with valid tokens
   * @returns {Promise<number>}
   */
  async countActiveUsers() {
    await this._ensureInitialized();
    
    try {
      let count = 0;
      const now = Date.now();
      
      for (const userAuth of Object.values(this._cache.userAuth)) {
        // Check if user has any valid (non-expired, non-revoked) tokens
        const hasValidToken = userAuth.tokens.some(token => {
          if (token.revokedAt) return false;
          if (!token.expiresAt) return true;
          return new Date(token.expiresAt).getTime() > now;
        });
        
        if (hasValidToken) {
          count++;
        }
      }
      
      return count;
    } catch (error) {
      logger.error('[FileAuthenticationRepository] Failed to count active users:', error);
      throw new Error(`Failed to count active users: ${error.message}`);
    }
  }

  /**
   * Hydrate a UserAuth from stored data
   * @private
   */
  _hydrate(data) {
    // Since UserAuth requires authentication with a token, we need to handle this differently
    // We'll create a UserAuth instance for each token stored (backward compatibility)
    // For now, return the UserAuth with the most recent valid token
    
    const userId = new UserId(data.userId);
    
    // Find the most recent valid token
    let latestToken = null;
    let latestTime = 0;
    
    for (const tokenData of data.tokens || []) {
      // Skip revoked tokens
      if (tokenData.revokedAt) continue;
      
      // Skip expired tokens
      if (tokenData.expiresAt && new Date(tokenData.expiresAt).getTime() < Date.now()) continue;
      
      const tokenTime = new Date(tokenData.createdAt).getTime();
      if (tokenTime > latestTime) {
        latestTime = tokenTime;
        latestToken = tokenData;
      }
    }
    
    // If no valid token, create UserAuth without authentication
    // We need to handle this edge case
    let userAuth;
    if (latestToken) {
      // Token requires expiresAt, so we need to handle tokens without expiry differently
      let token;
      if (latestToken.expiresAt) {
        token = new Token(latestToken.value, new Date(latestToken.expiresAt));
      } else {
        // For tokens without expiry, set a far future date
        const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
        token = new Token(latestToken.value, farFuture);
      }
      
      userAuth = UserAuth.authenticate(userId, token);
    } else {
      // Create unauthenticated user - we'll need to handle this
      // For now, create with a dummy constructor call
      userAuth = new UserAuth(userId);
    }
    
    // Set NSFW status if different from default
    // Handle both string format (legacy) and object format (from toJSON)
    if (data.nsfwStatus) {
      const nsfwStatus = typeof data.nsfwStatus === 'string' 
        ? data.nsfwStatus 
        : (data.nsfwStatus.verified ? 'verified' : 'unverified');
        
      if (nsfwStatus === 'verified') {
        userAuth.verifyNsfw();
      } else if (nsfwStatus === 'blocked') {
        // The domain model might not have blockNsfw, check first
        if (typeof userAuth.blockNsfw === 'function') {
          userAuth.blockNsfw();
        } else {
          // Set blacklisted instead if blockNsfw doesn't exist
          userAuth.blacklisted = true;
        }
      }
    }
    
    // Store reference to all tokens for backward compatibility queries
    userAuth._allTokens = data.tokens || [];
    
    // Mark as hydrated from persistence
    userAuth.markEventsAsCommitted();
    
    return userAuth;
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
    const now = Date.now();
    let cleanedCount = 0;
    
    // Clean up expired tokens from token index
    for (const [tokenValue, tokenData] of Object.entries(this._cache.tokens)) {
      if (tokenData.expiresAt && new Date(tokenData.expiresAt).getTime() < now) {
        delete this._cache.tokens[tokenValue];
        cleanedCount++;
      }
    }
    
    // Clean up expired tokens from user auth
    for (const userAuth of Object.values(this._cache.userAuth)) {
      userAuth.tokens = userAuth.tokens.filter(token => {
        if (!token.expiresAt) return true;
        return new Date(token.expiresAt).getTime() >= now;
      });
    }
    
    if (cleanedCount > 0) {
      logger.info(`[FileAuthenticationRepository] Cleaned up ${cleanedCount} expired tokens`);
      await this._persist();
    }
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
   * Get repository statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    await this._ensureInitialized();
    
    const totalUsers = Object.keys(this._cache.userAuth).length;
    const totalTokens = Object.keys(this._cache.tokens).length;
    
    let activeTokens = 0;
    let expiredTokens = 0;
    let revokedTokens = 0;
    let verifiedUsers = 0;
    let blockedUsers = 0;
    
    const now = Date.now();
    
    for (const tokenData of Object.values(this._cache.tokens)) {
      if (tokenData.revokedAt) {
        revokedTokens++;
      } else if (tokenData.expiresAt && new Date(tokenData.expiresAt).getTime() < now) {
        expiredTokens++;
      } else {
        activeTokens++;
      }
    }
    
    for (const userAuth of Object.values(this._cache.userAuth)) {
      if (userAuth.nsfwStatus === 'verified') {
        verifiedUsers++;
      } else if (userAuth.nsfwStatus === 'blocked') {
        blockedUsers++;
      }
    }
    
    return {
      totalUsers,
      totalTokens,
      activeTokens,
      expiredTokens,
      revokedTokens,
      verifiedUsers,
      blockedUsers,
    };
  }
}

module.exports = { FileAuthenticationRepository };