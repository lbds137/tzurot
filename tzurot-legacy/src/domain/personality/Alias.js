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

    // Silently trim leading/trailing spaces
    // Spaces in the middle are allowed for multi-word aliases like "angel dust"

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

  /**
   * Get name property for compatibility
   * @returns {string} The alias value
   */
  get name() {
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

  /**
   * Create Alias from JSON
   * @param {Object} json - JSON representation
   * @returns {Alias} New Alias instance
   */
  static fromJSON(json) {
    // Handle both simple string and object formats
    if (typeof json === 'string') {
      return new Alias(json);
    }
    return new Alias(json.original || json.value);
  }
}

module.exports = { Alias };
