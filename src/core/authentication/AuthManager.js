/**
 * AuthManager - Main authentication orchestrator
 *
 * Coordinates all authentication subsystems:
 * - User token management
 * - NSFW verification
 * - AI client creation
 * - Personality authentication
 * - Data persistence
 */

const UserTokenManager = require('./UserTokenManager');
const NsfwVerificationManager = require('./NsfwVerificationManager');
const AIClientFactory = require('./AIClientFactory');
const PersonalityAuthValidator = require('./PersonalityAuthValidator');
const AuthPersistence = require('./AuthPersistence');
const logger = require('../../logger');

class AuthManager {
  constructor(config = {}) {
    // Configuration
    this.appId = config.appId || process.env.SERVICE_APP_ID;
    this.apiKey = config.apiKey || process.env.SERVICE_API_KEY;
    this.authWebsite = config.authWebsite || process.env.SERVICE_WEBSITE;
    this.authApiEndpoint = config.authApiEndpoint || `${process.env.SERVICE_API_BASE_URL}/auth`;
    this.serviceApiBaseUrl = config.serviceApiBaseUrl || process.env.SERVICE_API_BASE_URL;
    this.ownerId = config.ownerId || process.env.OWNER_ID;
    this.dataDir = config.dataDir || null; // null = use default

    // Initialize sub-modules
    this.userTokenManager = new UserTokenManager(
      this.appId,
      this.apiKey,
      this.authApiEndpoint,
      this.authWebsite
    );
    this.nsfwVerificationManager = new NsfwVerificationManager();
    this.aiClientFactory = new AIClientFactory(this.apiKey, this.serviceApiBaseUrl);
    this.personalityAuthValidator = new PersonalityAuthValidator(
      this.nsfwVerificationManager,
      this.userTokenManager,
      this.ownerId
    );
    this.authPersistence = new AuthPersistence(this.dataDir);

    // Cleanup interval handle
    this.cleanupInterval = null;
    
    // Injectable timer function
    this.interval = config.interval || setInterval;
  }

  /**
   * Initialize the auth system
   * @returns {Promise<void>}
   */
  async initialize() {
    logger.info(`[AuthManager] Initializing auth system with app ID: ${this.appId}`);

    try {
      // Initialize AI client factory
      await this.aiClientFactory.initialize();

      // Load persisted data
      const [tokens, verifications] = await Promise.all([
        this.authPersistence.loadUserTokens(),
        this.authPersistence.loadNsfwVerifications()
      ]);

      // Set loaded data
      this.userTokenManager.setAllTokens(tokens);
      this.nsfwVerificationManager.setAllVerifications(verifications);

      // Clean up expired tokens on startup
      const expiredCount = this.userTokenManager.cleanupExpiredTokens();
      if (expiredCount > 0) {
        await this.authPersistence.saveUserTokens(this.userTokenManager.getAllTokens());
        logger.info(`[AuthManager] Cleaned up ${expiredCount} expired tokens on startup`);
      }

      // Schedule periodic cleanup (every 24 hours)
      this.cleanupInterval = this.interval(
        async () => {
          await this.performScheduledCleanup();
        },
        24 * 60 * 60 * 1000
      );
      
      // Allow process to exit even with interval running
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }

      logger.info(`[AuthManager] Auth system initialized successfully`);
    } catch (error) {
      logger.error(`[AuthManager] Failed to initialize:`, error);
      throw error;
    }
  }

  /**
   * Perform scheduled cleanup tasks
   * @returns {Promise<void>}
   */
  async performScheduledCleanup() {
    try {
      const removedCount = this.userTokenManager.cleanupExpiredTokens();
      if (removedCount > 0) {
        await this.authPersistence.saveUserTokens(this.userTokenManager.getAllTokens());
        logger.info(`[AuthManager] Scheduled cleanup removed ${removedCount} expired tokens`);
      }
    } catch (error) {
      logger.error(`[AuthManager] Error during scheduled cleanup:`, error);
    }
  }

  /**
   * Get authorization URL for a user
   * @returns {string} The authorization URL
   */
  getAuthorizationUrl() {
    return this.userTokenManager.getAuthorizationUrl();
  }

  /**
   * Exchange authorization code for token
   * @param {string} code - The authorization code
   * @param {string} userId - The Discord user ID
   * @returns {Promise<boolean>} Whether exchange was successful
   */
  async exchangeCodeForToken(code, userId) {
    try {
      const token = await this.userTokenManager.exchangeCodeForToken(code);
      if (!token) {
        return false;
      }

      // Store the token
      this.userTokenManager.storeUserToken(userId, token);
      
      // Persist to disk
      await this.authPersistence.saveUserTokens(this.userTokenManager.getAllTokens());
      
      // Clear cached AI client for this user
      this.aiClientFactory.clearUserClient(userId);
      
      return true;
    } catch (error) {
      logger.error(`[AuthManager] Error exchanging code for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Delete user token
   * @param {string} userId - The Discord user ID
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteUserToken(userId) {
    try {
      this.userTokenManager.deleteUserToken(userId);
      await this.authPersistence.saveUserTokens(this.userTokenManager.getAllTokens());
      this.aiClientFactory.clearUserClient(userId);
      return true;
    } catch (error) {
      logger.error(`[AuthManager] Error deleting token for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Store NSFW verification
   * @param {string} userId - The Discord user ID
   * @param {boolean} isVerified - Whether user is verified
   * @returns {Promise<boolean>} Whether storage was successful
   */
  async storeNsfwVerification(userId, isVerified) {
    try {
      this.nsfwVerificationManager.storeNsfwVerification(userId, isVerified);
      await this.authPersistence.saveNsfwVerifications(this.nsfwVerificationManager.getAllVerifications());
      return true;
    } catch (error) {
      logger.error(`[AuthManager] Error storing NSFW verification for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Get AI client for a user/context
   * @param {Object} options - Client options
   * @returns {Promise<Object>} The OpenAI client
   */
  async getAIClient(options = {}) {
    const { userId, isWebhook, useDefault } = options;
    
    // Get user token if userId provided
    const userToken = userId ? this.userTokenManager.getUserToken(userId) : null;
    
    return this.aiClientFactory.getClient({
      userId,
      userToken,
      isWebhook,
      useDefault
    });
  }

  /**
   * Validate personality access
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation result
   */
  async validatePersonalityAccess(options) {
    return this.personalityAuthValidator.validateAccess(options);
  }

  /**
   * Get user auth status
   * @param {string} userId - The Discord user ID
   * @returns {Object} Auth status
   */
  getUserAuthStatus(userId) {
    return this.personalityAuthValidator.getUserAuthStatus(userId);
  }

  /**
   * Check if user has valid token
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether user has valid token
   */
  hasValidToken(userId) {
    return this.userTokenManager.hasValidToken(userId);
  }

  /**
   * Check if user is NSFW verified
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether user is verified
   */
  isNsfwVerified(userId) {
    return this.nsfwVerificationManager.isNsfwVerified(userId);
  }

  /**
   * Get token info
   * @param {string} userId - The Discord user ID
   * @returns {Object|null} Token expiration info
   */
  getTokenExpirationInfo(userId) {
    return this.userTokenManager.getTokenExpirationInfo(userId);
  }

  /**
   * Get auth help message
   * @param {Object} validationResult - Result from validatePersonalityAccess
   * @returns {string} Help message
   */
  getAuthHelpMessage(validationResult) {
    return this.personalityAuthValidator.getAuthHelpMessage(validationResult);
  }

  /**
   * Shutdown the auth system
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Save any pending changes
    await Promise.all([
      this.authPersistence.saveUserTokens(this.userTokenManager.getAllTokens()),
      this.authPersistence.saveNsfwVerifications(this.nsfwVerificationManager.getAllVerifications())
    ]);

    logger.info(`[AuthManager] Auth system shut down`);
  }

  /**
   * Get system statistics
   * @returns {Promise<Object>} System statistics
   */
  async getStatistics() {
    const [fileStats, cacheStats] = await Promise.all([
      this.authPersistence.getFileStats(),
      Promise.resolve(this.aiClientFactory.getCacheStats())
    ]);

    return {
      tokens: {
        total: Object.keys(this.userTokenManager.getAllTokens()).length,
        expired: 0, // Would need to iterate to count
      },
      verifications: {
        total: Object.keys(this.nsfwVerificationManager.getAllVerifications()).length,
      },
      aiClients: cacheStats,
      files: fileStats
    };
  }

  // Convenience methods for backward compatibility
  getUserToken(userId) {
    return this.userTokenManager.getUserToken(userId);
  }

  getTokenAge(userId) {
    return this.userTokenManager.getTokenAge(userId);
  }

  async cleanupExpiredTokens() {
    const count = this.userTokenManager.cleanupExpiredTokens();
    if (count > 0) {
      await this.authPersistence.saveUserTokens(this.userTokenManager.getAllTokens());
    }
    return count;
  }
}

// Export constants that were in original auth.js
AuthManager.TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

module.exports = AuthManager;