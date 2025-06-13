/**
 * Token value object
 * @module domain/authentication/Token
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class Token
 * @extends ValueObject
 * @description Represents an authentication token
 */
class Token extends ValueObject {
  constructor(value, expiresAt) {
    super();

    if (!value || typeof value !== 'string') {
      throw new Error('Token value must be a non-empty string');
    }

    if (!expiresAt || !(expiresAt instanceof Date)) {
      throw new Error('Token requires valid expiration date');
    }

    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('Token expiration must be in the future');
    }

    this.value = value;
    this.expiresAt = expiresAt;
  }

  /**
   * Check if token is expired
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {boolean} True if expired
   */
  isExpired(currentTime = new Date()) {
    return currentTime.getTime() >= this.expiresAt.getTime();
  }

  /**
   * Get time until expiration in milliseconds
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {number} Milliseconds until expiration
   */
  timeUntilExpiration(currentTime = new Date()) {
    const remaining = this.expiresAt.getTime() - currentTime.getTime();
    return Math.max(0, remaining);
  }

  /**
   * Check if token should be refreshed (expires soon)
   * @param {number} refreshThresholdMs - Refresh if expires within this time
   * @param {Date} [currentTime] - Current time (for testing)
   * @returns {boolean} True if should refresh
   */
  shouldRefresh(refreshThresholdMs = 5 * 60 * 1000, currentTime = new Date()) {
    return this.timeUntilExpiration(currentTime) <= refreshThresholdMs;
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
      expiresAt: this.expiresAt.toISOString(),
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
