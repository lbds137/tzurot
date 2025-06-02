/**
 * Deactivate Command Handler
 * Deactivates the active personality in a channel
 */
const { EmbedBuilder, PermissionFlagsBits: _PermissionFlagsBits } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { deactivatePersonality } = require('../../conversationManager');
const { botPrefix: _botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'deactivate',
  description: 'Deactivate the currently active personality in this channel',
  usage: 'deactivate',
  aliases: [],
  permissions: ['MANAGE_MESSAGES'],
};

/**
 * Execute the deactivate command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, _args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if this is a DM channel (we don't allow deactivate in DMs as it's not needed)
  if (message.channel.isDMBased()) {
    return await directSend(
      `Channel activation is not used in DMs. You can simply stop messaging to end the conversation.`
    );
  }

  // Check if the user has permission to manage messages
  if (!validator.canManageMessages(message)) {
    return await directSend(
      `You need the "Manage Messages" permission to deactivate a personality in this channel.`
    );
  }

  try {
    // Deactivate personality for this channel
    const wasDeactivated = deactivatePersonality(message.channel.id);

    if (!wasDeactivated) {
      return await directSend('No active personality found in this channel.');
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Channel Deactivated')
      .setDescription(
        `The active personality has been deactivated in this channel. It will no longer respond to all messages.`
      )
      .setColor(0xf44336);

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in deactivate command:', error);
    return await directSend(
      `An error occurred while deactivating the personality: ${error.message}`
    );
  }
}

module.exports = {
  meta,
  execute,
};
