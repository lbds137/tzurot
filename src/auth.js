/**
 * Authentication handler for user-specific API access
 *
 * This file now serves as a backward-compatible wrapper around the new
 * modular authentication system in core/authentication/
 */

const AuthManager = require('./core/authentication');
const logger = require('./logger');

// Create singleton instance
let authManager = null;
let initPromise = null;

// Export configuration from environment
const APP_ID = process.env.SERVICE_APP_ID;
const API_KEY = process.env.SERVICE_API_KEY;
const TOKEN_EXPIRATION_MS = AuthManager.TOKEN_EXPIRATION_MS;

// In-memory caches for backward compatibility
let userTokensCache = {};
let nsfwVerifiedCache = {};

// Auto-initialize for backward compatibility
if (process.env.NODE_ENV === 'test') {
  // In test environment, we work with in-memory caches only
  userTokensCache = {};
  nsfwVerifiedCache = {};
}

/**
 * Initialize the auth system
 * @returns {Promise<void>}
 */
async function initAuth() {
  if (!authManager) {
    authManager = new AuthManager({
      appId: APP_ID,
      apiKey: API_KEY,
      authWebsite: process.env.SERVICE_WEBSITE,
      authApiEndpoint: `${process.env.SERVICE_API_BASE_URL}/auth`,
      serviceApiBaseUrl: process.env.SERVICE_API_BASE_URL,
      ownerId: process.env.OWNER_ID
    });
  }
  
  await authManager.initialize();
}

/**
 * Generate the authorization URL for a user
 * @returns {string} The URL the user should visit to authorize the application
 */
function getAuthorizationUrl() {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return authManager.getAuthorizationUrl();
}

/**
 * Exchange an authorization code for an auth token
 * @param {string} code - The authorization code provided by the user
 * @returns {Promise<string|null>} The auth token, or null if exchange failed
 */
async function exchangeCodeForToken(code) {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  
  // For backward compatibility, we return the token directly
  // The new system handles storage internally
  const token = await authManager.userTokenManager.exchangeCodeForToken(code);
  return token;
}

/**
 * Store an auth token for a user
 * @param {string} userId - The Discord user ID
 * @param {string} token - The auth token
 * @returns {Promise<boolean>} Whether the token was stored successfully
 */
async function storeUserToken(userId, token) {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  
  authManager.userTokenManager.storeUserToken(userId, token);
  return await authManager.authPersistence.saveUserTokens(authManager.userTokenManager.getAllTokens());
}

/**
 * Load all user tokens from storage
 * @returns {Promise<void>}
 */
async function _loadUserTokens() {
  // This is now handled by initAuth()
  logger.warn('[Auth] loadUserTokens() is deprecated and handled by initAuth()');
}

/**
 * Get the auth token for a user
 * @param {string} userId - The Discord user ID
 * @returns {string|null} The auth token, or null if the user has no token
 */
function getUserToken(userId) {
  if (!authManager) {
    // For backward compatibility with tests
    return userTokensCache[userId]?.token || null;
  }
  return authManager.getUserToken(userId);
}

/**
 * Check if a user has a valid auth token
 * @param {string} userId - The Discord user ID
 * @returns {boolean} Whether the user has a valid token
 */
function hasValidToken(userId) {
  if (!authManager) {
    // For backward compatibility with tests
    const tokenData = userTokensCache[userId];
    if (!tokenData) return false;
    if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) return false;
    return !!tokenData.token;
  }
  return authManager.hasValidToken(userId);
}

/**
 * Delete a user's auth token
 * @param {string} userId - The Discord user ID
 * @returns {Promise<boolean>} Whether the token was deleted successfully
 */
async function deleteUserToken(userId) {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return await authManager.deleteUserToken(userId);
}

/**
 * Store NSFW verification status for a user
 * @param {string} userId - The Discord user ID
 * @param {boolean} isVerified - Whether the user is verified for NSFW content
 * @returns {Promise<boolean>} Whether the status was stored successfully
 */
async function storeNsfwVerification(userId, isVerified) {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return await authManager.storeNsfwVerification(userId, isVerified);
}

/**
 * Load all NSFW verification data from storage
 * @returns {Promise<void>}
 */
async function _loadNsfwVerifications() {
  // This is now handled by initAuth()
  logger.warn('[Auth] loadNsfwVerifications() is deprecated and handled by initAuth()');
}

/**
 * Check if a user is verified for NSFW content
 * @param {string} userId - The Discord user ID
 * @returns {boolean} Whether the user is verified for NSFW content
 */
function isNsfwVerified(userId) {
  if (!authManager) {
    // For backward compatibility with tests
    return nsfwVerifiedCache[userId]?.verified === true;
  }
  return authManager.isNsfwVerified(userId);
}

/**
 * Clean up expired tokens
 * @returns {Promise<number>} The number of tokens removed
 */
async function cleanupExpiredTokens() {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return await authManager.cleanupExpiredTokens();
}

/**
 * Get token age in days
 * @param {string} userId - The Discord user ID
 * @returns {number|null} Token age in days or null if no token exists
 */
function getTokenAge(userId) {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return authManager.getTokenAge(userId);
}

/**
 * Get token expiration info
 * @param {string} userId - The Discord user ID
 * @returns {Object|null} Object with daysUntilExpiration and percentRemaining or null if no token
 */
function getTokenExpirationInfo(userId) {
  if (!authManager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }
  return authManager.getTokenExpirationInfo(userId);
}

// Export for backward compatibility - these provide direct access to internal state
Object.defineProperty(module.exports, 'userTokens', {
  get() {
    if (!authManager) {
      return userTokensCache;
    }
    return authManager.userTokenManager.getAllTokens();
  },
  set(value) {
    userTokensCache = value;
    if (authManager) {
      authManager.userTokenManager.setAllTokens(value);
    }
  }
});

Object.defineProperty(module.exports, 'nsfwVerified', {
  get() {
    if (!authManager) {
      return nsfwVerifiedCache;
    }
    return authManager.nsfwVerificationManager.getAllVerifications();
  },
  set(value) {
    nsfwVerifiedCache = value;
    if (authManager) {
      authManager.nsfwVerificationManager.setAllVerifications(value);
    }
  }
});

module.exports = {
  initAuth,
  getAuthorizationUrl,
  exchangeCodeForToken,
  storeUserToken,
  getUserToken,
  hasValidToken,
  deleteUserToken,
  storeNsfwVerification,
  isNsfwVerified,
  cleanupExpiredTokens,
  getTokenAge,
  getTokenExpirationInfo,
  TOKEN_EXPIRATION_MS,
  APP_ID,
  API_KEY,
  // Provide access to the underlying auth manager for advanced usage
  getAuthManager: () => authManager
};