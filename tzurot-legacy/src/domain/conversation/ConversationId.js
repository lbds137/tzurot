/**
 * Conversation ID value object
 * @module domain/conversation/ConversationId
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class ConversationId
 * @extends ValueObject
 * @description Represents a unique conversation identifier (user-channel pair)
 */
class ConversationId extends ValueObject {
  constructor(userId, channelId) {
    super();

    if (!userId || typeof userId !== 'string') {
      throw new Error('ConversationId requires valid userId');
    }

    if (!channelId || typeof channelId !== 'string') {
      throw new Error('ConversationId requires valid channelId');
    }

    this.userId = userId;
    this.channelId = channelId;
  }

  /**
   * Create ID for DM conversation
   * @static
   * @param {string} userId - User ID
   * @returns {ConversationId} Conversation ID for DM
   */
  static forDM(userId) {
    return new ConversationId(userId, 'DM');
  }

  /**
   * Check if this is a DM conversation
   * @returns {boolean} True if DM
   */
  isDM() {
    return this.channelId === 'DM';
  }

  toString() {
    return `${this.userId}:${this.channelId}`;
  }

  toJSON() {
    return {
      userId: this.userId,
      channelId: this.channelId,
    };
  }

  equals(other) {
    if (!other || !(other instanceof ConversationId)) {
      return false;
    }
    return this.userId === other.userId && this.channelId === other.channelId;
  }

  static fromString(value) {
    if (!value || typeof value !== 'string') {
      throw new Error('Invalid conversation ID string');
    }

    const [userId, channelId] = value.split(':');
    if (!userId || !channelId) {
      throw new Error('Invalid conversation ID format');
    }

    return new ConversationId(userId, channelId);
  }
}

module.exports = { ConversationId };
