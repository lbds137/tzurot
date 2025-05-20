/**
 * Verify Command Handler
 * Verifies age for NSFW access in Direct Messages
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const channelUtils = require('../../utils/channelUtils');
const auth = require('../../auth');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'verify',
  description: 'Verify your age to use AI personalities in Direct Messages',
  usage: 'verify',
  aliases: ['nsfw'],
  permissions: []
};

/**
 * Execute the verify command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);
  
  // Check if verification system is already complete
  const isAlreadyVerified = auth.isNsfwVerified(message.author.id);
  
  // Check if this is a DM channel
  const isDM = message.channel.isDMBased();
  
  // If the command is run in a DM, explain it needs to be run in a server
  if (isDM) {
    return await directSend(
      "⚠️ **Age Verification Required**\n\n" +
      "This command must be run in a server channel marked as NSFW to verify your age.\n\n" +
      "Please join a server, find a channel marked as NSFW, and run `!tz verify` there. This will verify that you meet Discord's age requirements for NSFW content.\n\n" +
      "This verification is required to use AI personalities in Direct Messages."
    );
  }
  
  // Check if the current channel is NSFW (including parent for threads)
  const isCurrentChannelNSFW = channelUtils.isChannelNSFW(message.channel);
  
  if (isAlreadyVerified) {
    return await directSend(
      "✅ **Already Verified**\n\n" +
      "You are already verified to access AI personalities in Direct Messages. No further action is needed."
    );
  }
  
  // If the current channel is NSFW, the user is automatically verified
  if (isCurrentChannelNSFW) {
    // Store the verification status
    const success = await auth.storeNsfwVerification(message.author.id, true);
    
    if (success) {
      return await directSend(
        "✅ **Verification Successful**\n\n" +
        "You have been successfully verified to use AI personalities in Direct Messages.\n\n" +
        "This verification confirms you meet Discord's age requirements for accessing NSFW content."
      );
    } else {
      return await directSend(
        "❌ **Verification Error**\n\n" +
        "There was an error storing your verification status. Please try again later."
      );
    }
  }
  
  // If not in a NSFW channel, check if the user has access to any NSFW channels in this server
  try {
    const guild = message.guild;
    
    if (!guild) {
      return await directSend(
        "❌ **Verification Error**\n\n" +
        "Unable to verify server information. Please try again in a server channel."
      );
    }
    
    // Find NSFW channels that the user has access to
    const nsfwChannels = guild.channels.cache.filter(
      channel => 
        channel.isTextBased() && 
        channelUtils.isChannelNSFW(channel) && 
        channel.permissionsFor(message.author).has('ViewChannel')
    );
    
    // If the user has access to any NSFW channels, they pass verification
    if (nsfwChannels.size > 0) {
      // Store the verification status
      const success = await auth.storeNsfwVerification(message.author.id, true);
      
      if (success) {
        // Suggest the available NSFW channels to the user
        const channelList = nsfwChannels.map(c => `<#${c.id}>`).join(', ');
        
        return await directSend(
          "✅ **Verification Successful**\n\n" +
          "You have been successfully verified to use AI personalities in Direct Messages.\n\n" +
          "This verification confirms you meet Discord's age requirements for accessing NSFW content.\n\n" +
          `**Available NSFW channels**: ${channelList}\nRun the command in one of these channels next time.`
        );
      } else {
        return await directSend(
          "❌ **Verification Error**\n\n" +
          "There was an error storing your verification status. Please try again later."
        );
      }
    } else {
      // The user doesn't have access to any NSFW channels
      return await directSend(
        "⚠️ **Unable to Verify**\n\n" +
        "You need to run this command in a channel marked as NSFW. This channel is not marked as NSFW, and you don't have access to any NSFW channels in this server.\n\n" +
        "Please try again in a different server with NSFW channels that you can access."
      );
    }
  } catch (error) {
    logger.error('Error in verify command:', error);
    return await directSend(
      "❌ **Verification Error**\n\n" +
      `An error occurred during verification: ${error.message}`
    );
  }
}

module.exports = {
  meta,
  execute
};