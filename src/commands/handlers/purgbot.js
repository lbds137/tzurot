/**
 * Purgbot Command Handler
 * Purges bot messages from DM channels based on filters
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { EmbedBuilder } = require('discord.js');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'purgbot',
  description: 'Purge bot messages from your DM history',
  usage: 'purgbot [all|auth|chat|system]',
  aliases: ['purgebot', 'clearbot', 'cleandm', 'purgauth', 'purgeauth', 'clearauth'],
  permissions: []
};

// Message categories and their filter rules
const messageCategories = {
  // Authentication related messages
  auth: {
    keywords: [
      'Authentication Required',
      'Please click the link below to authenticate',
      'Authorization successful',
      'authorization code',
      'auth start',
      'auth code',
      'auth status',
      'auth revoke',
      'You have a valid authorization token',
      'token will expire soon'
    ],
    userCommands: [
      `${botPrefix} auth`,
      'auth code'
    ],
    description: 'authentication'
  },
  
  // Conversation/chat related messages
  chat: {
    keywords: [
      // Chat indicators
      'Thinking...',
      'is typing...',
      'continued their message',
      'is now talking'
    ],
    userCommands: [
      // Commands that trigger conversations
      `${botPrefix} chat`,
      `${botPrefix} ask`,
      `${botPrefix} talk`
    ],
    description: 'chat and conversation'
  },
  
  // System messages (status updates, errors, etc.)
  system: {
    keywords: [
      'An error occurred',
      'Status:',
      'Bot is',
      'Command not found',
      'Usage:',
      'is now available',
      'has been added',
      'has been removed',
      'Bot restarted'
    ],
    userCommands: [
      `${botPrefix} status`,
      `${botPrefix} info`,
      `${botPrefix} help`,
      `${botPrefix} list`
    ],
    description: 'system and status'
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
 * Filter messages based on category
 * @param {Collection} messages - Collection of Discord messages
 * @param {Object} message - Originating message
 * @param {string} category - Category to filter by (or 'all')
 * @returns {Map} Collection of messages to delete
 */
function filterMessagesByCategory(messages, message, category) {
  // Get the bot's user ID
  const botUserId = message.client.user.id;
  
  // Get current timestamp for age checks
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  
  // Filter bot messages by the specified category
  const botMessages = messages.filter(msg => {
    // Skip messages from other users
    if (msg.author.id !== botUserId) return false;
    
    // Skip very recent messages (less than 1 minute old)
    if (msg.createdTimestamp > now - (60 * 1000)) return false;
    
    // Always skip messages with preserve keywords
    if (preserveKeywords.some(keyword => 
      msg.content.includes(keyword) || 
      (msg.embeds[0]?.description && msg.embeds[0]?.description.includes(keyword))
    )) {
      return false;
    }
    
    // For "all" category, include all messages except those with preserve keywords
    if (category === 'all') return true;
    
    // Check if the message matches the category keywords
    const categoryKeywords = messageCategories[category]?.keywords || [];
    return categoryKeywords.some(keyword => 
      msg.content.includes(keyword) || 
      (msg.embeds[0]?.description && msg.embeds[0]?.description.includes(keyword))
    );
  });
  
  // Filter user messages related to the category
  const userMessages = messages.filter(msg => {
    // Skip messages from the bot
    if (msg.author.id !== message.author.id) return false;
    
    // Skip very recent messages (less than 1 minute old)
    if (msg.createdTimestamp > now - (60 * 1000)) return false;
    
    // For "all" category, include user commands to the bot
    if (category === 'all') {
      return msg.content.startsWith(botPrefix);
    }
    
    // Check if the message matches the category command patterns
    const categoryCommands = messageCategories[category]?.userCommands || [];
    return categoryCommands.some(command => msg.content.includes(command));
  });
  
  // Combine the two collections
  return new Map([...botMessages, ...userMessages]);
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
  let category = 'all'; // Default to all messages
  
  if (args.length > 0) {
    const requestedCategory = args[0].toLowerCase();
    if (['all', 'auth', 'chat', 'system'].includes(requestedCategory)) {
      category = requestedCategory;
    } else {
      return await directSend(
        `❌ Invalid category: \`${requestedCategory}\`\n\n` +
        `Available categories:\n` +
        `- \`all\` - All bot messages and your commands\n` +
        `- \`auth\` - Authentication related messages\n` +
        `- \`chat\` - Conversation related messages\n` +
        `- \`system\` - System status and info messages`
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
    const categoryDesc = category === 'all' ? 'bot' : messageCategories[category]?.description;
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