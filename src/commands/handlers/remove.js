/**
 * Remove Command Handler
 * Removes a personality from the user's collection
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const {
  getPersonality,
  getPersonalityByAlias,
  removePersonality,
} = require('../../personalityManager');
const { botPrefix } = require('../../../config');
const { deleteFromCache } = require('../../profileInfoFetcher');

/**
 * Command metadata
 */
const meta = {
  name: 'remove',
  description: 'Remove a personality from your collection',
  usage: 'remove <personality-name>',
  aliases: ['delete'],
  permissions: [],
};

/**
 * Execute the remove command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @param {Object} context - Command context with injectable dependencies
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args, context = {}) {
  // Use injected messageTracker if available, otherwise create local instance
  const { messageTracker = null } = context;
  const tracker =
    messageTracker ||
    (() => {
      const MessageTracker = require('../utils/messageTracker');
      return new MessageTracker();
    })();
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name. Usage: \`${botPrefix} ${meta.usage}\``
    );
  }

  // Extract the personality name
  const personalityName = args[0].toLowerCase();

  try {
    // Try to find the personality first to get a displayName for the confirmation message
    let personality = null;

    // First check if this is an alias
    personality = getPersonalityByAlias(message.author.id, personalityName);

    // If not found by alias, try the direct name
    if (!personality) {
      personality = getPersonality(personalityName);
    }

    if (!personality) {
      return await directSend(
        `Personality "${personalityName}" not found. Please check the name or alias and try again.`
      );
    }

    // Check if this personality belongs to the user
    if (personality.createdBy && personality.createdBy !== message.author.id) {
      return await directSend(`You cannot remove a personality that you didn't create.`);
    }

    // Remove the personality
    const result = await removePersonality(message.author.id, personality.fullName);

    // If we get an error, return it
    if (result && result.error) {
      return await directSend(result.error);
    }

    if (result === false) {
      return await directSend(
        `Failed to remove the personality. It may not exist or you may not have permission.`
      );
    }

    // Clear the profile info cache for this personality
    deleteFromCache(personality.fullName);
    logger.info(`[RemoveCommand] Cleared profile cache for: ${personality.fullName}`);

    // Clear the completed add command tracking to allow immediate re-adding
    tracker.removeCompletedAddCommand(message.author.id, personalityName);
    logger.info(
      `[RemoveCommand] Cleared add command tracking for ${message.author.id}-${personalityName}`
    );

    // Also try clearing with the full name in case that was used instead
    if (personality.fullName !== personalityName) {
      tracker.removeCompletedAddCommand(message.author.id, personality.fullName);
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Personality Removed')
      .setDescription(
        `**${personality.displayName || personality.fullName}** has been removed from your collection.`
      )
      .setColor(0xf44336);

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in remove command:', error);
    return await directSend(`An error occurred while removing the personality: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
