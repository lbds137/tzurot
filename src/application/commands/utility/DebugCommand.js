/**
 * Debug Command - Advanced debugging tools for administrators
 * 
 * Provides various debugging utilities for clearing caches, resetting states,
 * and gathering system statistics. Admin-only command for troubleshooting.
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Creates the executor function for the debug command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      // Admin check
      if (!context.isAdmin) {
        await context.respond('This command requires administrator permissions.');
        return;
      }

      const {
        webhookUserTracker = require('../../../utils/webhookUserTracker'),
        nsfwVerificationManager = require('../../../core/authentication').getNsfwVerificationManager(),
        conversationManager = require('../../../core/conversation'),
        authManager = require('../../../auth').getAuthManager(),
        messageTracker = require('../../../messageTracker').messageTracker,
      } = dependencies;

      // Get subcommand from args or options
      const subcommand = context.options.subcommand || context.args[0]?.toLowerCase();

      if (!subcommand) {
        return await showHelp(context);
      }

      switch (subcommand) {
        case 'clearwebhooks':
          return await clearWebhooks(context, webhookUserTracker);

        case 'unverify':
          return await unverify(context, nsfwVerificationManager);

        case 'clearconversation':
          return await clearConversation(context, conversationManager);

        case 'clearauth':
          return await clearAuth(context, authManager);

        case 'clearmessages':
          return await clearMessages(context, messageTracker);

        case 'stats':
          return await showStats(context, {
            webhookUserTracker,
            messageTracker,
            authManager,
          });

        default:
          await context.respond(
            `Unknown debug subcommand: \`${subcommand}\`. Use \`${context.commandPrefix}debug\` to see available subcommands.`
          );
      }
    } catch (error) {
      logger.error('[DebugCommand] Execution failed:', error);
      await context.respond('An error occurred while executing the debug command.');
    }
  };
}

async function showHelp(context) {
  const helpText = `You need to provide a subcommand. Usage: \`${context.commandPrefix}debug <subcommand>\`

Available subcommands:
• \`clearwebhooks\` - Clear cached webhook identifications
• \`unverify\` - Clear your NSFW verification status
• \`clearconversation\` - Clear your conversation history
• \`clearauth\` - Clear your authentication tokens
• \`clearmessages\` - Clear message tracking history
• \`stats\` - Show debug statistics`;

  await context.respond(helpText);
}

async function clearWebhooks(context, webhookUserTracker) {
  webhookUserTracker.clearAllCachedWebhooks();
  logger.info(`[Debug] Webhook cache cleared by ${context.userTag}`);
  await context.respond('✅ Cleared all cached webhook identifications.');
}

async function unverify(context, nsfwVerificationManager) {
  const cleared = nsfwVerificationManager.clearVerification(context.userId);

  if (cleared) {
    logger.info(`[Debug] NSFW verification cleared for ${context.userTag}`);
    await context.respond('✅ Your NSFW verification has been cleared. You are now unverified.');
  } else {
    await context.respond('❌ You were not verified, so nothing was cleared.');
  }
}

async function clearConversation(context, conversationManager) {
  try {
    // Clear conversation for all personalities in current channel
    conversationManager.clearConversation(context.userId, context.channelId);
    logger.info(
      `[Debug] Conversation history cleared for ${context.userTag} in channel ${context.channelId}`
    );
    await context.respond('✅ Cleared your conversation history in this channel.');
  } catch (error) {
    logger.error(`[Debug] Error clearing conversation: ${error.message}`);
    await context.respond('❌ Failed to clear conversation history.');
  }
}

async function clearAuth(context, authManager) {
  try {
    // Clean up expired auth tokens
    await authManager.cleanupExpiredTokens();
    logger.info(`[Debug] Authentication tokens cleaned up for ${context.userTag}`);
    await context.respond(
      '✅ Cleaned up authentication tokens. You may need to re-authenticate.'
    );
  } catch (error) {
    logger.error(`[Debug] Error clearing auth: ${error.message}`);
    await context.respond('❌ Failed to clear authentication.');
  }
}

async function clearMessages(context, messageTracker) {
  try {
    messageTracker.clear();
    logger.info(`[Debug] Message tracking history cleared by ${context.userTag}`);
    await context.respond('✅ Cleared message tracking history.');
  } catch (error) {
    logger.error(`[Debug] Error clearing message tracker: ${error.message}`);
    await context.respond('❌ Failed to clear message tracking.');
  }
}

async function showStats(context, dependencies) {
  try {
    const { webhookUserTracker, messageTracker, authManager } = dependencies;

    // Gather various statistics
    const stats = {
      webhooks: {
        tracked: 'Not available', // webhookUserTracker doesn't expose a count method
      },
      messages: {
        tracked: messageTracker.size || 0,
      },
      auth: {
        hasManager: !!authManager,
      },
    };

    const statsText = `📊 **Debug Statistics**\n\`\`\`json\n${JSON.stringify(
      stats,
      null,
      2
    )}\n\`\`\``;
    await context.respond(statsText);
  } catch (error) {
    logger.error(`[Debug] Error gathering stats: ${error.message}`);
    await context.respond('❌ Failed to gather statistics.');
  }
}

/**
 * Factory function to create the debug command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The debug command instance
 */
function createDebugCommand(dependencies = {}) {
  const command = new Command({
    name: 'debug',
    description: 'Advanced debugging tools (Requires Administrator permission)',
    category: 'Utility',
    aliases: [],
    permissions: ['ADMIN'],
    options: [
      new CommandOption({
        name: 'subcommand',
        description: 'Debug action to perform',
        type: 'string',
        required: false,
        choices: [
          { name: 'Clear cached webhooks', value: 'clearwebhooks' },
          { name: 'Clear NSFW verification', value: 'unverify' },
          { name: 'Clear conversation history', value: 'clearconversation' },
          { name: 'Clear authentication tokens', value: 'clearauth' },
          { name: 'Clear message tracking', value: 'clearmessages' },
          { name: 'Show debug statistics', value: 'stats' },
        ],
      }),
    ],
    execute: createExecutor(dependencies),
  });
  
  // Add adminOnly property for backward compatibility
  command.adminOnly = true;
  
  return command;
}

module.exports = {
  createDebugCommand,
};