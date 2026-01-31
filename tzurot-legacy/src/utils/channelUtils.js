/**
 * Utilities for working with Discord channels
 */

const logger = require('../logger');

/**
 * Check if a channel is NSFW, considering thread parents
 *
 * @param {Object} channel - The Discord channel object
 * @returns {boolean} - Whether the channel is considered NSFW
 */
function isChannelNSFW(channel) {
  if (!channel) return false;

  // Direct check for the channel's nsfw flag
  if (channel.nsfw === true) {
    return true;
  }

  // If this is a thread, check its parent channel
  if (channel.isThread && channel.isThread()) {
    try {
      // Some thread types might have different parent access methods
      const parent = channel.parent || channel.parentChannel || channel.parentTextChannel;

      if (parent) {
        logger.debug(
          `[ChannelUtils] Channel ${channel.id} is a thread, checking parent ${parent.id} for NSFW status`
        );
        return parent.nsfw === true;
      }
    } catch (error) {
      logger.error(`[ChannelUtils] Error checking thread parent NSFW status: ${error.message}`);
    }
  }

  // For forum threads, try a different approach
  if (channel.parentId) {
    try {
      // Try to get the parent channel from the client cache
      const guild = channel.guild;
      if (guild) {
        const parent = guild.channels.cache.get(channel.parentId);
        if (parent) {
          logger.debug(`[ChannelUtils] Found parent channel ${parent.id} for thread ${channel.id}`);
          return parent.nsfw === true;
        }
      }
    } catch (error) {
      logger.error(`[ChannelUtils] Error checking forum thread parent: ${error.message}`);
    }
  }

  // Default to false if we can't determine NSFW status
  return false;
}

module.exports = {
  isChannelNSFW,
};
