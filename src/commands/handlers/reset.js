/**
 * Reset Command Handler
 * Resets conversation with a personality
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { clearConversation } = require('../../core/conversation');
const personalityManager = require('../../core/personality');

/**
 * Command metadata
 */
const meta = {
  name: 'reset',
  description: 'Reset your conversation with a personality',
  usage: 'reset <personality-name-or-alias>',
  aliases: [],
  permissions: [],
};

/**
 * Execute the reset command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if the user provided a personality name
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name or alias. Usage: \`${meta.usage}\``
    );
  }

  // Extract the personality name or alias
  const personalityInput = args[0].toLowerCase();

  try {
    // Try to find the personality (first by alias, then by name)
    let personality = personalityManager.getPersonalityByAlias(personalityInput);

    if (!personality) {
      personality = await personalityManager.getPersonality(personalityInput);
    }

    if (!personality) {
      return await directSend(
        `Personality "${personalityInput}" not found. Please check the name or alias and try again.`
      );
    }

    // Clear the conversation for this personality in this channel
    clearConversation(message.author.id, message.channel.id, personality.fullName);

    return await directSend(
      `Conversation with **${personality.displayName || personality.fullName}** has been reset in this channel.`
    );
  } catch (error) {
    logger.error('Error in handleResetCommand:', error);
    return await directSend(`An error occurred while resetting the conversation: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
