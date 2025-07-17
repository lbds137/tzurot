/**
 * Token value object
 * @module domain/authentication/Token
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class Token
 * @extends ValueObject
 * @description Represents an authentication token
 *
 * Note: Token expiry is handled by the AI service. The expiresAt field
 * is stored for informational purposes only and not validated client-side.
 */
class Token extends ValueObject {
  constructor(value, expiresAt = null) {
    super();

    if (!value || typeof value !== 'string') {
      throw new Error('Token value must be a non-empty string');
    }

    // We store expiresAt if provided, but don't validate it
    // The AI service handles token validation
    if (expiresAt && !(expiresAt instanceof Date)) {
      throw new Error('If provided, expiresAt must be a Date');
    }

    this.value = value;
    this.expiresAt = expiresAt;
  }

  /**
   * Check if token is expired
   * @deprecated Token expiry is handled by the AI service
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {boolean} Always false - AI service handles validation
   */
  isExpired(currentTime = new Date()) {
    // Token validation is handled by the AI service
    // This method is kept for backward compatibility but always returns false
    return false;
  }

  /**
   * Get time until expiration in milliseconds
   * @deprecated Token expiry is handled by the AI service
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {number} Always returns Infinity - AI service handles expiry
   */
  timeUntilExpiration(currentTime = new Date()) {
    // Token expiry is handled by the AI service
    return Infinity;
  }

  /**
   * Check if token should be refreshed (expires soon)
   * @deprecated Token refresh is handled by the AI service
   * @param {number} refreshThresholdMs - Refresh if expires within this time
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {boolean} Always false - AI service handles refresh
   */
  shouldRefresh(refreshThresholdMs = 5 * 60 * 1000, currentTime = new Date()) {
    // Token refresh is handled by the AI service
    return false;
  }

  /**
   * Create a token with extended expiration
   * @param {number} extensionMs - Milliseconds to extend
   * @returns {Token} New token with extended expiration
   */
  extend(extensionMs) {
    const newExpiration = new Date(this.expiresAt.getTime() + extensionMs);
    return new Token(this.value, newExpiration);
  }

  toString() {
    // Never expose the actual token value in logs
    return `Token[****${this.value.slice(-4)}]`;
  }

  toJSON() {
    return {
      value: this.value,
      expiresAt: this.expiresAt ? this.expiresAt.toISOString() : null,
    };
  }

  /**
   * Create token from JSON
   * @static
   * @param {Object} data - Token data
   * @returns {Token} Token instance
   */
  static fromJSON(data) {
    return new Token(data.value, new Date(data.expiresAt));
  }

  /**
   * Create a short-lived token for testing
   * @static
   * @param {string} value - Token value
   * @param {number} lifetimeMs - Lifetime in milliseconds
   * @returns {Token} New token
   */
  static createWithLifetime(value, lifetimeMs) {
    const expiresAt = new Date(Date.now() + lifetimeMs);
    return new Token(value, expiresAt);
  }
}

module.exports = { Token };
