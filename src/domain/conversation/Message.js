/**
 * Message entity
 * @module domain/conversation/Message
 */

/**
 * @class Message
 * @description Entity representing a message within a conversation
 */
class Message {
  constructor({
    id,
    content,
    authorId,
    personalityId,
    timestamp,
    isFromPersonality = false,
  }) {
    if (!id || typeof id !== 'string') {
      throw new Error('Message requires valid id');
    }
    
    if (!content || typeof content !== 'string') {
      throw new Error('Message requires content');
    }
    
    if (!authorId || typeof authorId !== 'string') {
      throw new Error('Message requires authorId');
    }
    
    if (!timestamp || !(timestamp instanceof Date)) {
      throw new Error('Message requires valid timestamp');
    }
    
    this.id = id;
    this.content = content;
    this.authorId = authorId;
    this.personalityId = personalityId || null;
    this.timestamp = timestamp;
    this.isFromPersonality = isFromPersonality;
  }

  /**
   * Check if message is from a user (not personality)
   * @returns {boolean} True if from user
   */
  isFromUser() {
    return !this.isFromPersonality;
  }

  /**
   * Get message age in milliseconds
   * @returns {number} Age in milliseconds
   */
  getAge() {
    return Date.now() - this.timestamp.getTime();
  }

  /**
   * Check if message is expired based on timeout
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {boolean} True if expired
   */
  isExpired(timeoutMs) {
    return this.getAge() > timeoutMs;
  }

  toJSON() {
    return {
      id: this.id,
      content: this.content,
      authorId: this.authorId,
      personalityId: this.personalityId,
      timestamp: this.timestamp.toISOString(),
      isFromPersonality: this.isFromPersonality,
    };
  }

  static fromJSON(data) {
    return new Message({
      ...data,
      timestamp: new Date(data.timestamp),
    });
  }
}

module.exports = { Message };