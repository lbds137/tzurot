/**
 * User ID value object
 * @module domain/personality/UserId
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class UserId
 * @extends ValueObject
 * @description Represents a Discord user ID
 */
class UserId extends ValueObject {
  constructor(value) {
    super();

    if (!value || typeof value !== 'string') {
      throw new Error('UserId must be a non-empty string');
    }

    // Discord IDs are snowflakes (numeric strings)
    if (!/^\d+$/.test(value)) {
      throw new Error('UserId must be a valid Discord ID');
    }

    this.value = value;
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }

  equals(other) {
    if (!other || !(other instanceof UserId)) {
      return false;
    }
    return this.value === other.value;
  }

  static fromString(value) {
    return new UserId(value);
  }
}

module.exports = { UserId };
