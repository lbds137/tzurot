/**
 * Add Command Handler
 * Adds a new AI personality to the user's collection
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const messageTracker = require('../utils/messageTracker');
const { registerPersonality, setPersonalityAlias } = require('../../personalityManager');
const { preloadPersonalityAvatar } = require('../../webhookManager');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'add',
  description: 'Add a new AI personality to your collection',
  usage: 'add <personality-name> [alias]',
  aliases: ['create'],
  permissions: []
};

// Track pending personality additions to prevent duplicate processing
const pendingAdditions = new Map();

/**
 * Execute the add command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args) {
  const directSend = validator.createDirectSend(message);

  // Mark the message as processed - this should happen here and NOT in the middleware
  // to prevent double-marking
  messageTracker.markAddCommandAsProcessed(message.id);

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name. Usage: \`${botPrefix} ${meta.usage}\``
    );
  }

  // Extract the personality name and alias if provided
  const personalityName = args[0].toLowerCase();
  const alias = args[1] ? args[1].toLowerCase() : null;

  try {
    // Check if we've already got a pending or recently completed addition for this user
    const userKey = `${message.author.id}-${personalityName}`;
    const pendingState = pendingAdditions.get(userKey);

    // If the request was completed within the last 5 seconds, block it as a duplicate
    if (pendingState && pendingState.status === 'completed' && Date.now() - pendingState.timestamp < 5000) {
      logger.warn(`[PROTECTION] Blocking duplicate add command from ${message.author.id} for ${personalityName}`);
      return null;
    }

    // If it's already in-progress and hasn't timed out, prevent duplicate
    if (
      pendingState &&
      pendingState.status === 'in-progress' &&
      Date.now() - pendingState.timestamp < 10000 // 10-second timeout
    ) {
      logger.warn(`[PROTECTION] Addition already in progress for ${personalityName} by ${message.author.id}`);
      return null;
    }

    // Mark this request as in-progress
    pendingAdditions.set(userKey, {
      status: 'in-progress',
      timestamp: Date.now(),
    });

    // Generate a unique command ID for tracking
    const commandId = `add-${message.author.id}-${personalityName}-${Date.now()}`;
    logger.debug(`[AddCommand] Generated command ID: ${commandId}`);

    // Check if we've already processed this exact command
    const commandKey = `${message.author.id}-${personalityName}-${args.join('-')}`;
    if (messageTracker.isAddCommandProcessed(message.id) || messageTracker.isAddCommandCompleted(commandKey)) {
      logger.warn(`[PROTECTION] Command has already been processed: ${commandKey}`);
      return null;
    }

    // Create unique operation key for this add command
    const messageKey = `add-${message.id}-${personalityName}`;
    if (messageTracker.hasFirstEmbed(messageKey)) {
      logger.warn(`[PROTECTION] Already generated first embed for: ${messageKey}`);
      // Update the status in our tracking
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });
      messageTracker.markAddCommandCompleted(commandKey);
      return null;
    }

    // Send typing indicator while we process
    try {
      await message.channel.sendTyping();
    } catch (typingError) {
      logger.debug(`Error sending typing indicator: ${typingError.message}`);
      // Non-critical, continue processing
    }

    // Register the personality
    logger.info(`[AddCommand ${commandId}] Registering personality: ${personalityName}`);
    
    // Register personality with proper data structure
    const result = await registerPersonality(message.author.id, personalityName, alias);
    
    // Check if there was an error during registration
    if (result.error) {
      logger.error(`[AddCommand ${commandId}] Error registering personality: ${result.error}`);
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });
      
      if (typeof commandKey !== 'undefined') {
        messageTracker.markAddCommandCompleted(commandKey);
      }
      
      return await directSend(result.error);
    }
    
    const personality = result.personality;
    logger.info(`[AddCommand ${commandId}] Personality registered successfully: ${personality.fullName}`);
    
    // No need to set alias separately as it's now passed directly to registerPersonality

    // Preload the avatar in the background (not awaited)
    preloadPersonalityAvatar(personality)
      .catch(err => {
        logger.error(`[AddCommand ${commandId}] Error preloading avatar: ${err.message}`);
      });

    // First embed for immediate feedback - mark this specific message as having generated the first embed
    messageTracker.markGeneratedFirstEmbed(messageKey);
    logger.info(`[AddCommand ${commandId}] Marked as having generated first embed: ${messageKey}`);

    // Prepare the basic embed fields with info we know will be available
    const basicEmbed = new EmbedBuilder()
      .setTitle('Personality Added')
      .setDescription(`**${personalityName}** has been added to your collection.`)
      .setColor(0x4caf50)
      .addFields(
        { name: 'Full Name', value: personality.fullName || 'Not available', inline: true },
        { name: 'Alias', value: alias || 'None set', inline: true }
      );

    // Add placeholder fields for display name and avatar
    if (!personality.displayName) {
      basicEmbed.addFields({ name: 'Display Name', value: 'Not set (loading...)', inline: true });
    } else {
      basicEmbed.addFields({ name: 'Display Name', value: personality.displayName, inline: true });
    }

    // Add avatar if available, otherwise note it's loading
    if (personality.avatarUrl) {
      basicEmbed.setThumbnail(personality.avatarUrl);
    }

    // Add DM channel-specific note
    if (message.channel.isDMBased()) {
      basicEmbed.setFooter({
        text: 'This personality is now available in your DMs and all servers with the bot.',
      });
    } else {
      basicEmbed.setFooter({
        text: `Use @${personalityName} or ${alias ? `@${alias}` : 'its full name'} to talk to this personality.`,
      });
    }

    logger.debug(`[AddCommand ${commandId}] Sending basic embed response`);

    // CRITICAL: Block other handlers from processing while we're sending the embed
    messageTracker.markSendingEmbed(messageKey);
    const initialResponse = await message.channel.send({ embeds: [basicEmbed] });
    logger.info(`[AddCommand ${commandId}] Initial embed sent with ID: ${initialResponse.id}`);
    messageTracker.clearSendingEmbed(messageKey);

    // Mark this request as completed
    pendingAdditions.set(userKey, {
      status: 'completed',
      timestamp: Date.now(),
    });

    // Add to completed commands set
    messageTracker.markAddCommandCompleted(commandKey);

    logger.info(`[AddCommand ${commandId}] Command completed successfully`);
    return initialResponse;
  } catch (error) {
    logger.error(`Error in handleAddCommand for ${personalityName}:`, error);

    // Mark as completed even in case of error
    const userKey = `${message.author.id}-${personalityName}`;
    pendingAdditions.set(userKey, {
      status: 'completed',
      timestamp: Date.now(),
    });
    
    // Mark the command as completed with a fresh command key
    const errorCommandKey = `${message.author.id}-${personalityName}-${args.join('-')}`;
    messageTracker.markAddCommandCompleted(errorCommandKey);

    return await directSend(`An error occurred while adding the personality: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute
};