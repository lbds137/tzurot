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
    logger.info(`[NsfwVerificationManager] Stored NSFW verification status for user ${userId}: ${isVerified}`);
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
      logger.info(`[NsfwVerificationManager] Auto-verifying user ${userId} in NSFW channel ${channel.id}`);
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
    const isPKWebhook = message.author.bot && 
                       message.author.username.endsWith('[APP]') && 
                       message.author.username.startsWith('pk;');
    
    if (isPKWebhook && message.author.discriminator === '0000') {
      logger.debug(`[NsfwVerificationManager] Detected PluralKit proxy message`);
      return {
        isProxy: true,
        systemType: 'pluralkit',
        // For PluralKit, we can't determine the actual user from the webhook alone
        // The auth system should handle this case appropriately
        userId: null
      };
    }

    return {
      isProxy: false,
      systemType: null,
      userId: message.author.id
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
    // Check if NSFW verification is required for this channel
    if (!this.requiresNsfwVerification(channel)) {
      return {
        isAllowed: true,
        reason: 'Channel does not require NSFW verification'
      };
    }

    // Check for proxy system if message is provided
    if (message) {
      const proxyCheck = this.checkProxySystem(message);
      if (proxyCheck.isProxy) {
        // For proxy systems, we may need special handling
        logger.warn(`[NsfwVerificationManager] Proxy system detected, additional verification may be needed`);
        return {
          isAllowed: true,
          reason: 'Proxy system detected - verification delegated to proxy handler',
          isProxy: true,
          systemType: proxyCheck.systemType
        };
      }
    }

    // Check if user should be auto-verified
    if (this.shouldAutoVerify(channel, userId)) {
      this.storeNsfwVerification(userId, true);
      return {
        isAllowed: true,
        reason: 'User auto-verified in NSFW channel',
        autoVerified: true
      };
    }

    // Check existing verification status
    if (this.isNsfwVerified(userId)) {
      return {
        isAllowed: true,
        reason: 'User has existing NSFW verification'
      };
    }

    // User is not verified
    return {
      isAllowed: false,
      reason: 'User has not completed NSFW verification'
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