/**
 * Debug Command Handler
 * Advanced debugging tools for administrators
 */
const { PermissionFlagsBits } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { botPrefix } = require('../../../config');
const webhookUserTracker = require('../../utils/webhookUserTracker');
const { getNsfwVerificationManager } = require('../../core/authentication');

/**
 * Command metadata
 */
const meta = {
  name: 'debug',
  description: 'Advanced debugging tools (Requires Administrator permission)',
  usage: 'debug <subcommand>',
  aliases: [],
  permissions: [PermissionFlagsBits.Administrator],
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
        `• \`clearwebhooks\` - Clear cached webhook identifications\n` +
        `• \`unverify\` - Clear your NSFW verification status (for testing)`
    );
  }

  const subCommand = args[0].toLowerCase();

  switch (subCommand) {
    case 'clearwebhooks':
      webhookUserTracker.clearAllCachedWebhooks();
      logger.info(`[Debug] Webhook cache cleared by ${message.author.tag}`);
      return await directSend('✅ Cleared all cached webhook identifications.');

    case 'unverify': {
      const nsfwManager = getNsfwVerificationManager();
      const cleared = nsfwManager.clearVerification(message.author.id);
      
      if (cleared) {
        logger.info(`[Debug] NSFW verification cleared for ${message.author.tag}`);
        return await directSend('✅ Your NSFW verification has been cleared. You are now unverified.');
      } else {
        return await directSend('❌ You were not verified, so nothing was cleared.');
      }
    }

    default:
      return await directSend(
        `Unknown debug subcommand: \`${subCommand}\`. Use \`${botPrefix} debug\` to see available subcommands.`
      );
  }
}

module.exports = {
  meta,
  execute,
};
