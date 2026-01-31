/**
 * Base class for value objects
 * @module domain/shared/ValueObject
 */

/**
 * @class ValueObject
 * @description Base class for immutable value objects that are defined by their attributes
 */
class ValueObject {
  constructor() {
    // Freeze the object after construction to ensure immutability
    // This must be called in subclass constructors after setting properties
  }

  /**
   * Make the value object immutable
   * @protected
   */
  freeze() {
    Object.freeze(this);
  }

  /**
   * Check equality with another value object
   * @param {ValueObject} other - Another value object to compare
   * @returns {boolean} True if objects are equal
   */
  equals(other) {
    if (!other || !(other instanceof this.constructor)) {
      return false;
    }
    return JSON.stringify(this.toJSON()) === JSON.stringify(other.toJSON());
  }

  /**
   * Convert to plain object
   * @abstract
   * @returns {Object} Plain object representation
   */
  toJSON() {
    // Default implementation - override in subclasses for custom behavior
    const result = {};
    for (const key of Object.keys(this)) {
      const value = this[key];
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Create a copy with updated values
   * @param {Object} updates - Values to update
   * @returns {ValueObject} New instance with updated values
   */
  copyWith(updates) {
    const currentValues = this.toJSON();
    const newValues = { ...currentValues, ...updates };
    return new this.constructor(newValues);
  }

  /**
   * Validate the value object
   * @abstract
   * @throws {Error} If validation fails
   */
  validate() {
    // Override in subclasses to implement validation
  }

  /**
   * Create hash code for the value object
   * @returns {string} Hash code
   */
  hashCode() {
    return JSON.stringify(this.toJSON());
  }
}

module.exports = { ValueObject };
