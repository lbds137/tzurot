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
    channelId,
    guildId = null,
    attachments = [],
    reference = null,
    mentions = null,
    isForwarded = false,
    forwardedContent = null,
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

    if (!channelId || typeof channelId !== 'string') {
      throw new Error('Message requires channelId');
    }

    this.id = id;
    this.content = content;
    this.authorId = authorId;
    this.personalityId = personalityId || null;
    this.timestamp = timestamp;
    this.isFromPersonality = isFromPersonality;
    this.channelId = channelId;
    this.guildId = guildId;
    this.attachments = attachments;
    this.reference = reference;
    this.mentions = mentions;
    this.isForwarded = isForwarded;
    this.forwardedContent = forwardedContent;
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

  /**
   * Check if message is from a DM channel
   * @returns {boolean} True if from DM
   */
  isDM() {
    return !this.guildId;
  }

  /**
   * Check if message is a reply to another message
   * @returns {boolean} True if reply
   */
  isReply() {
    return !!this.reference && !this.isForwarded;
  }

  /**
   * Check if message has media attachments
   * @returns {boolean} True if has attachments
   */
  hasAttachments() {
    return this.attachments.length > 0;
  }

  /**
   * Check if message has image attachments
   * @returns {boolean} True if has images
   */
  hasImages() {
    return this.attachments.some(att => att.contentType && att.contentType.startsWith('image/'));
  }

  /**
   * Check if message has audio attachments
   * @returns {boolean} True if has audio
   */
  hasAudio() {
    return this.attachments.some(att => att.contentType && att.contentType.startsWith('audio/'));
  }

  /**
   * Get mentioned user IDs
   * @returns {string[]} Array of user IDs
   */
  getMentionedUsers() {
    return this.mentions?.users?.map(u => u.id) || [];
  }

  toJSON() {
    return {
      id: this.id,
      content: this.content,
      authorId: this.authorId,
      personalityId: this.personalityId,
      timestamp: this.timestamp.toISOString(),
      isFromPersonality: this.isFromPersonality,
      channelId: this.channelId,
      guildId: this.guildId,
      attachments: this.attachments,
      reference: this.reference,
      mentions: this.mentions,
      isForwarded: this.isForwarded,
      forwardedContent: this.forwardedContent,
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
