/**
 * Authentication handler for user-specific API access
 *
 * This module implements the OAuth flow for user-specific API access.
 * It handles:
 * - Generating auth URLs for users
 * - Exchanging auth codes for tokens
 * - Storing and retrieving tokens
 * - Handling token refresh
 */

const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const logger = require('./logger');

// App configuration
const APP_ID = process.env.SERVICE_APP_ID;
const API_KEY = process.env.SERVICE_API_KEY;

// Auth API endpoints - make generic so it works with any provider
const AUTH_WEBSITE = process.env.SERVICE_WEBSITE;
const AUTH_API_ENDPOINT = `${process.env.SERVICE_API_BASE_URL}/auth`;

// Storage configuration
const DATA_DIR = path.join(process.cwd(), 'data');
const AUTH_TOKENS_FILE = path.join(DATA_DIR, 'auth_tokens.json');
const NSFW_VERIFIED_FILE = path.join(DATA_DIR, 'nsfw_verified.json');

// In-memory cache of user tokens and verification status
let userTokens = {};

// In-memory cache of NSFW verification status
let nsfwVerified = {};

// Token expiration time in milliseconds (default: 30 days)
const TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Generate the authorization URL for a user
 *
 * @returns {string} The URL the user should visit to authorize the application
 */
function getAuthorizationUrl() {
  return `${AUTH_WEBSITE}/authorize?app_id=${APP_ID}`;
}

/**
 * Exchange an authorization code for an auth token
 *
 * @param {string} code - The authorization code provided by the user
 * @returns {Promise<string|null>} The auth token, or null if exchange failed
 */
async function exchangeCodeForToken(code) {
  try {
    // Following reference implementation for nonce endpoint
    const response = await fetch(`${AUTH_API_ENDPOINT}/nonce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: APP_ID,
        code: code,
      }),
    });

    if (!response.ok) {
      logger.error(
        `[Auth] Failed to exchange code for token: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();
    logger.info(`[Auth] Successfully exchanged code for token`);
    return data.auth_token;
  } catch (error) {
    logger.error(`[Auth] Error exchanging code for token:`, error);
    return null;
  }
}

/**
 * Store an auth token for a user
 *
 * @param {string} userId - The Discord user ID
 * @param {string} token - The auth token
 * @returns {Promise<boolean>} Whether the token was stored successfully
 */
async function storeUserToken(userId, token) {
  try {
    // Ensure the data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Load existing tokens
    await loadUserTokens();

    // Add the new token
    userTokens[userId] = {
      token: token,
      createdAt: Date.now(),
      expiresAt: Date.now() + TOKEN_EXPIRATION_MS,
    };

    // Save all tokens
    await fs.writeFile(AUTH_TOKENS_FILE, JSON.stringify(userTokens, null, 2));
    logger.info(`[Auth] Stored token for user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`[Auth] Error storing token for user ${userId}:`, error);
    return false;
  }
}

/**
 * Load all user tokens from storage
 *
 * @returns {Promise<void>}
 */
async function loadUserTokens() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      const data = await fs.readFile(AUTH_TOKENS_FILE, 'utf8');
      userTokens = JSON.parse(data);
      logger.info(`[Auth] Loaded ${Object.keys(userTokens).length} user tokens`);

      // Update tokens with missing expiration dates
      let needsUpdate = false;
      Object.keys(userTokens).forEach(userId => {
        const tokenData = userTokens[userId];
        if (tokenData.createdAt && !tokenData.expiresAt) {
          tokenData.expiresAt = tokenData.createdAt + TOKEN_EXPIRATION_MS;
          needsUpdate = true;
        }
      });

      if (needsUpdate) {
        await fs.writeFile(AUTH_TOKENS_FILE, JSON.stringify(userTokens, null, 2));
        logger.info(`[Auth] Updated token expiration dates for existing tokens`);
      }

      // Clean up expired tokens on load
      await cleanupExpiredTokens();
    } catch (readError) {
      if (readError.code === 'ENOENT') {
        // File doesn't exist yet, start with empty object
        userTokens = {};
        logger.info(`[Auth] No tokens file found, starting with empty token store`);
      } else {
        // Some other error occurred
        logger.error(`[Auth] Error reading tokens file:`, readError);
        throw readError;
      }
    }
  } catch (error) {
    logger.error(`[Auth] Error loading user tokens:`, error);
    userTokens = {};
  }
}

/**
 * Get the auth token for a user
 *
 * @param {string} userId - The Discord user ID
 * @returns {string|null} The auth token, or null if the user has no token
 */
function getUserToken(userId) {
  if (!userTokens[userId]) {
    return null;
  }

  return userTokens[userId].token;
}

/**
 * Check if a user has a valid auth token
 *
 * @param {string} userId - The Discord user ID
 * @returns {boolean} Whether the user has a valid token
 */
function hasValidToken(userId) {
  const tokenData = userTokens[userId];

  if (!tokenData) {
    return false;
  }

  // Check if token is expired
  if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
    logger.info(`[Auth] Token for user ${userId} has expired`);
    return false;
  }

  return !!tokenData.token;
}

/**
 * Delete a user's auth token
 *
 * @param {string} userId - The Discord user ID
 * @returns {Promise<boolean>} Whether the token was deleted successfully
 */
async function deleteUserToken(userId) {
  try {
    if (!userTokens[userId]) {
      return true; // No token to delete
    }

    delete userTokens[userId];
    await fs.writeFile(AUTH_TOKENS_FILE, JSON.stringify(userTokens, null, 2));
    logger.info(`[Auth] Deleted token for user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`[Auth] Error deleting token for user ${userId}:`, error);
    return false;
  }
}

/**
 * Store NSFW verification status for a user
 *
 * @param {string} userId - The Discord user ID
 * @param {boolean} isVerified - Whether the user is verified for NSFW content
 * @returns {Promise<boolean>} Whether the status was stored successfully
 */
async function storeNsfwVerification(userId, isVerified) {
  try {
    // Ensure the data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Load existing verification data
    await loadNsfwVerifications();

    // Add the new verification status
    nsfwVerified[userId] = {
      verified: isVerified,
      timestamp: Date.now(),
      verifiedAt: isVerified ? Date.now() : null,
    };

    // Save all verification data
    await fs.writeFile(NSFW_VERIFIED_FILE, JSON.stringify(nsfwVerified, null, 2));
    logger.info(`[Auth] Stored NSFW verification status for user ${userId}: ${isVerified}`);
    return true;
  } catch (error) {
    logger.error(`[Auth] Error storing NSFW verification for user ${userId}:`, error);
    return false;
  }
}

/**
 * Load all NSFW verification data from storage
 *
 * @returns {Promise<void>}
 */
async function loadNsfwVerifications() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      const data = await fs.readFile(NSFW_VERIFIED_FILE, 'utf8');
      nsfwVerified = JSON.parse(data);
      logger.info(`[Auth] Loaded ${Object.keys(nsfwVerified).length} NSFW verification records`);
    } catch (readError) {
      if (readError.code === 'ENOENT') {
        // File doesn't exist yet, start with empty object
        nsfwVerified = {};
        logger.info(`[Auth] No NSFW verification file found, starting with empty store`);
      } else {
        // Some other error occurred
        logger.error(`[Auth] Error reading NSFW verification file:`, readError);
        throw readError;
      }
    }
  } catch (error) {
    logger.error(`[Auth] Error loading NSFW verifications:`, error);
    nsfwVerified = {};
  }
}

/**
 * Check if a user is verified for NSFW content
 *
 * @param {string} userId - The Discord user ID
 * @returns {boolean} Whether the user is verified for NSFW content
 */
function isNsfwVerified(userId) {
  return nsfwVerified[userId]?.verified === true;
}

/**
 * Initialize the auth system
 *
 * @returns {Promise<void>}
 */
/**
 * Clean up expired tokens
 *
 * @returns {Promise<number>} The number of tokens removed
 */
async function cleanupExpiredTokens() {
  try {
    const now = Date.now();
    const expiredUserIds = Object.keys(userTokens).filter(userId => {
      const tokenData = userTokens[userId];
      return tokenData.expiresAt && now > tokenData.expiresAt;
    });

    if (expiredUserIds.length === 0) {
      logger.debug(`[Auth] No expired tokens found during cleanup`);
      return 0;
    }

    // Remove expired tokens
    expiredUserIds.forEach(userId => {
      delete userTokens[userId];
    });

    // Save the updated tokens
    await fs.writeFile(AUTH_TOKENS_FILE, JSON.stringify(userTokens, null, 2));
    logger.info(`[Auth] Cleaned up ${expiredUserIds.length} expired tokens`);

    return expiredUserIds.length;
  } catch (error) {
    logger.error(`[Auth] Error cleaning up expired tokens:`, error);
    return 0;
  }
}

/**
 * Get token age in days
 *
 * @param {string} userId - The Discord user ID
 * @returns {number|null} Token age in days or null if no token exists
 */
function getTokenAge(userId) {
  const tokenData = userTokens[userId];
  if (!tokenData || !tokenData.createdAt) {
    return null;
  }

  const ageMs = Date.now() - tokenData.createdAt;
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}

/**
 * Get token expiration info
 *
 * @param {string} userId - The Discord user ID
 * @returns {Object|null} Object with daysUntilExpiration and percentRemaining or null if no token
 */
function getTokenExpirationInfo(userId) {
  const tokenData = userTokens[userId];
  if (!tokenData || !tokenData.expiresAt) {
    return null;
  }

  const timeLeftMs = tokenData.expiresAt - Date.now();
  const daysLeft = Math.max(0, Math.floor(timeLeftMs / (24 * 60 * 60 * 1000)));
  const totalLifespanMs = TOKEN_EXPIRATION_MS;
  const percentRemaining = Math.max(0, Math.floor((timeLeftMs / totalLifespanMs) * 100));

  return {
    daysUntilExpiration: daysLeft,
    percentRemaining: percentRemaining,
  };
}

async function initAuth() {
  logger.info(`[Auth] Initializing auth system with app ID: ${APP_ID}`);
  await loadUserTokens();
  await loadNsfwVerifications();

  // Schedule periodic cleanup of expired tokens (every 24 hours)
  setInterval(
    async () => {
      const removedCount = await cleanupExpiredTokens();
      if (removedCount > 0) {
        logger.info(`[Auth] Scheduled cleanup removed ${removedCount} expired tokens`);
      }
    },
    24 * 60 * 60 * 1000
  );
}

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
  // Export userTokens and nsfwVerified for testing purposes
  get userTokens() {
    return userTokens;
  },
  set userTokens(value) {
    userTokens = value;
  },
  get nsfwVerified() {
    return nsfwVerified;
  },
  set nsfwVerified(value) {
    nsfwVerified = value;
  },
};
