/**
 * UserTokenManager - Manages user authentication tokens
 *
 * Handles:
 * - Token generation and exchange
 * - Token storage and retrieval
 * - Token expiration and cleanup
 * - Token validation
 */

const logger = require('../../logger');

// Token expiration time in milliseconds (default: 30 days)
const TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

class UserTokenManager {
  constructor(appId, apiKey, authApiEndpoint, authWebsite) {
    this.appId = appId;
    this.apiKey = apiKey;
    this.authApiEndpoint = authApiEndpoint;
    this.authWebsite = authWebsite;
    this.userTokens = {};
    this.tokenExpirationMs = TOKEN_EXPIRATION_MS;
  }

  /**
   * Generate the authorization URL for a user
   * @returns {string} The URL the user should visit to authorize the application
   */
  getAuthorizationUrl() {
    return `${this.authWebsite}/authorize?app_id=${this.appId}`;
  }

  /**
   * Exchange an authorization code for an auth token
   * @param {string} code - The authorization code provided by the user
   * @returns {Promise<string|null>} The auth token, or null if exchange failed
   */
  async exchangeCodeForToken(code) {
    try {
      const fetch = require('node-fetch');
      // Following reference implementation for nonce endpoint
      const response = await fetch(`${this.authApiEndpoint}/nonce`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: this.appId,
          code: code,
        }),
      });

      if (!response.ok) {
        logger.error(
          `[UserTokenManager] Failed to exchange code for token: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const data = await response.json();
      logger.info(`[UserTokenManager] Successfully exchanged code for token`);
      return data.auth_token;
    } catch (error) {
      logger.error(`[UserTokenManager] Error exchanging code for token:`, error);
      return null;
    }
  }

  /**
   * Store an auth token for a user
   * @param {string} userId - The Discord user ID
   * @param {string} token - The auth token
   * @returns {boolean} Whether the token was stored successfully
   */
  storeUserToken(userId, token) {
    this.userTokens[userId] = {
      token: token,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.tokenExpirationMs,
    };
    logger.debug(`[UserTokenManager] Stored token for user ${userId}`);
    return true;
  }

  /**
   * Get the auth token for a user
   * @param {string} userId - The Discord user ID
   * @returns {string|null} The auth token, or null if the user has no token
   */
  getUserToken(userId) {
    if (!this.userTokens[userId]) {
      return null;
    }
    return this.userTokens[userId].token;
  }

  /**
   * Check if a user has a valid auth token
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether the user has a valid token
   */
  hasValidToken(userId) {
    const tokenData = this.userTokens[userId];

    if (!tokenData) {
      return false;
    }

    // Check if token is expired
    if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
      logger.debug(`[UserTokenManager] Token for user ${userId} has expired`);
      return false;
    }

    return !!tokenData.token;
  }

  /**
   * Delete a user's auth token
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether the token was deleted successfully
   */
  deleteUserToken(userId) {
    if (!this.userTokens[userId]) {
      return true; // No token to delete
    }

    delete this.userTokens[userId];
    logger.debug(`[UserTokenManager] Deleted token for user ${userId}`);
    return true;
  }

  /**
   * Get token age in days
   * @param {string} userId - The Discord user ID
   * @returns {number|null} Token age in days or null if no token exists
   */
  getTokenAge(userId) {
    const tokenData = this.userTokens[userId];
    if (!tokenData || !tokenData.createdAt) {
      return null;
    }

    const ageMs = Date.now() - tokenData.createdAt;
    return Math.floor(ageMs / (24 * 60 * 60 * 1000));
  }

  /**
   * Get token expiration info
   * @param {string} userId - The Discord user ID
   * @returns {Object|null} Object with daysUntilExpiration and percentRemaining or null if no token
   */
  getTokenExpirationInfo(userId) {
    const tokenData = this.userTokens[userId];
    if (!tokenData || !tokenData.expiresAt) {
      return null;
    }

    const timeLeftMs = tokenData.expiresAt - Date.now();
    const daysLeft = Math.max(0, Math.floor(timeLeftMs / (24 * 60 * 60 * 1000)));
    const totalLifespanMs = this.tokenExpirationMs;
    const percentRemaining = Math.max(0, Math.floor((timeLeftMs / totalLifespanMs) * 100));

    return {
      daysUntilExpiration: daysLeft,
      percentRemaining: percentRemaining,
    };
  }

  /**
   * Clean up expired tokens
   * @returns {number} The number of tokens removed
   */
  cleanupExpiredTokens() {
    const now = Date.now();
    const expiredUserIds = Object.keys(this.userTokens).filter(userId => {
      const tokenData = this.userTokens[userId];
      return tokenData.expiresAt && now > tokenData.expiresAt;
    });

    if (expiredUserIds.length === 0) {
      logger.debug(`[UserTokenManager] No expired tokens found during cleanup`);
      return 0;
    }

    // Remove expired tokens
    expiredUserIds.forEach(userId => {
      delete this.userTokens[userId];
    });

    logger.info(`[UserTokenManager] Cleaned up ${expiredUserIds.length} expired tokens`);
    return expiredUserIds.length;
  }

  /**
   * Get all tokens (for persistence)
   * @returns {Object} The tokens object
   */
  getAllTokens() {
    return this.userTokens;
  }

  /**
   * Set all tokens (for loading from persistence)
   * @param {Object} tokens - The tokens object
   */
  setAllTokens(tokens) {
    this.userTokens = tokens || {};

    // Update tokens with missing expiration dates
    let updatedCount = 0;
    Object.keys(this.userTokens).forEach(userId => {
      const tokenData = this.userTokens[userId];
      if (tokenData.createdAt && !tokenData.expiresAt) {
        tokenData.expiresAt = tokenData.createdAt + this.tokenExpirationMs;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      logger.info(`[UserTokenManager] Updated ${updatedCount} tokens with expiration dates`);
    }
  }
}

module.exports = UserTokenManager;
