/**
 * Command Validator - Validates command permissions and inputs
 */
const { PermissionFlagsBits } = require('discord.js');
const _logger = require('../../logger');
const utils = require('../../utils');
const channelUtils = require('../../utils/channelUtils');

/**
 * Check if a user has administrator permissions in a channel
 * @param {Object} message - Discord message object
 * @returns {boolean} Whether the user has admin permissions
 */
function isAdmin(message) {
  // For DM channels, always return false (no admin in DMs)
  if (message.channel.isDMBased()) {
    return false;
  }

  // Check if the member exists and has admin permissions
  return message.member && message.member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Check if a user has permission to manage messages in a channel
 * @param {Object} message - Discord message object
 * @returns {boolean} Whether the user has manage messages permission
 */
function canManageMessages(message) {
  // For DM channels, always return false (no permissions in DMs)
  if (message.channel.isDMBased()) {
    return false;
  }

  // Check if the member exists and has manage messages permission
  return message.member && message.member.permissions.has(PermissionFlagsBits.ManageMessages);
}

/**
 * Check if a channel is NSFW
 * @param {Object} channel - Discord channel object
 * @returns {boolean} Whether the channel is NSFW
 */
function isNsfwChannel(channel) {
  return channelUtils.isChannelNSFW(channel);
}

/**
 * Create a direct send function for a message
 * @param {Object} message - Discord message object
 * @returns {Function} Direct send function
 */
function createDirectSend(message) {
  return utils.createDirectSend(message);
}

/**
 * Get a rich error response for failed permission check
 * @param {string} permission - Permission name
 * @param {string} command - Command name
 * @returns {string} Error message
 */
function getPermissionErrorMessage(permission, command) {
  switch (permission) {
    case 'ADMINISTRATOR':
      return `You need Administrator permission to use the ${command} command.`;
    case 'MANAGE_MESSAGES':
      return `You need the "Manage Messages" permission to use the ${command} command.`;
    case 'NSFW_CHANNEL':
      return `⚠️ For safety and compliance reasons, this command can only be used in channels marked as NSFW.`;
    default:
      return `You don't have permission to use the ${command} command.`;
  }
}

module.exports = {
  isAdmin,
  canManageMessages,
  isNsfwChannel,
  createDirectSend,
  getPermissionErrorMessage,
};
