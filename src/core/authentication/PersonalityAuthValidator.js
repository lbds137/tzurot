/**
 * PersonalityAuthValidator - Validates authentication for personality interactions
 *
 * Handles:
 * - Authentication requirement checks
 * - NSFW verification requirements
 * - Proxy system authentication
 * - Comprehensive auth validation
 */

const logger = require('../../logger');

class PersonalityAuthValidator {
  constructor(nsfwVerificationManager, userTokenManager, ownerId) {
    this.nsfwVerificationManager = nsfwVerificationManager;
    this.userTokenManager = userTokenManager;
    this.ownerId = ownerId;
  }

  /**
   * Check if a personality requires authentication
   * Note: Currently ALL personalities require authentication
   * @param {Object} personality - The personality object
   * @returns {boolean} Whether authentication is required (always true)
   */
  requiresAuth(personality) { // eslint-disable-line no-unused-vars
    // All personality interactions require authentication
    return true;
  }

  /**
   * Check if user is the bot owner
   * @param {string} userId - The Discord user ID
   * @returns {boolean} Whether the user is the bot owner
   */
  isOwner(userId) {
    return userId === this.ownerId;
  }

  /**
   * Perform comprehensive authentication check
   * @param {Object} options - Authentication options
   * @param {Object} options.message - The Discord message object
   * @param {Object} options.personality - The personality being accessed
   * @param {Object} options.channel - The Discord channel object
   * @param {string} options.userId - The Discord user ID (optional, derived from message if not provided)
   * @returns {Object} Authentication result with isAuthorized and details
   */
  async validateAccess({ message, personality, channel, userId = null }) {
    const result = {
      isAuthorized: false,
      requiresAuth: false,
      requiresNsfwVerification: false,
      errors: [],
      warnings: [],
      details: {}
    };

    // Determine user ID
    const effectiveUserId = userId || message?.author?.id;
    if (!effectiveUserId) {
      result.errors.push('Unable to determine user ID');
      return result;
    }

    // ALL personality interactions require authentication (including bot owner)
    result.requiresAuth = true;
    
    // Check if user has valid token (no bypass for bot owner)
    const hasToken = this.userTokenManager.hasValidToken(effectiveUserId);
    if (!hasToken) {
      // Get bot prefix from config or use default
      const botPrefix = process.env.PREFIX || '!tz';
      result.errors.push(`Authentication is required to interact with personalities. Please use \`${botPrefix} auth start\` to authenticate.`);
      logger.info(`[PersonalityAuthValidator] User ${effectiveUserId} lacks required authentication for personality ${personality.name}`);
      return result;
    }
    result.details.hasValidToken = true;

    // Check NSFW verification if needed
    if (channel) {
      const nsfwCheck = this.nsfwVerificationManager.verifyAccess(channel, effectiveUserId, message);
      result.requiresNsfwVerification = this.nsfwVerificationManager.requiresNsfwVerification(channel);
      
      if (!nsfwCheck.isAllowed) {
        result.errors.push('This channel requires age verification. Please use the `verify` command to confirm you are 18 or older.');
        logger.info(`[PersonalityAuthValidator] User ${effectiveUserId} lacks NSFW verification for channel ${channel.id}`);
        return result;
      }

      // Add NSFW check details
      result.details.nsfwCheck = {
        channelRequiresVerification: result.requiresNsfwVerification,
        userVerified: nsfwCheck.isAllowed,
        autoVerified: nsfwCheck.autoVerified || false,
        isProxy: nsfwCheck.isProxy || false
      };

      if (nsfwCheck.isProxy) {
        result.warnings.push(`Proxy system detected (${nsfwCheck.systemType})`);
      }
    }

    // Check for proxy systems
    if (message) {
      const proxyCheck = this.nsfwVerificationManager.checkProxySystem(message);
      if (proxyCheck.isProxy) {
        result.details.proxySystem = {
          detected: true,
          type: proxyCheck.systemType
        };
        
        // For proxy systems, we may need additional validation
        if (result.requiresAuth && !result.details.ownerBypass) {
          result.warnings.push('Authentication through proxy systems may have limitations');
        }
      }
    }

    // All checks passed
    result.isAuthorized = true;
    
    // Log successful authorization
    logger.info(`[PersonalityAuthValidator] User ${effectiveUserId} authorized for personality ${personality?.name || 'unknown'}`);
    
    return result;
  }

  /**
   * Get user authentication status
   * @param {string} userId - The Discord user ID
   * @returns {Object} Authentication status details
   */
  getUserAuthStatus(userId) {
    const hasToken = this.userTokenManager.hasValidToken(userId);
    const tokenInfo = this.userTokenManager.getTokenExpirationInfo(userId);
    const isVerified = this.nsfwVerificationManager.isNsfwVerified(userId);
    const verificationInfo = this.nsfwVerificationManager.getVerificationInfo(userId);

    return {
      userId,
      isOwner: this.isOwner(userId),
      hasValidToken: hasToken,
      tokenExpiration: tokenInfo,
      nsfwVerified: isVerified,
      nsfwVerificationDate: verificationInfo?.verifiedAt || null
    };
  }

  /**
   * Generate authentication help message
   * @param {Object} validationResult - Result from validateAccess
   * @returns {string} Help message for the user
   */
  getAuthHelpMessage(validationResult) {
    const messages = [];

    if (validationResult.errors.length > 0) {
      messages.push('❌ **Authentication Failed**');
      messages.push(...validationResult.errors.map(err => `• ${err}`));
    }

    if (validationResult.requiresAuth && !validationResult.details.hasValidToken && !validationResult.details.ownerBypass) {
      messages.push('\n**How to authenticate:**');
      messages.push('1. Use the `auth` command to get an authentication link');
      messages.push('2. Visit the link and authorize the application');
      messages.push('3. Copy the code and use `auth <code>` to complete authentication');
    }

    if (validationResult.requiresNsfwVerification && !validationResult.details.nsfwCheck?.userVerified) {
      messages.push('\n**Age verification required:**');
      messages.push('• This channel contains age-restricted content');
      messages.push('• Use the `verify` command to confirm you are 18 or older');
    }

    if (validationResult.warnings.length > 0) {
      messages.push('\n**Warnings:**');
      messages.push(...validationResult.warnings.map(warn => `⚠️ ${warn}`));
    }

    return messages.join('\n');
  }
}

module.exports = PersonalityAuthValidator;