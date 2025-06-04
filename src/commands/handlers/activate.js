/**
 * Activate Command Handler
 * Activates a personality in a channel to respond to all messages
 */
const { EmbedBuilder, _PermissionFlagsBits } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const channelUtils = require('../../utils/channelUtils');
const { getPersonality, getPersonalityByAlias } = require('../../core/personality');
const { activatePersonality } = require('../../core/conversation');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'activate',
  description: 'Activate a personality to respond to all messages in the channel',
  usage: 'activate <personality-name-or-alias>',
  aliases: [],
  permissions: ['MANAGE_MESSAGES', 'NSFW_CHANNEL'],
};

/**
 * Execute the activate command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if this is a DM channel (we don't allow activate in DMs)
  if (message.channel.isDMBased()) {
    return await directSend(
      `Channel activation is not needed in DMs. Simply send a message to interact with personalities.`
    );
  }

  // Check if the user has permission to manage messages
  if (!validator.canManageMessages(message)) {
    return await directSend(
      `You need the "Manage Messages" permission to activate a personality in this channel.`
    );
  }

  // Check if the channel is NSFW (including parent for threads)
  if (!channelUtils.isChannelNSFW(message.channel)) {
    return await directSend(
      `⚠️ For safety and compliance reasons, personalities can only be activated in channels marked as NSFW. Please mark this channel as NSFW in the channel settings first.`
    );
  }

  // Check if the user provided a personality name
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name or alias. Usage: \`${botPrefix} activate <personality-name-or-alias>\``
    );
  }

  // Join the args to support multi-word personality names/aliases (e.g., "bambi prime")
  const personalityInput = args.join(' ').toLowerCase();

  try {
    // Try to find the personality (first by alias, then by name)
    let personality = getPersonalityByAlias(personalityInput);

    if (!personality) {
      personality = getPersonality(personalityInput);
    }

    if (!personality) {
      return await directSend(
        `Personality "${personalityInput}" not found. Please check the name or alias and try again.`
      );
    }

    // Activate the personality for this channel
    activatePersonality(message.channel.id, personality.fullName, message.author.id);

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Personality Activated')
      .setDescription(
        `**${personality.displayName || personality.fullName}** is now active in this channel and will respond to all messages.`
      )
      .setColor(0x4caf50)
      .setFooter({
        text: `Use "${botPrefix} deactivate" to turn off automatic responses.`,
      });

    // Add avatar if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in activate command:', error);
    return await directSend(`An error occurred while activating the personality: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
