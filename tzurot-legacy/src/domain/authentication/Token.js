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
