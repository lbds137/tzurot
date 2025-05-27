/**
 * Personality Authentication
 *
 * This file now serves as a backward-compatible wrapper around the new
 * PersonalityAuthValidator in core/authentication/
 */

const logger = require('../logger');

// Lazy-loaded dependencies
let authManager = null;
let authModule = null;

/**
 * Get the auth manager instance
 * @returns {Object} The auth manager
 */
function getAuthManager() {
  if (!authManager) {
    if (!authModule) {
      authModule = require('../auth');
    }
    authManager = authModule.getAuthManager();
  }
  return authManager;
}

// Reset function for testing
function _resetForTesting() {
  authManager = null;
  authModule = null;
}

/**
 * Check if user can interact with a personality
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality object
 * @returns {Promise<Object>} Result with isAllowed and error message if applicable
 */
async function checkPersonalityAuth(message, personality) {
  const manager = getAuthManager();
  if (!manager) {
    throw new Error('Auth system not initialized. Call initAuth() first.');
  }

  try {
    const result = await manager.validatePersonalityAccess({
      message,
      personality,
      channel: message.channel,
      userId: message.author.id
    });

    // Convert to legacy format for backward compatibility
    if (!result.isAuthorized) {
      const errorMessage = result.errors.join(' ');
      return {
        isAllowed: false,
        errorMessage: errorMessage || 'Authorization failed',
        reason: result.errors.length > 0 ? 'auth_failed' : 'unknown',
        // Also include new format for gradual migration
        isAuthorized: false,
        error: errorMessage || 'Authorization failed'
      };
    }

    // Return legacy format with all expected fields
    return {
      isAllowed: true,
      authUserId: message.author.id,
      authUsername: message.author.username || 'Unknown',
      isProxySystem: result.details?.proxySystem?.detected || false,
      isDM: message.channel?.isDMBased?.() || false,
      isNSFW: result.details?.nsfwCheck?.channelRequiresVerification || false,
      // Also include new format for gradual migration
      isAuthorized: true,
      details: result.details
    };
  } catch (error) {
    logger.error('[PersonalityAuth] Error checking personality auth:', error);
    return {
      isAllowed: false,
      errorMessage: 'An error occurred while checking authorization.',
      reason: 'error',
      // Also include new format for gradual migration
      isAuthorized: false,
      error: 'An error occurred while checking authorization.'
    };
  }
}

/**
 * Check if a personality requires authentication
 * @param {Object} personality - Personality object
 * @returns {boolean} Whether authentication is required
 */
function requiresAuth(personality) {
  const manager = getAuthManager();
  if (!manager) {
    return false;
  }
  return manager.personalityAuthValidator.requiresAuth(personality);
}

/**
 * Check if channel requires NSFW verification
 * @param {Object} channel - Discord channel object
 * @returns {boolean} Whether NSFW verification is required
 */
function requiresNsfwVerification(channel) {
  const manager = getAuthManager();
  if (!manager) {
    return false;
  }
  return manager.nsfwVerificationManager.requiresNsfwVerification(channel);
}

/**
 * Get user auth status
 * @param {string} userId - Discord user ID
 * @returns {Object} User auth status
 */
function getUserAuthStatus(userId) {
  const manager = getAuthManager();
  if (!manager) {
    return {
      userId,
      isOwner: false,
      hasValidToken: false,
      tokenExpiration: null,
      nsfwVerified: false,
      nsfwVerificationDate: null
    };
  }
  return manager.getUserAuthStatus(userId);
}

/**
 * Send authentication error message to user
 * Legacy compatibility function
 * @param {Object} message - Discord message object
 * @param {string} errorMessage - Error message to send
 * @param {string} _reason - Error reason code (unused)
 */
async function sendAuthError(message, errorMessage, _reason) {
  try {
    await message.reply({
      content: errorMessage,
      ephemeral: true
    });
  } catch (error) {
    logger.error('[PersonalityAuth] Error sending auth error message:', error);
  }
}

module.exports = {
  checkPersonalityAuth,
  requiresAuth,
  requiresNsfwVerification,
  getUserAuthStatus,
  sendAuthError, // Legacy compatibility
  _resetForTesting, // For test use only
};