/**
 * Purgbot Command - Purge bot messages from DM channels
 *
 * Allows users to clean up bot messages from their DM conversations,
 * with options to remove system messages only or all bot messages.
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Check if a message is from a personality
 * @param {Object} msg - Message object
 * @returns {boolean} True if the message appears to be from a personality
 */
function isPersonalityMessage(msg) {
  // For DM channels, personalities have message content starting with a name pattern like **Name:**
  if (msg.content && msg.content.match(/^\*\*[^*]+:\*\*/)) {
    logger.info(`[PurgBot] Message ${msg.id} is a personality message - matches **Name:** pattern`);
    return true;
  }

  // Message is not from a personality
  logger.info(
    `[PurgBot] Message ${msg.id} from ${msg.author?.username || 'unknown'} is NOT a personality message`
  );
  return false;
}

/**
 * Filter messages based on category
 * @param {Array} messages - Array of messages
 * @param {string} botId - Bot user ID
 * @param {string} commandMessageId - ID of the command message to exclude
 * @param {string} category - Category to filter by
 * @returns {Array} Messages to delete
 */
function filterMessagesByCategory(messages, botId, commandMessageId, category) {
  // Filter bot messages by the specified category
  const botMessages = messages.filter(msg => {
    // Log which message we're examining
    logger.info(`[PurgBot] Examining message ${msg.id} for deletion criteria`);

    // Skip messages from other users
    if (!msg.author || msg.author.id !== botId) {
      logger.info(
        `[PurgBot] Message ${msg.id} skipped: not from the bot (author ID: ${msg.author?.id || 'unknown'})`
      );
      return false;
    }

    // Skip the command message itself to avoid race conditions
    if (msg.id === commandMessageId) {
      logger.info(`[PurgBot] Message ${msg.id} skipped: this is the command message itself`);
      return false;
    }

    // For "all" category, include all remaining bot messages
    if (category === 'all') {
      logger.info(`[PurgBot] Message ${msg.id} will be deleted: matches 'all' category`);
      return true;
    }

    // For "system" category, exclude personality messages
    if (category === 'system') {
      const fromPersonality = isPersonalityMessage(msg);
      const shouldDelete = !fromPersonality;
      logger.info(
        `[PurgBot] Message ${msg.id} ${shouldDelete ? 'will be deleted' : 'skipped'}: ${
          shouldDelete ? 'not a' : 'is a'
        } personality message (category: system)`
      );
      return shouldDelete;
    }

    // Default to false for unknown categories
    logger.info(`[PurgBot] Message ${msg.id} skipped: unknown category '${category}'`);
    return false;
  });

  return botMessages;
}

/**
 * Creates the executor function for the purgbot command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  // Default timer functions if not injected
  const {
    delayFn = ms =>
      new Promise(resolve => {
        const timer = globalThis.setTimeout || (() => {});
        timer(resolve, ms);
      }),
    scheduleFn = globalThis.setTimeout || (() => {}),
  } = dependencies;

  return async function execute(context) {
    try {
      // This command is only available in DMs for security
      if (!context.isDM()) {
        await context.respond(
          '⚠️ This command can only be used in DM channels for security reasons.'
        );
        return;
      }

      // Get category from args or options
      const category = context.options.category || context.args[0]?.toLowerCase() || 'system';

      // Validate category
      if (!['system', 'all'].includes(category)) {
        await context.respond(
          `❌ Invalid category: \`${category}\`\n\n` +
            `Available categories:\n` +
            `- \`system\` - System messages and bot responses (default)\n` +
            `- \`all\` - All bot messages including personalities`
        );
        return;
      }

      // Platform-specific implementation
      if (context.platform === 'discord') {
        await handleDiscordPurge(context, category, { ...dependencies, delayFn, scheduleFn });
      } else {
        await context.respond('This command is not yet implemented for this platform.');
      }
    } catch (error) {
      logger.error('[PurgbotCommand] Execution failed:', error);
      await context.respond('An error occurred while purging messages.');
    }
  };
}

async function handleDiscordPurge(context, category, dependencies = {}) {
  try {
    // Get Discord-specific objects
    const channel = context.message?.channel || context.channel;
    const botId = context.message?.client?.user?.id;

    if (!channel || !botId) {
      await context.respond('Unable to access channel information.');
      return;
    }

    // Show typing indicator
    channel.sendTyping().catch(() => {});

    // Fetch recent messages
    const messages = await channel.messages.fetch({ limit: 100 });
    logger.info(
      `[PurgBot] Fetched ${messages.size} messages in DM channel for user ${context.userId}`
    );

    // Convert Discord collection to array for filtering
    const messageArray = Array.from(messages.values());

    // Filter messages based on category
    const messagesToDelete = filterMessagesByCategory(
      messageArray,
      botId,
      context.message?.id,
      category
    );

    logger.info(
      `[PurgBot] Found ${messagesToDelete.length} messages to delete in category '${category}'`
    );

    if (messagesToDelete.length === 0) {
      const categoryDesc =
        category === 'all' ? 'bot' : category === 'system' ? 'system and command' : category;
      await context.respond(`No ${categoryDesc} messages found to purge.`);
      return;
    }

    // Create status message
    const categoryDesc =
      category === 'all' ? 'all bot' : category === 'system' ? 'system and command' : category;
    const statusMessage = await context.respond(`🧹 Purging ${categoryDesc} messages...`);

    // Delete messages
    let deletedCount = 0;
    let failedCount = 0;

    for (const msg of messagesToDelete) {
      // Skip the status message itself
      if (msg.id === statusMessage?.id) continue;

      try {
        await msg.delete();
        deletedCount++;

        // Small delay to avoid rate limits
        await dependencies.delayFn(100);
      } catch (deleteErr) {
        logger.warn(`[PurgBot] Failed to delete message ${msg.id}: ${deleteErr.message}`);
        failedCount++;
      }
    }

    // Update status with results
    if (context.respondWithEmbed && statusMessage) {
      const embed = {
        title: 'Bot Message Cleanup',
        description: `Completed purging ${categoryDesc} messages from your DM history.`,
        color: 0x4caf50,
        fields: [
          { name: 'Messages Deleted', value: `${deletedCount}`, inline: true },
          { name: 'Messages Failed', value: `${failedCount}`, inline: true },
        ],
        footer: {
          text: 'Your DM channel is now cleaner! This message will self-destruct in 10 seconds.',
        },
      };

      await statusMessage.edit({ content: '', embeds: [embed] });

      // Schedule self-destruct
      dependencies.scheduleFn(async () => {
        try {
          await statusMessage.delete();
          logger.info(`[PurgBot] Self-destructed cleanup summary for user ${context.userId}`);
        } catch (error) {
          logger.warn(`[PurgBot] Failed to self-destruct: ${error.message}`);
        }
      }, 10000);
    } else {
      // Text-only update
      const resultMessage =
        `✅ Cleanup complete!\n` +
        `Deleted: ${deletedCount} messages\n` +
        `Failed: ${failedCount} messages`;

      if (statusMessage) {
        await statusMessage.edit(resultMessage);
      } else {
        await context.respond(resultMessage);
      }
    }
  } catch (error) {
    logger.error(`[PurgBot] Error during Discord purge: ${error.message}`);
    await context.respond(`❌ An error occurred while purging messages: ${error.message}`);
  }
}

/**
 * Factory function to create the purgbot command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The purgbot command instance
 */
function createPurgbotCommand(dependencies = {}) {
  return new Command({
    name: 'purgbot',
    description: 'Purge bot messages from your DM history',
    category: 'Utility',
    aliases: ['purgebot', 'clearbot', 'cleandm'],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'category',
        description: 'Type of messages to purge',
        type: 'string',
        required: false,
        choices: [
          { name: 'System messages only (default)', value: 'system' },
          { name: 'All bot messages', value: 'all' },
        ],
      }),
    ],
    execute: createExecutor(dependencies),
  });
}

module.exports = {
  createPurgbotCommand,
  // Export for testing
  isPersonalityMessage,
  filterMessagesByCategory,
};
