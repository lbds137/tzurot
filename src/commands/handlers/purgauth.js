/**
 * Purgauth Command Handler
 * Purges authentication messages from DM channels
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { EmbedBuilder } = require('discord.js');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'purgauth',
  description: 'Purge authentication messages from your DM history',
  usage: 'purgauth',
  aliases: ['purgeauth', 'clearauth'],
  permissions: []
};

/**
 * Execute the purgauth command
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
  
  try {
    // Show typing indicator while processing
    message.channel.sendTyping().catch(() => {});
    
    // Fetch recent messages in the DM channel (100 is the limit)
    const messages = await message.channel.messages.fetch({ limit: 100 });
    logger.info(`[PurgAuth] Fetched ${messages.size} messages in DM channel for user ${message.author.id}`);
    
    // Filter for bot messages related to authentication
    const authKeywords = [
      'Authentication Required',
      'Please click the link below to authenticate',
      'Authorization successful',
      'authorization code',
      'auth start',
      'auth code',
      'auth status',
      'auth revoke',
      'You have a valid authorization token'
    ];
    
    const authMessages = messages.filter(msg => {
      // Only delete messages from the bot
      if (msg.author.id !== message.client.user.id) return false;
      
      // Check if the message contains any auth keywords
      return authKeywords.some(keyword => 
        msg.content.includes(keyword) || 
        (msg.embeds[0]?.description && msg.embeds[0].description.includes(keyword))
      );
    });
    
    // Also find user messages that might contain auth commands or codes
    const userAuthMessages = messages.filter(msg => {
      // Only look at user messages
      if (msg.author.id !== message.author.id) return false;
      
      // Check for auth command patterns
      return (
        msg.content.startsWith(`${botPrefix} auth`) || 
        msg.content.includes('auth code')
      );
    });
    
    // Combine the two collections
    const messagesToDelete = new Map([...authMessages, ...userAuthMessages]);
    logger.info(`[PurgAuth] Found ${messagesToDelete.size} auth-related messages to delete`);
    
    if (messagesToDelete.size === 0) {
      return await directSend('No authentication messages found to purge.');
    }
    
    // Delete each message
    let deletedCount = 0;
    let failedCount = 0;
    
    // Create a status message that we'll exempt from deletion
    const statusMessage = await directSend('🧹 Purging authentication messages...');
    
    for (const [id, msg] of messagesToDelete) {
      // Skip the status message itself
      if (id === statusMessage.id) continue;
      
      try {
        await msg.delete();
        deletedCount++;
        
        // Add small delay between deletions to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (deleteErr) {
        logger.warn(`[PurgAuth] Failed to delete message ${id}: ${deleteErr.message}`);
        failedCount++;
      }
    }
    
    // Create a embed with the results
    const embed = new EmbedBuilder()
      .setTitle('Authentication Message Cleanup')
      .setDescription(`Completed purging authentication messages from your DM history.`)
      .setColor(0x4caf50)
      .addFields(
        { name: 'Messages Deleted', value: `${deletedCount}`, inline: true },
        { name: 'Messages Failed', value: `${failedCount}`, inline: true }
      )
      .setFooter({ text: 'Your DM channel is now cleaner!' });
    
    // Update the status message with the result
    return await statusMessage.edit({ content: '', embeds: [embed] });
    
  } catch (error) {
    logger.error(`[PurgAuth] Error purging auth messages: ${error.message}`);
    return await directSend(`❌ An error occurred while purging messages: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute
};