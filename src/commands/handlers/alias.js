/**
 * Alias Command Handler
 * Adds an alias/nickname for an existing personality
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { getPersonality, setPersonalityAlias } = require('../../core/personality');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'alias',
  description: 'Add an alias/nickname for an existing personality',
  usage: 'alias <personality-name> <new-alias>',
  aliases: [],
  permissions: [],
};

/**
 * Execute the alias command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 2) {
    return await directSend(
      `You need to provide a personality name and an alias. Usage: \`${botPrefix} ${meta.usage}\``
    );
  }

  // Extract the personality name and alias
  const personalityName = args[0].toLowerCase();
  // Join all remaining arguments to support multi-word aliases
  const alias = args.slice(1).join(' ').toLowerCase();

  try {
    // Find the personality first
    const personality = await getPersonality(personalityName);

    if (!personality) {
      return await directSend(
        `Personality "${personalityName}" not found. Please check the name and try again.`
      );
    }

    // Set the alias
    const result = await setPersonalityAlias(alias, personalityName);

    if (result.error) {
      return await directSend(result.error);
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Alias Added')
      .setDescription(`An alias has been set for **${personalityName}**.`)
      .setColor(0x4caf50)
      .addFields(
        { name: 'Full Name', value: personalityName, inline: true },
        { name: 'Alias', value: alias, inline: true }
      );

    // Add avatar if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in alias command:', error);
    return await directSend(`An error occurred while setting the alias: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
