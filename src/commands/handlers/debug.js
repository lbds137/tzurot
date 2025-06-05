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
const { clearConversation } = require('../../core/conversation');
const auth = require('../../auth');
const { messageTracker } = require('../../messageTracker');

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
        `• \`unverify\` - Clear your NSFW verification status\n` +
        `• \`clearconversation\` - Clear your conversation history\n` +
        `• \`clearauth\` - Clear your authentication tokens\n` +
        `• \`clearmessages\` - Clear message tracking history\n` +
        `• \`stats\` - Show debug statistics`
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

    case 'clearconversation': {
      try {
        // Clear conversation for all personalities in current channel
        clearConversation(message.author.id, message.channel.id);
        logger.info(`[Debug] Conversation history cleared for ${message.author.tag} in channel ${message.channel.id}`);
        return await directSend('✅ Cleared your conversation history in this channel.');
      } catch (error) {
        logger.error(`[Debug] Error clearing conversation: ${error.message}`);
        return await directSend('❌ Failed to clear conversation history.');
      }
    }

    case 'clearauth': {
      try {
        // Clean up expired auth tokens
        await auth.cleanupExpiredTokens();
        logger.info(`[Debug] Authentication tokens cleaned up for ${message.author.tag}`);
        return await directSend('✅ Cleaned up authentication tokens. You may need to re-authenticate.');
      } catch (error) {
        logger.error(`[Debug] Error clearing auth: ${error.message}`);
        return await directSend('❌ Failed to clear authentication.');
      }
    }

    case 'clearmessages': {
      try {
        messageTracker.clear();
        logger.info(`[Debug] Message tracking history cleared by ${message.author.tag}`);
        return await directSend('✅ Cleared message tracking history.');
      } catch (error) {
        logger.error(`[Debug] Error clearing message tracker: ${error.message}`);
        return await directSend('❌ Failed to clear message tracking.');
      }
    }

    case 'stats': {
      try {
        // Gather various statistics
        const stats = {
          webhooks: {
            tracked: 'Not available' // webhookUserTracker doesn't expose a count method
          },
          messages: {
            tracked: messageTracker.size
          },
          auth: {
            hasManager: !!auth.getAuthManager()
          }
        };
        
        const statsText = `📊 **Debug Statistics**\n\`\`\`json\n${JSON.stringify(stats, null, 2)}\n\`\`\``;
        return await directSend(statsText);
      } catch (error) {
        logger.error(`[Debug] Error gathering stats: ${error.message}`);
        return await directSend('❌ Failed to gather statistics.');
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
