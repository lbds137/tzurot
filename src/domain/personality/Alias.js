/**
 * Alias value object
 * @module domain/personality/Alias
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class Alias
 * @extends ValueObject
 * @description Represents a personality alias
 */
class Alias extends ValueObject {
  constructor(value) {
    super();
    
    if (!value || typeof value !== 'string') {
      throw new Error('Alias must be a non-empty string');
    }
    
    const trimmed = value.trim();
    
    if (trimmed.length < 1 || trimmed.length > 50) {
      throw new Error('Alias must be between 1 and 50 characters');
    }
    
    if (trimmed !== value) {
      throw new Error('Alias cannot have leading or trailing spaces');
    }
    
    // Store in lowercase for case-insensitive matching
    this.value = trimmed.toLowerCase();
    this.originalValue = trimmed;
  }

  toString() {
    return this.value;
  }

  getOriginal() {
    return this.originalValue;
  }

  toJSON() {
    return {
      value: this.value,
      original: this.originalValue,
    };
  }

  equals(other) {
    if (!other || !(other instanceof Alias)) {
      return false;
    }
    return this.value === other.value;
  }

  static fromString(value) {
    return new Alias(value);
  }
}

module.exports = { Alias };