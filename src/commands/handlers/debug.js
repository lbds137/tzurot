/**
 * Debug Command Handler
 * Advanced debugging tools for administrators
 */
const _logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'debug',
  description: 'Advanced debugging tools (Requires Administrator permission)',
  usage: 'debug <subcommand>',
  aliases: [],
  permissions: ['ADMINISTRATOR'],
};

/**
 * Execute the debug command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  // Check if the user provided a subcommand
  if (args.length < 1) {
    return await directSend(
      `You need to provide a subcommand. Usage: \`${botPrefix} debug <subcommand>\`\n\n` +
        `Available subcommands:\n` +
        `(No subcommands currently available)`
    );
  }

  const subCommand = args[0].toLowerCase();

  return await directSend(
    `Unknown debug subcommand: \`${subCommand}\`. Use \`${botPrefix} debug\` to see available subcommands.`
  );
}

module.exports = {
  meta,
  execute,
};
