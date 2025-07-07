/**
 * Authentication service for user-specific API access
 * 
 * This module provides a singleton instance of AuthManager for the application.
 */

const AuthManager = require('./core/authentication');
const logger = require('./logger');
const { botConfig } = require('../config');
const { getDataDirectory } = require('./dataStorage');

// Singleton instance
let authManager = null;

/**
 * Get or create the auth manager instance
 * @returns {AuthManager} The auth manager instance
 */
function getAuthManager() {
  if (!authManager) {
    authManager = new AuthManager({
      appId: process.env.SERVICE_APP_ID,
      apiKey: process.env.SERVICE_API_KEY,
      authWebsite: process.env.SERVICE_WEBSITE,
      authApiEndpoint: `${process.env.SERVICE_API_BASE_URL}/auth`,
      serviceApiBaseUrl: `${process.env.SERVICE_API_BASE_URL}/v1`,
      ownerId: process.env.BOT_OWNER_ID,
      isDevelopment: botConfig.isDevelopment,
      dataDir: getDataDirectory(),
    });
  }
  return authManager;
}

/**
 * Initialize the auth system
 * @returns {Promise<void>}
 */
async function initAuth() {
  const manager = getAuthManager();
  try {
    await manager.initialize();
    logger.info('[Auth] Authentication system initialized successfully');
  } catch (error) {
    logger.error('[Auth] Failed to initialize auth system:', error);
    throw error;
  }
}

/**
 * Shutdown the auth system
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (authManager) {
    await authManager.shutdown();
    authManager = null;
  }
}

// Export a clean interface
module.exports = {
  // Core functions
  initAuth,
  shutdown,
  getAuthManager,
  
  // Delegated methods for convenience
  getAuthorizationUrl: () => getAuthManager().getAuthorizationUrl(),
  exchangeCodeForToken: (code) => getAuthManager().userTokenManager.exchangeCodeForToken(code),
  getUserToken: (userId) => getAuthManager().getUserToken(userId),
  hasValidToken: (userId) => getAuthManager().hasValidToken(userId),
  storeUserToken: (userId, token) => getAuthManager().storeUserToken(userId, token),
  deleteUserToken: (userId) => getAuthManager().deleteUserToken(userId),
  storeNsfwVerification: (userId, isVerified) => getAuthManager().storeNsfwVerification(userId, isVerified),
  isNsfwVerified: (userId) => getAuthManager().isNsfwVerified(userId),
  cleanupExpiredTokens: () => getAuthManager().cleanupExpiredTokens(),
  getTokenAge: (userId) => getAuthManager().getTokenAge(userId),
  getTokenExpirationInfo: (userId) => getAuthManager().getTokenExpirationInfo(userId),
  
  // Constants
  TOKEN_EXPIRATION_MS: AuthManager.TOKEN_EXPIRATION_MS,
  get APP_ID() { return process.env.SERVICE_APP_ID; },
  get API_KEY() { return process.env.SERVICE_API_KEY; },
};