/**
 * Personality profile value object
 * @module domain/personality/PersonalityProfile
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class PersonalityProfile
 * @extends ValueObject
 * @description Contains display information for a personality
 */
class PersonalityProfile extends ValueObject {
  constructor({ displayName, avatarUrl, errorMessage }) {
    super();
    
    this.displayName = displayName || null;
    this.avatarUrl = avatarUrl || null;
    this.errorMessage = errorMessage || null;
    
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
      displayName: this.displayName,
      avatarUrl: this.avatarUrl,
      errorMessage: this.errorMessage,
    };
  }

  static createEmpty() {
    return new PersonalityProfile({});
  }

  static fromJSON(data) {
    return new PersonalityProfile(data || {});
  }
}

module.exports = { PersonalityProfile };