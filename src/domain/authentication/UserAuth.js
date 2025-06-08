/**
 * User authentication aggregate root
 * @module domain/authentication/UserAuth
 */

const { AggregateRoot } = require('../shared/AggregateRoot');
const { UserId } = require('../personality/UserId');
const { Token } = require('./Token');
const { NsfwStatus } = require('./NsfwStatus');
const {
  UserAuthenticated,
  UserTokenExpired,
  UserTokenRefreshed,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
  UserBlacklisted,
  UserUnblacklisted,
} = require('./AuthenticationEvents');

/**
 * @class UserAuth
 * @extends AggregateRoot
 * @description Aggregate root for user authentication
 */
class UserAuth extends AggregateRoot {
  constructor(userId) {
    if (!(userId instanceof UserId)) {
      throw new Error('UserAuth must be created with UserId');
    }
    
    super(userId.toString());
    
    this.userId = userId;
    this.token = null;
    this.nsfwStatus = NsfwStatus.createUnverified();
    this.blacklisted = false;
    this.blacklistReason = null;
    this.lastAuthenticatedAt = null;
    this.authenticationCount = 0;
  }

  /**
   * Authenticate user with token
   * @static
   * @param {UserId} userId - User ID
   * @param {Token} token - Authentication token
   * @returns {UserAuth} New authenticated user
   */
  static authenticate(userId, token) {
    if (!(userId instanceof UserId)) {
      throw new Error('Invalid UserId');
    }
    
    if (!(token instanceof Token)) {
      throw new Error('Invalid Token');
    }
    
    const userAuth = new UserAuth(userId);
    
    userAuth.applyEvent(new UserAuthenticated(
      userId.toString(),
      {
        userId: userId.toString(),
        token: token.toJSON(),
        authenticatedAt: new Date().toISOString(),
      }
    ));
    
    return userAuth;
  }

  /**
   * Refresh authentication token
   * @param {Token} newToken - New token
   */
  refreshToken(newToken) {
    if (this.blacklisted) {
      throw new Error('Cannot refresh token for blacklisted user');
    }
    
    if (!(newToken instanceof Token)) {
      throw new Error('Invalid Token');
    }
    
    if (newToken.isExpired()) {
      throw new Error('Cannot refresh with expired token');
    }
    
    this.applyEvent(new UserTokenRefreshed(
      this.id,
      {
        oldToken: this.token ? this.token.toJSON() : null,
        newToken: newToken.toJSON(),
        refreshedAt: new Date().toISOString(),
      }
    ));
  }

  /**
   * Mark token as expired
   */
  expireToken() {
    if (!this.token) {
      throw new Error('No token to expire');
    }
    
    this.applyEvent(new UserTokenExpired(
      this.id,
      {
        expiredAt: new Date().toISOString(),
      }
    ));
  }

  /**
   * Verify NSFW access
   * @param {Date} [verifiedAt] - Verification time
   */
  verifyNsfw(verifiedAt = new Date()) {
    if (this.blacklisted) {
      throw new Error('Cannot verify NSFW for blacklisted user');
    }
    
    if (this.nsfwStatus.verified) {
      return; // Already verified
    }
    
    this.applyEvent(new UserNsfwVerified(
      this.id,
      {
        verifiedAt: verifiedAt.toISOString(),
      }
    ));
  }

  /**
   * Clear NSFW verification
   * @param {string} reason - Reason for clearing
   */
  clearNsfwVerification(reason) {
    if (!this.nsfwStatus.verified) {
      return; // Already unverified
    }
    
    this.applyEvent(new UserNsfwVerificationCleared(
      this.id,
      {
        reason,
        clearedAt: new Date().toISOString(),
      }
    ));
  }

  /**
   * Blacklist user
   * @param {string} reason - Blacklist reason
   */
  blacklist(reason) {
    if (this.blacklisted) {
      throw new Error('User already blacklisted');
    }
    
    if (!reason || typeof reason !== 'string') {
      throw new Error('Blacklist reason required');
    }
    
    this.applyEvent(new UserBlacklisted(
      this.id,
      {
        reason,
        blacklistedAt: new Date().toISOString(),
      }
    ));
  }

  /**
   * Remove from blacklist
   */
  unblacklist() {
    if (!this.blacklisted) {
      throw new Error('User not blacklisted');
    }
    
    this.applyEvent(new UserUnblacklisted(
      this.id,
      {
        unblacklistedAt: new Date().toISOString(),
      }
    ));
  }

  /**
   * Check if user has valid authentication
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {boolean} True if authenticated
   */
  isAuthenticated(currentTime = new Date()) {
    return !!(
      this.token && 
      !this.token.isExpired(currentTime) && 
      !this.blacklisted
    );
  }

  /**
   * Check if user can access NSFW content
   * @param {AuthContext} context - Authentication context
   * @returns {boolean} True if allowed
   */
  canAccessNsfw(context) {
    if (!this.isAuthenticated()) {
      return false;
    }
    
    if (!context.requiresNsfwVerification()) {
      return true; // DMs don't require verification
    }
    
    return this.nsfwStatus.verified && !this.nsfwStatus.isStale();
  }

  /**
   * Get rate limit for user
   * @returns {number} Requests per minute
   */
  getRateLimit() {
    if (this.blacklisted) {
      return 0;
    }
    
    // Could be enhanced with premium tiers, etc.
    return 20; // Default rate limit
  }

  // Event handlers
  onUserAuthenticated(event) {
    this.userId = UserId.fromString(event.payload.userId);
    this.token = Token.fromJSON(event.payload.token);
    this.lastAuthenticatedAt = event.payload.authenticatedAt;
    this.authenticationCount++;
  }

  onUserTokenRefreshed(event) {
    this.token = Token.fromJSON(event.payload.newToken);
  }

  onUserTokenExpired(event) {
    this.token = null;
  }

  onUserNsfwVerified(event) {
    this.nsfwStatus = this.nsfwStatus.markVerified(new Date(event.payload.verifiedAt));
  }

  onUserNsfwVerificationCleared(event) {
    this.nsfwStatus = this.nsfwStatus.clearVerification();
  }

  onUserBlacklisted(event) {
    this.blacklisted = true;
    this.blacklistReason = event.payload.reason;
    this.token = null; // Revoke access
    this.nsfwStatus = this.nsfwStatus.clearVerification();
  }

  onUserUnblacklisted(event) {
    this.blacklisted = false;
    this.blacklistReason = null;
  }

  // Serialization
  toJSON() {
    return {
      id: this.id,
      userId: this.userId.toString(),
      token: this.token ? this.token.toJSON() : null,
      nsfwStatus: this.nsfwStatus.toJSON(),
      blacklisted: this.blacklisted,
      blacklistReason: this.blacklistReason,
      lastAuthenticatedAt: this.lastAuthenticatedAt,
      authenticationCount: this.authenticationCount,
      version: this.version,
    };
  }
}

module.exports = { UserAuth };