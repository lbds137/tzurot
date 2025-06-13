/**
 * Channel activation aggregate
 * @module domain/conversation/ChannelActivation
 */

const { AggregateRoot } = require('../shared/AggregateRoot');
const { PersonalityId } = require('../personality/PersonalityId');
const { UserId } = require('../personality/UserId');

/**
 * @class ChannelActivation
 * @extends AggregateRoot
 * @description Represents personality activation in a channel
 */
class ChannelActivation extends AggregateRoot {
  constructor(channelId, personalityId, activatedBy) {
    if (!channelId || typeof channelId !== 'string') {
      throw new Error('ChannelActivation requires valid channelId');
    }

    super(channelId);

    this.channelId = channelId;
    this.personalityId = personalityId;
    this.activatedBy = activatedBy;
    this.activatedAt = new Date();
    this.active = true;
  }

  /**
   * Create a new channel activation
   * @static
   * @param {string} channelId - Discord channel ID
   * @param {PersonalityId} personalityId - Personality to activate
   * @param {UserId} activatedBy - User who activated
   * @returns {ChannelActivation} New activation
   */
  static create(channelId, personalityId, activatedBy) {
    if (!(personalityId instanceof PersonalityId)) {
      throw new Error('Invalid PersonalityId');
    }

    if (!(activatedBy instanceof UserId)) {
      throw new Error('Invalid UserId');
    }

    return new ChannelActivation(channelId, personalityId, activatedBy);
  }

  /**
   * Deactivate the channel
   */
  deactivate() {
    if (!this.active) {
      throw new Error('Channel already deactivated');
    }

    this.active = false;
    this.version++;
  }

  /**
   * Check if activation is for specific personality
   * @param {PersonalityId} personalityId - Personality to check
   * @returns {boolean} True if matches
   */
  isForPersonality(personalityId) {
    return this.personalityId.equals(personalityId);
  }

  toJSON() {
    return {
      channelId: this.channelId,
      personalityId: this.personalityId.toString(),
      activatedBy: this.activatedBy.toString(),
      activatedAt: this.activatedAt.toISOString(),
      active: this.active,
    };
  }
}

module.exports = { ChannelActivation };
