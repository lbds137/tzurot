/**
 * Personality profile value object
 * @module domain/personality/PersonalityProfile
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class PersonalityProfile
 * @extends ValueObject
 * @description Contains configuration and display information for a personality
 */
class PersonalityProfile extends ValueObject {
  constructor(nameOrConfig, prompt, modelPath, maxWordCount) {
    super();

    // Support both object-based and parameter-based construction
    if (typeof nameOrConfig === 'object' && nameOrConfig !== null) {
      // Legacy object-based construction
      const { displayName, avatarUrl, errorMessage } = nameOrConfig;
      this.displayName = displayName || null;
      this.avatarUrl = avatarUrl || null;
      this.errorMessage = errorMessage || null;
      this.name = displayName || null;
      this.prompt = null;
      this.modelPath = null;
      this.maxWordCount = null;
    } else {
      // New parameter-based construction for application service
      this.name = nameOrConfig;
      this.prompt = prompt;
      this.modelPath = modelPath;
      this.maxWordCount = maxWordCount || 1000;
      // Display properties
      this.displayName = nameOrConfig;
      this.avatarUrl = null;
      this.errorMessage = null;
    }

    this.validate();
  }

  validate() {
    if (this.displayName && typeof this.displayName !== 'string') {
      throw new Error('Display name must be a string');
    }

    if (this.avatarUrl && typeof this.avatarUrl !== 'string') {
      throw new Error('Avatar URL must be a string');
    }

    if (this.errorMessage && typeof this.errorMessage !== 'string') {
      throw new Error('Error message must be a string');
    }

    if (this.name && typeof this.name !== 'string') {
      throw new Error('Name must be a string');
    }

    if (this.prompt && typeof this.prompt !== 'string') {
      throw new Error('Prompt must be a string');
    }

    if (this.modelPath && typeof this.modelPath !== 'string') {
      throw new Error('Model path must be a string');
    }

    if (this.maxWordCount && typeof this.maxWordCount !== 'number') {
      throw new Error('Max word count must be a number');
    }
  }

  withDisplayName(displayName) {
    return new PersonalityProfile({
      displayName,
      avatarUrl: this.avatarUrl,
      errorMessage: this.errorMessage,
    });
  }

  withAvatarUrl(avatarUrl) {
    return new PersonalityProfile({
      displayName: this.displayName,
      avatarUrl,
      errorMessage: this.errorMessage,
    });
  }

  withErrorMessage(errorMessage) {
    return new PersonalityProfile({
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      errorMessage,
    });
  }

  isComplete() {
    return !!(this.displayName && this.avatarUrl && this.errorMessage);
  }

  toJSON() {
    return {
      name: this.name,
      prompt: this.prompt,
      modelPath: this.modelPath,
      maxWordCount: this.maxWordCount,
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      errorMessage: this.errorMessage,
    };
  }

  static createEmpty() {
    return new PersonalityProfile({});
  }

  static fromJSON(data) {
    if (!data) return new PersonalityProfile({});

    // If it has name/prompt/modelPath, it's the new format
    if (data.name && data.prompt && data.modelPath) {
      return new PersonalityProfile(data.name, data.prompt, data.modelPath, data.maxWordCount);
    }

    // Otherwise it's the legacy format
    return new PersonalityProfile(data);
  }
}

module.exports = { PersonalityProfile };
