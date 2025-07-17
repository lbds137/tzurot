/**
 * Personality configuration value object
 * @module domain/personality/PersonalityConfiguration
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class PersonalityConfiguration
 * @extends ValueObject
 * @description Contains configuration for a personality
 */
class PersonalityConfiguration extends ValueObject {
  constructor(name, prompt, modelPath, maxWordCount = 1000, disableContextMetadata = false) {
    super();

    if (!name || typeof name !== 'string') {
      throw new Error('Name is required and must be a string');
    }

    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt is required and must be a string');
    }

    if (!modelPath || typeof modelPath !== 'string') {
      throw new Error('Model path is required and must be a string');
    }

    if (typeof maxWordCount !== 'number' || maxWordCount <= 0) {
      throw new Error('Max word count must be a positive number');
    }

    if (typeof disableContextMetadata !== 'boolean') {
      throw new Error('disableContextMetadata must be a boolean');
    }

    this.name = name;
    this.prompt = prompt;
    this.modelPath = modelPath;
    this.maxWordCount = maxWordCount;
    this.disableContextMetadata = disableContextMetadata;

    this.freeze();
  }

  /**
   * Create a new configuration with updated values
   * @param {Object} updates - Values to update
   * @returns {PersonalityConfiguration} New configuration
   */
  withUpdates(updates) {
    return new PersonalityConfiguration(
      this.name, // Name cannot be changed
      updates.prompt !== undefined ? updates.prompt : this.prompt,
      updates.modelPath !== undefined ? updates.modelPath : this.modelPath,
      updates.maxWordCount !== undefined ? updates.maxWordCount : this.maxWordCount,
      updates.disableContextMetadata !== undefined
        ? updates.disableContextMetadata
        : this.disableContextMetadata
    );
  }

  toJSON() {
    return {
      name: this.name,
      prompt: this.prompt,
      modelPath: this.modelPath,
      maxWordCount: this.maxWordCount,
      disableContextMetadata: this.disableContextMetadata,
    };
  }

  static fromJSON(json) {
    return new PersonalityConfiguration(
      json.name,
      json.prompt,
      json.modelPath,
      json.maxWordCount,
      json.disableContextMetadata
    );
  }
}

module.exports = { PersonalityConfiguration };
