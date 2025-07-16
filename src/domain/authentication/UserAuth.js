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
 * 
 * IMPORTANT: Users must be authenticated to exist in the system.
 * There are no "unauthenticated" users - if someone hasn't gone through
 * OAuth, they simply don't have a UserAuth record.
 */
class UserAuth extends AggregateRoot {
  /**
   * Private constructor - use static factory methods
   * @private
   */
  constructor(userId, token) {
    if (!(userId instanceof UserId)) {
      throw new Error('UserAuth must be created with UserId');
    }

    if (!(token instanceof Token)) {
      throw new Error('UserAuth must be created with Token');
    }

    super(userId.toString());

    this.userId = userId;
    this.token = token;
    this.nsfwStatus = NsfwStatus.createUnverified();
    this.blacklisted = false;
    this.blacklistReason = null;
  }

  /**
   * Create new authenticated user
   * @static
   * @param {UserId} userId - User ID
   * @param {Token} token - Authentication token
   * @returns {UserAuth} New authenticated user
   */
  static createAuthenticated(userId, token) {
    if (!(userId instanceof UserId)) {
      throw new Error('Invalid UserId');
    }

    if (!(token instanceof Token)) {
      throw new Error('Invalid Token');
    }

    const userAuth = new UserAuth(userId, token);

    userAuth.applyEvent(
      new UserAuthenticated(userId.toString(), {
        userId: userId.toString(),
        token: token.toJSON(),
        authenticatedAt: new Date().toISOString(),
      })
    );

    return userAuth;
  }

  /**
   * Reconstitute from persistence
   * @static
   * @param {Object} data - Persisted data
   * @returns {UserAuth} Reconstituted user auth
   */
  static fromData(data) {
    if (!data.userId || !data.token) {
      throw new Error('Cannot reconstitute UserAuth without userId and token');
    }

    const userId = new UserId(data.userId);
    const token = new Token(
      data.token.value, 
      data.token.expiresAt ? new Date(data.token.expiresAt) : null
    );
    
    const userAuth = new UserAuth(userId, token);
    
    // Restore state without events
    userAuth.nsfwStatus = data.nsfwStatus 
      ? NsfwStatus.fromJSON(data.nsfwStatus)
      : NsfwStatus.createUnverified();
    userAuth.blacklisted = data.blacklisted || false;
    userAuth.blacklistReason = data.blacklistReason || null;
    
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

    // Token validation is handled by the AI service
    // We don't check expiry client-side

    this.applyEvent(
      new UserTokenRefreshed(this.id, {
        oldToken: this.token.toJSON(),
        newToken: newToken.toJSON(),
        refreshedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Mark token as expired
   */
  expireToken() {
    if (!this.token) {
      return; // No token to expire
    }

    this.applyEvent(
      new UserTokenExpired(this.id, {
        expiredAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Verify user for NSFW access
   */
  verifyNsfw() {
    if (this.blacklisted) {
      throw new Error('Cannot verify NSFW for blacklisted user');
    }

    if (!this.isAuthenticated()) {
      throw new Error('Must be authenticated to verify NSFW access');
    }

    if (this.nsfwStatus.verified) {
      return; // Already verified
    }

    this.applyEvent(
      new UserNsfwVerified(this.id, {
        verifiedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Clear NSFW verification
   * @param {string} reason - Reason for clearing verification
   */
  clearNsfwVerification(reason = 'User requested clearing') {
    if (!this.nsfwStatus.verified) {
      return; // Not verified
    }

    this.applyEvent(
      new UserNsfwVerificationCleared(this.id, {
        reason: reason,
        clearedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Blacklist user
   * @param {string} reason - Reason for blacklisting
   */
  blacklist(reason) {
    if (this.blacklisted) {
      throw new Error('User already blacklisted');
    }

    if (!reason || typeof reason !== 'string') {
      throw new Error('Blacklist reason required');
    }

    this.applyEvent(
      new UserBlacklisted(this.id, {
        reason,
        blacklistedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Remove user from blacklist
   */
  unblacklist() {
    if (!this.blacklisted) {
      throw new Error('User not blacklisted');
    }

    this.applyEvent(
      new UserUnblacklisted(this.id, {
        unblacklistedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} True if authenticated (has token)
   */
  isAuthenticated() {
    // Token validation is handled by the AI service
    // We just check if the user has a token
    return this.token !== null;
  }

  /**
   * Check if user can access NSFW content
   * @param {Object} personality - Personality to check
   * @param {AuthContext} context - Authentication context
   * @returns {boolean} True if can access
   */
  canAccessNsfw(personality, context) {
    // All personalities are treated as NSFW uniformly
    // No individual personality NSFW checking needed
    
    if (context.isDM()) {
      return this.nsfwStatus.verified;
    }

    if (context.isNsfwChannel) {
      return true; // NSFW channel
    }

    return false; // NSFW content in non-NSFW channel
  }

  /**
   * Get user rate limit
   * @returns {number} Rate limit multiplier
   */
  getRateLimit() {
    if (this.blacklisted) {
      return 0; // No access
    }

    // Could implement tiered rate limits based on trust
    return 1; // Default rate limit
  }

  /**
   * Convert to JSON for persistence
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      userId: this.userId.toString(),
      token: this.token ? this.token.toJSON() : null,
      nsfwStatus: this.nsfwStatus.toJSON(),
      blacklisted: this.blacklisted,
      blacklistReason: this.blacklistReason,
    };
  }

  // Event handlers
  onUserAuthenticated(event) {
    // No longer tracking authentication count or last authenticated time
  }

  onUserTokenRefreshed(event) {
    this.token = new Token(
      event.payload.newToken.value,
      event.payload.newToken.expiresAt ? new Date(event.payload.newToken.expiresAt) : null
    );
  }

  onUserTokenExpired(event) {
    // Mark token as expired by setting it to null
    // The token history is maintained in the event itself
    this.token = null;
  }

  onUserNsfwVerified(event) {
    this.nsfwStatus = this.nsfwStatus.markVerified();
  }

  onUserNsfwVerificationCleared(event) {
    this.nsfwStatus = this.nsfwStatus.clearVerification();
  }

  onUserBlacklisted(event) {
    this.blacklisted = true;
    this.blacklistReason = event.payload.reason;
    // Revoke token and clear NSFW verification when blacklisted
    this.token = null;
    this.nsfwStatus = NsfwStatus.createUnverified();
  }

  onUserUnblacklisted(event) {
    this.blacklisted = false;
    this.blacklistReason = null;
  }
}

module.exports = { UserAuth };