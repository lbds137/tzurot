/**
 * Authentication context value object
 * @module domain/authentication/AuthContext
 */

const { ValueObject } = require('../shared/ValueObject');

/**
 * @class AuthContext
 * @extends ValueObject
 * @description Context information for authentication requests
 */
class AuthContext extends ValueObject {
  constructor({
    channelType,
    channelId,
    isNsfwChannel = false,
    isProxyMessage = false,
    requestedPersonalityId = null,
  }) {
    super();

    if (!channelType || !['DM', 'GUILD', 'THREAD'].includes(channelType)) {
      throw new Error('Invalid channel type');
    }

    if (!channelId || typeof channelId !== 'string') {
      throw new Error('Channel ID required');
    }

    this.channelType = channelType;
    this.channelId = channelId;
    this.isNsfwChannel = !!isNsfwChannel;
    this.isProxyMessage = !!isProxyMessage;
    this.requestedPersonalityId = requestedPersonalityId;
  }

  /**
   * Check if this is a DM context
   * @returns {boolean} True if DM
   */
  isDM() {
    return this.channelType === 'DM';
  }

  /**
   * Check if this is a guild channel
   * @returns {boolean} True if guild channel
   */
  isGuildChannel() {
    return this.channelType === 'GUILD';
  }

  /**
   * Check if this is a thread
   * @returns {boolean} True if thread
   */
  isThread() {
    return this.channelType === 'THREAD';
  }

  /**
   * Check if NSFW verification is required
   * @returns {boolean} True if NSFW verification needed
   */
  requiresNsfwVerification() {
    // DMs don't require NSFW verification
    // Threads follow parent channel rules
    // NSFW channels require verification
    return !this.isDM() && this.isNsfwChannel;
  }

  /**
   * Check if proxy messages are allowed
   * @returns {boolean} True if proxy allowed
   */
  allowsProxy() {
    // Proxy messages not allowed in DMs for security
    return !this.isDM();
  }

  toJSON() {
    return {
      channelType: this.channelType,
      channelId: this.channelId,
      isNsfwChannel: this.isNsfwChannel,
      isProxyMessage: this.isProxyMessage,
      requestedPersonalityId: this.requestedPersonalityId,
    };
  }

  static createForDM(channelId) {
    return new AuthContext({
      channelType: 'DM',
      channelId,
      isNsfwChannel: false,
      isProxyMessage: false,
    });
  }

  static createForGuild(channelId, isNsfwChannel = false) {
    return new AuthContext({
      channelType: 'GUILD',
      channelId,
      isNsfwChannel,
      isProxyMessage: false,
    });
  }

  static createForThread(channelId, parentIsNsfw = false) {
    return new AuthContext({
      channelType: 'THREAD',
      channelId,
      isNsfwChannel: parentIsNsfw,
      isProxyMessage: false,
    });
  }
}

module.exports = { AuthContext };
