/**
 * Conversation settings value object
 * @module domain/conversation/ConversationSettings
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class ConversationSettings
 * @extends ValueObject
 * @description Settings for conversation behavior
 */
class ConversationSettings extends ValueObject {
  constructor({
    autoResponseEnabled = false,
    autoResponseDelay = 8000,
    mentionOnly = false,
    timeoutMs = 600000, // 10 minutes default
  } = {}) {
    super();

    this.autoResponseEnabled = autoResponseEnabled;
    this.autoResponseDelay = autoResponseDelay;
    this.mentionOnly = mentionOnly;
    this.timeoutMs = timeoutMs;

    this.validate();
  }

  validate() {
    if (typeof this.autoResponseEnabled !== 'boolean') {
      throw new Error('autoResponseEnabled must be boolean');
    }

    if (typeof this.autoResponseDelay !== 'number' || this.autoResponseDelay < 0) {
      throw new Error('autoResponseDelay must be non-negative number');
    }

    if (typeof this.mentionOnly !== 'boolean') {
      throw new Error('mentionOnly must be boolean');
    }

    if (typeof this.timeoutMs !== 'number' || this.timeoutMs < 0) {
      throw new Error('timeoutMs must be non-negative number');
    }
  }

  withAutoResponse(enabled) {
    return new ConversationSettings({
      ...this.toJSON(),
      autoResponseEnabled: enabled,
    });
  }

  withAutoResponseDelay(delay) {
    return new ConversationSettings({
      ...this.toJSON(),
      autoResponseDelay: delay,
    });
  }

  withMentionOnly(enabled) {
    return new ConversationSettings({
      ...this.toJSON(),
      mentionOnly: enabled,
    });
  }

  withTimeout(timeoutMs) {
    return new ConversationSettings({
      ...this.toJSON(),
      timeoutMs,
    });
  }

  toJSON() {
    return {
      autoResponseEnabled: this.autoResponseEnabled,
      autoResponseDelay: this.autoResponseDelay,
      mentionOnly: this.mentionOnly,
      timeoutMs: this.timeoutMs,
    };
  }

  static createDefault() {
    return new ConversationSettings();
  }

  static createForDM() {
    return new ConversationSettings({
      autoResponseEnabled: true,
      mentionOnly: false,
    });
  }
}

module.exports = { ConversationSettings };
