/**
 * NsfwVerificationManager - Manages NSFW content verification
 *
 * Handles:
 * - Age verification for NSFW content
 * - Auto-verification in NSFW channels
 * - Proxy system support (PluralKit)
 * - Verification status tracking
 */

const logger = require('../../logger');
const webhookUserTracker = require('../../utils/webhookUserTracker');
const { botPrefix } = require('../../../config');

class NsfwVerificationManager {
  constructor() {
    this.nsfwVerified = {};
  }

  /**
   * Store NSFW verification status for a user
   * @param {string} userId - The Discord user ID
   * @param {boolean} isVerified - Whether the user is verified for NSFW content
   * @returns {boolean} Whether the status was stored successfully
   */
  storeNsfwVerification(userId, isVerified) {
    this.nsfwVerified[userId] = {
      verified: isVerified,
      timestamp: Date.now(),
      verifiedAt: isVerified ? Date.now() : null,
    };
    logger.info(
      `[NsfwVerificationManager] Stored NSFW verification status for user ${userId}: ${isVerified}`
    );
    return true;
  }

  /**
   * Check if a user is verified for NSFW content
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether the user is verified for NSFW content
   */
  isNsfwVerified(userId) {
    return this.nsfwVerified[userId]?.verified === true;
  }

  /**
   * Check if a channel requires NSFW verification
   * @param {Object} channel - The Discord channel object
   * @returns {boolean} Whether the channel requires NSFW verification
   */
  requiresNsfwVerification(channel) {
    // DMs never require NSFW verification
    if (!channel.guild) {
      return false;
    }

    // Check if channel is age-restricted (NSFW)
    return channel.nsfw === true;
  }

  /**
   * Check if a user should be auto-verified based on channel context
   * @param {Object} channel - The Discord channel object
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether the user should be auto-verified
   */
  shouldAutoVerify(channel, userId) {
    // Auto-verify in NSFW channels
    if (this.requiresNsfwVerification(channel)) {
      logger.info(
        `[NsfwVerificationManager] Auto-verifying user ${userId} in NSFW channel ${channel.id}`
      );
      return true;
    }
    return false;
  }

  /**
   * Check if user is using a proxy system
   * @param {Object} message - The Discord message object
   * @returns {Object} Proxy check result with isProxy and userId
   */
  checkProxySystem(message) {
    // Detect PluralKit proxy (webhook with [APP] suffix and pk; prefix)
    const isPKWebhook =
      message.author.bot &&
      message.author.username.endsWith('[APP]') &&
      message.author.username.startsWith('pk;');

    if (isPKWebhook && message.author.discriminator === '0000') {
      logger.debug(`[NsfwVerificationManager] Detected PluralKit proxy message`);
      return {
        isProxy: true,
        systemType: 'pluralkit',
        // For PluralKit, we can't determine the actual user from the webhook alone
        // The auth system should handle this case appropriately
        userId: null,
      };
    }

    return {
      isProxy: false,
      systemType: null,
      userId: message.author.id,
    };
  }

  /**
   * Perform comprehensive NSFW verification check
   * @param {Object} channel - The Discord channel object
   * @param {string} userId - The Discord user ID
   * @param {Object} message - The Discord message object (optional, for proxy detection)
   * @returns {Object} Verification result with isAllowed and reason
   */
  verifyAccess(channel, userId, message = null) {
    // Check for proxy system if message is provided
    let effectiveUserId = userId;
    let isProxy = false;
    let proxySystemType = null;

    if (message) {
      const proxyCheck = this.checkProxySystem(message);
      if (proxyCheck.isProxy) {
        isProxy = true;
        proxySystemType = proxyCheck.systemType;

        // Try to find the real user behind the proxy
        const realUserId = webhookUserTracker.findRealUserId(message);
        if (realUserId && realUserId !== 'proxy-system-user') {
          effectiveUserId = realUserId;
          logger.info(
            `[NsfwVerificationManager] Found real user ${realUserId} behind ${proxySystemType} proxy`
          );
        } else {
          logger.warn(
            `[NsfwVerificationManager] Could not determine real user for ${proxySystemType} proxy`
          );
          // If we can't determine the real user, we can't verify them
          return {
            isAllowed: false,
            reason:
              'Cannot verify proxy system user. The original user must use the bot directly for verification.',
            isProxy: true,
            systemType: proxySystemType,
          };
        }
      }
    }

    // Check if the effective user is NSFW verified
    const isUserVerified = this.isNsfwVerified(effectiveUserId);

    // If user is verified, they can use personalities in NSFW channels or DMs
    if (isUserVerified) {
      // DMs are allowed for verified users
      if (!channel.guild) {
        return {
          isAllowed: true,
          reason: isProxy
            ? `Proxy user ${effectiveUserId} is verified and can use DMs`
            : 'User is verified and can use DMs',
          isProxy,
          systemType: proxySystemType,
        };
      }
      
      // For guild channels, only NSFW channels are allowed
      if (channel.nsfw === true) {
        return {
          isAllowed: true,
          reason: isProxy
            ? `Proxy user ${effectiveUserId} is verified and channel is NSFW`
            : 'User is verified and channel is NSFW',
          isProxy,
          systemType: proxySystemType,
        };
      } else {
        // User is verified but channel is SFW - NOT ALLOWED
        return {
          isAllowed: false,
          reason: 'NSFW-verified users can only use personalities in NSFW channels or DMs',
          isProxy,
          systemType: proxySystemType,
        };
      }
    }

    // User is NOT verified
    // For guild channels with NSFW enabled, auto-verify them
    if (channel.guild && channel.nsfw === true) {
      // Auto-verify the user since they're already in an NSFW channel
      // This applies to both direct users and proxy users
      if (isProxy) {
        logger.info(`[NsfwVerificationManager] Auto-verifying proxy user ${effectiveUserId} in NSFW channel ${channel.id}`);
      } else {
        logger.info(`[NsfwVerificationManager] Auto-verifying user ${effectiveUserId} in NSFW channel ${channel.id}`);
      }
      this.storeNsfwVerification(effectiveUserId, true);
      
      return {
        isAllowed: true,
        reason: isProxy 
          ? `Proxy user ${effectiveUserId} auto-verified in NSFW channel`
          : 'User auto-verified in NSFW channel',
        autoVerified: true,
        isProxy,
        systemType: proxySystemType,
      };
    }

    // User is not verified and cannot be auto-verified - block access
    return {
      isAllowed: false,
      reason: `<@${effectiveUserId}> has not completed NSFW verification. Please use \`${botPrefix} verify\` to confirm you are 18 or older.`,
      isProxy,
      systemType: proxySystemType,
      userId: effectiveUserId,
    };
  }

  /**
   * Get all verifications (for persistence)
   * @returns {Object} The verifications object
   */
  getAllVerifications() {
    return this.nsfwVerified;
  }

  /**
   * Set all verifications (for loading from persistence)
   * @param {Object} verifications - The verifications object
   */
  setAllVerifications(verifications) {
    this.nsfwVerified = verifications || {};
  }

  /**
   * Get verification info for a user
   * @param {string} userId - The Discord user ID
   * @returns {Object|null} Verification info or null if not verified
   */
  getVerificationInfo(userId) {
    return this.nsfwVerified[userId] || null;
  }

  /**
   * Clear verification for a user
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether the verification was cleared
   */
  clearVerification(userId) {
    if (this.nsfwVerified[userId]) {
      delete this.nsfwVerified[userId];
      logger.info(`[NsfwVerificationManager] Cleared NSFW verification for user ${userId}`);
      return true;
    }
    return false;
  }
}

module.exports = NsfwVerificationManager;
