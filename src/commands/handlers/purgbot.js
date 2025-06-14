/**
 * Purgbot Command Handler
 * Purges bot messages from DM channels based on filters
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { EmbedBuilder } = require('discord.js');
const { botPrefix } = require('../../../config');
const _personalityManager = require('../../core/personality');

/**
 * Command metadata
 */
const meta = {
  name: 'purgbot',
  description: 'Purge bot messages from your DM history',
  usage: 'purgbot [system|all]',
  aliases: ['purgebot', 'clearbot', 'cleandm'],
  permissions: [],
};

// Message categories and their filter rules
const _messageCategories = {
  // System messages (all non-personality bot messages)
  system: {
    description: 'system and command',
    isPersonalityMessage: false,
    userCommands: [
      // Commands to the bot (not personalities)
      `${botPrefix} `,
    ],
  },

  // All messages (both personality and system)
  all: {
    description: 'all bot',
    isAllMessages: true,
  },
};

// No special preservation keywords - all bot messages can be deleted

/**
 * Check if a message is from a personality
 * @param {Object} msg - Discord message object
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
 * @param {Collection} messages - Collection of Discord messages
 * @param {Object} message - Originating message
 * @param {string} category - Category to filter by
 * @returns {Map} Collection of messages to delete
 */
function filterMessagesByCategory(messages, message, category) {
  // Get the bot's user ID
  const botUserId = message.client.user.id;

  // Get current timestamp for age checks
  const _now = Date.now();

  // Filter bot messages by the specified category
  const botMessages = messages.filter(msg => {
    // Log which message we're examining
    logger.info(`[PurgBot] Examining message ${msg.id} for deletion criteria`);

    // Skip messages from other users
    if (!msg.author || msg.author.id !== botUserId) {
      logger.info(
        `[PurgBot] Message ${msg.id} skipped: not from the bot (author ID: ${msg.author?.id || 'unknown'})`
      );
      return false;
    }

    // Skip the command message itself to avoid race conditions
    if (msg.id === message.id) {
      logger.info(`[PurgBot] Message ${msg.id} skipped: this is the command message itself`);
      return false;
    }

    // Skip the originating message in case it's included in the fetched messages
    // This prevents a race condition where the command message deletes itself

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
        `[PurgBot] Message ${msg.id} ${shouldDelete ? 'will be deleted' : 'skipped'}: ${shouldDelete ? 'not a' : 'is a'} personality message (category: system)`
      );
      return shouldDelete;
    }

    // Default to false for unknown categories
    logger.info(`[PurgBot] Message ${msg.id} skipped: unknown category '${category}'`);
    return false;
  });

  // Note: We can't delete user messages in DMs due to Discord API limitations
  // Only return bot messages that the bot can delete
  return botMessages;
}

/**
 * Execute the purgbot command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @param {Object} context - Command context with injectable dependencies
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args, context = {}) {
  // Use default timers if context not provided (backward compatibility)
  const {
    scheduler = globalThis.setTimeout || setTimeout,
    delay = ms => {
      const timer = globalThis.setTimeout || setTimeout;
      return new Promise(resolve => timer(resolve, ms));
    },
  } = context;
  const directSend = validator.createDirectSend(message);

  // This command is only available in DMs for security
  if (!message.channel.isDMBased()) {
    return await directSend(
      '⚠️ This command can only be used in DM channels for security reasons.'
    );
  }

  // Determine which category to purge
  let category = 'system'; // Default to system messages (non-personality)

  if (args.length > 0) {
    const requestedCategory = args[0].toLowerCase();
    if (['system', 'all'].includes(requestedCategory)) {
      category = requestedCategory;
    } else {
      return await directSend(
        `❌ Invalid category: \`${requestedCategory}\`\n\n` +
          `Available categories:\n` +
          `- \`system\` - System messages and bot responses (default)\n` +
          `- \`all\` - All bot messages including personalities`
      );
    }
  }

  try {
    // Show typing indicator while processing
    message.channel.sendTyping().catch(() => {});

    // Fetch recent messages in the DM channel (100 is the limit)
    const messages = await message.channel.messages.fetch({ limit: 100 });
    logger.info(
      `[PurgBot] Fetched ${messages.size} messages in DM channel for user ${message.author.id}`
    );

    // Log the message contents before filtering
    logger.info(`[PurgBot] Examining messages in DM:`);
    for (const [id, msg] of messages.entries()) {
      const preview = msg.content ? msg.content.substring(0, 30) : 'No content';
      logger.info(
        `[PurgBot] Message ${id} from ${msg.author?.username || 'unknown'}: ${preview}${msg.content && msg.content.length > 30 ? '...' : ''}`
      );
    }

    // Filter messages based on the requested category
    const messagesToDelete = filterMessagesByCategory(messages, message, category);
    logger.info(
      `[PurgBot] Found ${messagesToDelete.size} messages to delete in category '${category}'`
    );

    if (messagesToDelete.size === 0) {
      const categoryDesc =
        category === 'all' ? 'bot' : category === 'system' ? 'system and command' : category;
      return await directSend(`No ${categoryDesc} messages found to purge.`);
    }

    // Create a status message with the category being purged
    const categoryDesc =
      category === 'all' ? 'all bot' : category === 'system' ? 'system and command' : category;
    const statusMessage = await directSend(`🧹 Purging ${categoryDesc} messages...`);

    // Delete each message
    let deletedCount = 0;
    let failedCount = 0;

    for (const [id, msg] of messagesToDelete) {
      // Skip the status message itself
      if (id === statusMessage.id) continue;

      try {
        await msg.delete();
        deletedCount++;

        // Add small delay between deletions to avoid rate limits
        await delay(100);
      } catch (deleteErr) {
        logger.warn(`[PurgBot] Failed to delete message ${id}: ${deleteErr.message}`);
        failedCount++;
      }
    }

    // Create an embed with the results
    const embed = new EmbedBuilder()
      .setTitle('Bot Message Cleanup')
      .setDescription(`Completed purging ${categoryDesc} messages from your DM history.`)
      .setColor(0x4caf50)
      .addFields(
        { name: 'Messages Deleted', value: `${deletedCount}`, inline: true },
        { name: 'Messages Failed', value: `${failedCount}`, inline: true }
      )
      .setFooter({
        text: 'Your DM channel is now cleaner! This message will self-destruct in 10 seconds.',
      });

    // Update the status message with the result
    const updatedMessage = await statusMessage.edit({ content: '', embeds: [embed] });

    // Schedule the message to self-destruct after 30 seconds
    // Use a function that is easier to mock in tests
    const selfDestruct = async () => {
      try {
        await updatedMessage.delete();
        logger.info(
          `[PurgBot] Self-destructed cleanup summary message for user ${message.author.id}`
        );
      } catch (error) {
        logger.warn(`[PurgBot] Failed to self-destruct cleanup summary: ${error.message}`);
      }
    };

    // Schedule self-destruction after 10 seconds
    scheduler(selfDestruct, 10000);

    return updatedMessage;
  } catch (error) {
    logger.error(`[PurgBot] Error purging messages: ${error.message}`);
    return await directSend(`❌ An error occurred while purging messages: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
