/**
 * Purgbot Command Handler
 * Purges bot messages from DM channels based on filters
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { EmbedBuilder } = require('discord.js');
const { botPrefix } = require('../../../config');
const personalityManager = require('../../personalityManager');

/**
 * Command metadata
 */
const meta = {
  name: 'purgbot',
  description: 'Purge bot messages from your DM history',
  usage: 'purgbot [system|all]',
  aliases: ['purgebot', 'clearbot', 'cleandm'],
  permissions: []
};

// Message categories and their filter rules
const messageCategories = {
  // System messages (all non-personality bot messages)
  system: {
    description: 'system and command',
    isPersonalityMessage: false,
    userCommands: [
      // Commands to the bot (not personalities)
      `${botPrefix} `
    ]
  },
  
  // All messages (both personality and system)
  all: {
    description: 'all bot',
    isAllMessages: true
  }
};

// Important messages that should never be deleted
const preserveKeywords = [
  // Important configuration/setup information
  'API key has been set',
  'Setup complete',
  'Important information:',
  // User data
  'Your data has been exported',
  'Backup created',
  // Recent (within last hour) status messages
  'Current status as of'
];

/**
 * Check if a message is from a personality
 * @param {Object} msg - Discord message object
 * @returns {boolean} True if the message appears to be from a personality
 */
function isPersonalityMessage(msg) {
  // For DM channels, personalities have message content starting with a name pattern like **Name:**
  if (msg.content) {
    // Look for **Name:** pattern which is the standard format for personality messages in DMs
    if (msg.content.match(/^\*\*[^*]+:\*\*/)) {
      return true;
    }
  }
  
  // Also check for webhooks which are used in guild channels
  if (msg.webhookId) {
    return true;
  }
  
  // If message has personality name in username (for webhooks in guild channels)
  if (msg.author && msg.author.username) {
    try {
      // Check if this message username matches any personality
      const allPersonalities = personalityManager.listPersonalitiesForUser();
      const personalityNames = allPersonalities.map(p => p.displayName || p.fullName);
      
      // Check if message author matches a personality name
      return personalityNames.some(name => 
        msg.author.username.includes(name)
      );
    } catch (error) {
      logger.warn(`[PurgBot] Error checking personality names: ${error.message}`);
    }
  }
  
  // Check simple content patterns
  const personalityPhrases = [
    'Thinking...',
    'is typing',
    'continued their message',
    'said:',
    'responds:'
  ];
  
  return personalityPhrases.some(phrase => msg.content?.includes(phrase));
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
  const now = Date.now();
  
  // Filter bot messages by the specified category
  const botMessages = messages.filter(msg => {
    // Skip messages from other users
    if (msg.author.id !== botUserId) return false;
    
    // Skip very recent messages (less than 1 minute old)
    if (msg.createdTimestamp > now - (60 * 1000)) return false;
    
    // Always skip messages with preserve keywords
    if (preserveKeywords.some(keyword => 
      msg.content?.includes(keyword) || 
      (msg.embeds[0]?.description && msg.embeds[0]?.description.includes(keyword))
    )) {
      return false;
    }
    
    // For "all" category, include all messages except those with preserve keywords
    if (category === 'all') return true;
    
    // Check if this is a personality message
    const fromPersonality = isPersonalityMessage(msg);
    
    // These lines are removed as we no longer have a chat category
    
    // For "system" category, exclude personality messages
    if (category === 'system') return !fromPersonality;
    
    // Default to false for unknown categories
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
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  const directSend = validator.createDirectSend(message);
  
  // This command is only available in DMs for security
  if (!message.channel.isDMBased()) {
    return await directSend('⚠️ This command can only be used in DM channels for security reasons.');
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
    logger.info(`[PurgBot] Fetched ${messages.size} messages in DM channel for user ${message.author.id}`);
    
    // Filter messages based on the requested category
    const messagesToDelete = filterMessagesByCategory(messages, message, category);
    logger.info(`[PurgBot] Found ${messagesToDelete.size} messages to delete in category '${category}'`);
    
    if (messagesToDelete.size === 0) {
      const categoryDesc = category === 'all' ? 'bot' : messageCategories[category]?.description || category;
      return await directSend(`No ${categoryDesc} messages found to purge.`);
    }
    
    // Create a status message with the category being purged
    const categoryDesc = messageCategories[category]?.description || 'bot';
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
        await new Promise(resolve => setTimeout(resolve, 100));
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
      .setFooter({ text: 'Your DM channel is now cleaner! This message will self-destruct in 30 seconds.' });
    
    // Update the status message with the result
    const updatedMessage = await statusMessage.edit({ content: '', embeds: [embed] });
    
    // Schedule the message to self-destruct after 30 seconds
    // Use a function that is easier to mock in tests
    const selfDestruct = async () => {
      try {
        await updatedMessage.delete();
        logger.info(`[PurgBot] Self-destructed cleanup summary message for user ${message.author.id}`);
      } catch (error) {
        logger.warn(`[PurgBot] Failed to self-destruct cleanup summary: ${error.message}`);
      }
    };
    
    // In testing environments, use a mock and call immediately to avoid timeouts
    if (process.env.NODE_ENV === 'test') {
      // For tests, make this available on the message for immediate testing
      updatedMessage.selfDestruct = selfDestruct;
    } else {
      // In real environment, use setTimeout
      setTimeout(selfDestruct, 30000);
    }
    
    return updatedMessage;
    
  } catch (error) {
    logger.error(`[PurgBot] Error purging messages: ${error.message}`);
    return await directSend(`❌ An error occurred while purging messages: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute
};