/**
 * AI Request ID value object
 * @module domain/ai/AIRequestId
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class AIRequestId
 * @extends ValueObject
 * @description Unique identifier for AI requests
 */
class AIRequestId extends ValueObject {
  constructor(value) {
    super();

    if (!value) {
      // Generate new ID if not provided
      value = this.generateId();
    }

    if (typeof value !== 'string') {
      throw new Error('AIRequestId must be a string');
    }

    this.value = value;
    this.freeze();
  }

  /**
   * Generate a new request ID
   * @private
   * @returns {string} Generated ID
   */
  generateId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `air_${timestamp}_${random}`;
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }

  static create() {
    return new AIRequestId();
  }

  static fromString(value) {
    return new AIRequestId(value);
  }
}

module.exports = { AIRequestId };
