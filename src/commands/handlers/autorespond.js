/**
 * Autorespond Command Handler
 * Manages user auto-response preferences
 */
const _logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { botPrefix } = require('../../../config');
const conversationManager = require('../../conversationManager');

/**
 * Command metadata
 */
const meta = {
  name: 'autorespond',
  description: 'Toggle whether personalities continue responding to your messages automatically',
  usage: 'autorespond <on|off|status>',
  aliases: ['auto'],
  permissions: [],
};

/**
 * Helper functions for auto-response
 * These now delegate to conversationManager for persistent storage
 */
function isAutoResponseEnabled(userId) {
  return conversationManager.isAutoResponseEnabled(userId);
}

function enableAutoResponse(userId) {
  return conversationManager.enableAutoResponse(userId);
}

function disableAutoResponse(userId) {
  return conversationManager.disableAutoResponse(userId);
}

/**
 * Execute the autorespond command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Get the user ID
  const userId = message.author.id;

  // Check if the user provided a subcommand
  if (args.length < 1) {
    const currentSetting = isAutoResponseEnabled(userId);
    return await directSend(
      `Your auto-response setting is currently **${currentSetting ? 'ON' : 'OFF'}**.\n\n` +
        `Use \`${botPrefix} autorespond on\` to enable or \`${botPrefix} autorespond off\` to disable.`
    );
  }

  const subCommand = args[0].toLowerCase();

  if (subCommand === 'status') {
    const currentSetting = isAutoResponseEnabled(userId);
    return await directSend(
      `Your auto-response setting is currently **${currentSetting ? 'ON' : 'OFF'}**.`
    );
  }

  if (subCommand === 'on') {
    enableAutoResponse(userId);
    return message.reply(
      `**Auto-response enabled.** After mentioning or replying to a personality, it will continue responding to your messages in that channel without needing to tag it again.`
    );
  }

  if (subCommand === 'off') {
    disableAutoResponse(userId);
    return message.reply(
      `**Auto-response disabled.** Personalities will now only respond when you directly mention or reply to them.`
    );
  }

  // Invalid subcommand
  return await directSend(
    `Unknown subcommand: \`${subCommand}\`. Use \`${botPrefix} autorespond on\`, \`${botPrefix} autorespond off\`, or \`${botPrefix} autorespond status\`.`
  );
}

module.exports = {
  meta,
  execute,
  // Export helper functions for use by other modules
  isAutoResponseEnabled,
  enableAutoResponse,
  disableAutoResponse,
};
