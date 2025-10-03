const logger = require('../../logger');

/**
 * ChannelActivation - Manages personality activations in channels
 *
 * This module handles channels where a personality is activated to respond
 * to all messages, not just those directed at the bot.
 */
class ChannelActivation {
  constructor() {
    // Track activated channels with their personality information
    this.activatedChannels = new Map();
  }

  /**
   * Activate a personality in a channel
   * @param {string} channelId - Discord channel ID
   * @param {string} personalityName - Full name of the personality
   * @param {string} userId - Discord user ID who activated
   * @returns {boolean} Success status
   */
  activate(channelId, personalityName, userId) {
    logger.info(
      `[ChannelActivation] Activating personality "${personalityName}" in channel ${channelId} by user ${userId}`
    );

    this.activatedChannels.set(channelId, {
      personalityName,
      activatedBy: userId,
      timestamp: Date.now(),
    });

    logger.info(
      `[ChannelActivation] Successfully activated personality "${personalityName}" in channel ${channelId}`
    );
    return true;
  }

  /**
   * Deactivate personality in a channel
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} Success status (true if there was a personality to deactivate)
   */
  deactivate(channelId) {
    const result = this.activatedChannels.delete(channelId);

    if (result) {
      logger.info(`[ChannelActivation] Deactivated personality in channel ${channelId}`);
    }

    return result;
  }

  /**
   * Check if a channel has an activated personality
   * @param {string} channelId - Discord channel ID
   * @returns {string|null} The personality name or null if none activated
   */
  getActivatedPersonality(channelId) {
    logger.debug(`[ChannelActivation] Checking activated personality for channel ${channelId}`);
    logger.debug(
      `[ChannelActivation] Current activatedChannels Map size: ${this.activatedChannels.size}`
    );

    const activated = this.activatedChannels.get(channelId);

    if (!activated) {
      logger.debug(`[ChannelActivation] No activated personality found for channel ${channelId}`);
      return null;
    }

    logger.info(
      `[ChannelActivation] FOUND activated personality "${activated.personalityName}" for channel ${channelId}, activated by user ${activated.activatedBy} at ${new Date(activated.timestamp).toISOString()}`
    );
    return activated.personalityName;
  }

  /**
   * Get all channels with activated personalities
   * @returns {Object} Map of channel IDs to personality names
   */
  getAllActivatedChannels() {
    const result = {};
    for (const [channelId, activated] of this.activatedChannels.entries()) {
      result[channelId] = activated.personalityName;
    }
    return result;
  }

  /**
   * Get full activation data (for persistence)
   * @returns {Object} Map of channel IDs to full activation data
   */
  getAllActivationData() {
    const result = {};
    for (const [channelId, data] of this.activatedChannels.entries()) {
      result[channelId] = data;
    }
    return result;
  }

  /**
   * Load activations from persisted data
   * @param {Object} activations - Activations object from storage
   */
  loadFromData(activations) {
    if (activations && typeof activations === 'object') {
      this.activatedChannels.clear();

      for (const [channelId, data] of Object.entries(activations)) {
        this.activatedChannels.set(channelId, data);
      }

      logger.info(`[ChannelActivation] Loaded ${this.activatedChannels.size} activated channels`);
    }
  }

  /**
   * Clear all channel activations
   */
  clear() {
    this.activatedChannels.clear();
  }
}

module.exports = ChannelActivation;
