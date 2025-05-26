/**
 * Personality Authentication Module
 * 
 * Handles authentication and verification checks for personality interactions.
 * This includes:
 * - NSFW channel requirements
 * - User authentication checks
 * - Age verification
 * - Proxy system (PluralKit) authentication
 * - Auto-verification in NSFW channels
 */

const logger = require('../logger');
const auth = require('../auth');
const channelUtils = require('./channelUtils');
const webhookUserTracker = require('./webhookUserTracker');

/**
 * Error messages for authentication failures
 */
const AUTH_MESSAGES = {
  NSFW_REQUIRED: '⚠️ For safety and compliance reasons, personalities can only be used in Direct Messages or channels marked as NSFW. Please either chat with me in DMs or ask a server admin to mark this channel as NSFW in the channel settings.',
  AUTH_REQUIRED: '⚠️ **Authentication Required**\n\nTo use AI personalities, you need to authenticate first.\n\nPlease run `!tz auth start` to begin setting up your account.',
  PLURALKIT_AUTH_REQUIRED: '⚠️ **Authentication Required for PluralKit Users**\n\nTo use AI personalities through PluralKit, the original Discord user must authenticate first.\n\nPlease send `!tz auth start` directly (not through PluralKit) to begin setting up your account.',
  VERIFICATION_REQUIRED: '⚠️ **Age Verification Required**\n\nTo use AI personalities, you need to verify your age first.\n\nPlease run `!tz verify` in a channel marked as NSFW. This will verify that you meet Discord\'s age requirements for accessing NSFW content.'
};

/**
 * Check NSFW channel requirements
 * @param {Object} channel - Discord channel object
 * @returns {Object} Result with isAllowed and errorMessage
 */
function checkNSFWRequirements(channel) {
  const isDM = channel.isDMBased();
  const isNSFW = channelUtils.isChannelNSFW(channel);
  
  if (!isDM && !isNSFW) {
    return {
      isAllowed: false,
      errorMessage: AUTH_MESSAGES.NSFW_REQUIRED,
      reason: 'not_nsfw_channel'
    };
  }
  
  return {
    isAllowed: true,
    isDM,
    isNSFW
  };
}

/**
 * Check proxy system authentication (PluralKit)
 * @param {Object} message - Discord message object
 * @returns {Object} Authentication result with userId and isAuthenticated
 */
function checkProxySystemAuth(message) {
  if (!webhookUserTracker.isProxySystemWebhook(message)) {
    return {
      isProxySystem: false,
      isAuthenticated: true,
      userId: message.author.id,
      username: message.author.username
    };
  }
  
  // For PluralKit messages, check the real user's authentication
  const proxyAuth = webhookUserTracker.checkProxySystemAuthentication(message);
  
  if (!proxyAuth.isAuthenticated) {
    logger.info('[PersonalityAuth] PluralKit user attempted to use personalities without authentication');
    return {
      isProxySystem: true,
      isAuthenticated: false,
      errorMessage: AUTH_MESSAGES.PLURALKIT_AUTH_REQUIRED,
      reason: 'pluralkit_not_authenticated'
    };
  }
  
  logger.info(`[PersonalityAuth] PluralKit message authenticated for user ${proxyAuth.userId}`);
  return {
    isProxySystem: true,
    isAuthenticated: true,
    userId: proxyAuth.userId,
    username: proxyAuth.username || message.author.username
  };
}

/**
 * Check regular user authentication
 * @param {string} userId - User ID to check
 * @param {boolean} isDM - Whether this is a DM channel
 * @returns {Object} Authentication result
 */
function checkUserAuth(userId, isDM) {
  if (!auth.hasValidToken(userId)) {
    logger.info(
      `[PersonalityAuth] User ${userId} attempted to use personalities without authentication in ${isDM ? 'DM' : 'server channel'}`
    );
    return {
      isAuthenticated: false,
      errorMessage: AUTH_MESSAGES.AUTH_REQUIRED,
      reason: 'not_authenticated'
    };
  }
  
  return {
    isAuthenticated: true
  };
}

/**
 * Check and handle age verification
 * @param {string} userId - User ID to check
 * @param {boolean} isNSFW - Whether the channel is NSFW
 * @param {boolean} isDM - Whether this is a DM channel
 * @returns {Promise<Object>} Verification result
 */
async function checkAgeVerification(userId, isNSFW, isDM) {
  let isVerified = auth.isNsfwVerified(userId);
  
  // Auto-verify users in NSFW channels (but not in DMs)
  if (!isVerified && isNSFW && !isDM) {
    logger.info(`[PersonalityAuth] Auto-verifying user ${userId} in NSFW channel`);
    
    const verificationSuccess = await auth.storeNsfwVerification(userId, true);
    if (verificationSuccess) {
      logger.info(`[PersonalityAuth] Successfully auto-verified user ${userId} in NSFW channel`);
      isVerified = true;
    } else {
      logger.error(`[PersonalityAuth] Failed to auto-verify user ${userId} in NSFW channel`);
    }
  }
  
  if (!isVerified) {
    logger.info(
      `[PersonalityAuth] User ${userId} attempted to use personalities without verification in ${isDM ? 'DM' : 'server channel'}`
    );
    return {
      isVerified: false,
      errorMessage: AUTH_MESSAGES.VERIFICATION_REQUIRED,
      reason: 'not_verified'
    };
  }
  
  return {
    isVerified: true
  };
}

/**
 * Perform complete authentication check for personality interaction
 * @param {Object} message - Discord message object
 * @returns {Promise<Object>} Complete authentication result
 */
async function checkPersonalityAuth(message) {
  // Step 1: Check NSFW requirements
  const nsfwCheck = checkNSFWRequirements(message.channel);
  if (!nsfwCheck.isAllowed) {
    return {
      isAllowed: false,
      errorMessage: nsfwCheck.errorMessage,
      reason: nsfwCheck.reason,
      shouldReply: true
    };
  }
  
  // Step 2: Check proxy system authentication
  const proxyCheck = checkProxySystemAuth(message);
  if (!proxyCheck.isAuthenticated) {
    return {
      isAllowed: false,
      errorMessage: proxyCheck.errorMessage,
      reason: proxyCheck.reason,
      shouldReply: true
    };
  }
  
  // Step 3: Check regular authentication (for non-proxy messages)
  if (!proxyCheck.isProxySystem) {
    const authCheck = checkUserAuth(message.author.id, nsfwCheck.isDM);
    if (!authCheck.isAuthenticated) {
      return {
        isAllowed: false,
        errorMessage: authCheck.errorMessage,
        reason: authCheck.reason,
        shouldReply: true
      };
    }
  }
  
  // Step 4: Check age verification
  const verifyCheck = await checkAgeVerification(
    proxyCheck.userId,
    nsfwCheck.isNSFW,
    nsfwCheck.isDM
  );
  
  if (!verifyCheck.isVerified) {
    return {
      isAllowed: false,
      errorMessage: verifyCheck.errorMessage,
      reason: verifyCheck.reason,
      shouldReply: true
    };
  }
  
  // All checks passed
  return {
    isAllowed: true,
    authUserId: proxyCheck.userId,
    authUsername: proxyCheck.username,
    isProxySystem: proxyCheck.isProxySystem,
    isDM: nsfwCheck.isDM,
    isNSFW: nsfwCheck.isNSFW
  };
}

/**
 * Send authentication error message to user
 * @param {Object} message - Discord message object
 * @param {string} errorMessage - Error message to send
 * @param {string} errorType - Type of error for logging
 */
async function sendAuthError(message, errorMessage, errorType) {
  try {
    await message.reply({
      content: errorMessage,
      ephemeral: true // Make the message only visible to the user when possible
    });
  } catch (error) {
    logger.error(`[PersonalityAuth] Failed to send ${errorType} notice: ${error.message}`);
  }
}

module.exports = {
  checkNSFWRequirements,
  checkProxySystemAuth,
  checkUserAuth,
  checkAgeVerification,
  checkPersonalityAuth,
  sendAuthError,
  AUTH_MESSAGES
};