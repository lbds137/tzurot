/**
 * Info Command Handler
 * Displays detailed information about a personality
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { getPersonality, getPersonalityByAlias } = require('../../core/personality');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'info',
  description: 'Display detailed information about a personality',
  usage: 'info <personality-name-or-alias>',
  aliases: [],
  permissions: [],
};

/**
 * Execute the info command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSendFn = validator.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSendFn(
      `You need to provide a personality name or alias. Usage: \`${botPrefix} ${meta.usage}\``
    );
  }

  // Extract the personality name or alias
  const personalityInput = args[0].toLowerCase();

  try {
    // Try to find the personality (first by alias, then by name)
    let personality = getPersonalityByAlias(personalityInput);

    if (!personality) {
      personality = getPersonality(personalityInput);
    }

    if (!personality) {
      return await directSendFn(
        `Personality "${personalityInput}" not found. Please check the name or alias and try again.`
      );
    }

    // Create the info embed
    const embed = new EmbedBuilder()
      .setTitle('Personality Info')
      .setDescription(`Information for **${personality.displayName || personality.fullName}**`)
      .setColor(0x2196f3)
      .addFields(
        { name: 'Full Name', value: personality.fullName, inline: true },
        { name: 'Display Name', value: personality.displayName || 'Not set', inline: true }
      );

    // Add the alias if exists
    const userAliases = personality.aliases?.[message.author.id];
    if (userAliases && userAliases.length > 0) {
      embed.addFields({ name: 'Your Aliases', value: userAliases.join(', '), inline: true });
    } else {
      embed.addFields({ name: 'Your Aliases', value: 'None set', inline: true });
    }

    // Add status field
    embed.addFields({
      name: 'Status',
      value: '✅ This personality is working normally.',
      inline: false,
    });

    // Add avatar if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    return await directSendFn({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in info command:', error);
    return await directSendFn(`An error occurred while getting personality info: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
