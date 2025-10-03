/**
 * Personality ID value object
 * @module domain/personality/PersonalityId
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class PersonalityId
 * @extends ValueObject
 * @description Represents a unique personality identifier
 */
class PersonalityId extends ValueObject {
  constructor(value) {
    super();

    if (!value || typeof value !== 'string') {
      throw new Error('PersonalityId must be a non-empty string');
    }

    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      throw new Error('PersonalityId must be between 2 and 100 characters');
    }

    // Validate format: alphanumeric, spaces, hyphens, underscores, periods
    if (!/^[a-zA-Z0-9\s\-_.]+$/.test(trimmed)) {
      throw new Error('PersonalityId contains invalid characters');
    }

    // Check reserved names
    const reserved = ['system', 'bot', 'admin', 'owner', 'moderator', 'mod', 'help'];
    if (reserved.includes(trimmed.toLowerCase())) {
      throw new Error(`"${trimmed}" is a reserved personality name`);
    }

    this.value = trimmed;
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }

  static fromString(value) {
    return new PersonalityId(value);
  }

  /**
   * Generate a new PersonalityId
   * @returns {PersonalityId}
   */
  static generate() {
    // Generate a unique ID using timestamp and random component
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return new PersonalityId(`personality-${timestamp}-${random}`);
  }
}

module.exports = { PersonalityId };
