/**
 * Add Command Handler
 * Adds a new AI personality to the user's collection
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const {
  registerPersonality,
  setPersonalityAlias,
  getPersonality,
} = require('../../personalityManager');
const { preloadPersonalityAvatar } = require('../../webhookManager');
const { botPrefix, botConfig } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'add',
  description: 'Add a new AI personality to your collection',
  usage: 'add <personality-name> [alias]',
  aliases: ['create'],
  permissions: [],
};

// Track pending personality additions to prevent duplicate processing
const pendingAdditions = new Map();

// Track message IDs being processed to detect duplicate calls
const processingMessages = new Set();

/**
 * Execute the add command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @param {Object} context - Command context with injectable dependencies
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args, context = {}) {
  // Use default timers and messageTracker if context not provided (backward compatibility)
  const { scheduler = setTimeout, messageTracker = null } = context;

  // If no messageTracker injected, create a local instance (for backward compatibility)
  const tracker =
    messageTracker ||
    (() => {
      const MessageTracker = require('../utils/messageTracker');
      return new MessageTracker();
    })();
  logger.info(`[AddCommand] Execute called for message ${message.id} from ${message.author.id}`);

  // Check if this message is already being processed
  if (processingMessages.has(message.id)) {
    logger.warn(
      `[AddCommand] Message ${message.id} is already being processed - duplicate call detected!`
    );
    return null;
  }

  // Check if this exact message was already processed by the add command
  if (tracker.isAddCommandProcessed(message.id)) {
    logger.warn(`[AddCommand] Message ${message.id} was already processed by add command`);
    return null;
  }

  // Mark this message as being processed
  processingMessages.add(message.id);
  tracker.markAddCommandAsProcessed(message.id);

  // Clean up after 1 minute
  scheduler(() => {
    processingMessages.delete(message.id);
  }, 60000);

  const directSend = validator.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name. Usage: \`${botPrefix} ${meta.usage}\``
    );
  }

  // Extract the personality name and alias if provided
  const personalityName = args[0].toLowerCase();
  const alias = args[1] ? args[1].toLowerCase() : null;

  logger.info(
    `[AddCommand] Processing add command for personality: ${personalityName}, alias: ${alias}`
  );

  try {
    // Check if we've already got a pending or recently completed addition for this user
    const userKey = `${message.author.id}-${personalityName}`;
    const pendingState = pendingAdditions.get(userKey);

    // If the request was completed within the last 5 seconds, block it as a duplicate
    if (
      pendingState &&
      pendingState.status === 'completed' &&
      Date.now() - pendingState.timestamp < 5000
    ) {
      logger.warn(
        `[PROTECTION] Blocking duplicate add command from ${message.author.id} for ${personalityName}`
      );
      return null;
    }

    // If it's already in-progress and hasn't timed out, prevent duplicate
    if (
      pendingState &&
      pendingState.status === 'in-progress' &&
      Date.now() - pendingState.timestamp < 10000 // 10-second timeout
    ) {
      logger.warn(
        `[PROTECTION] Addition already in progress for ${personalityName} by ${message.author.id}`
      );
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

    // Check if this personality already exists globally first
    const existingPersonality = getPersonality(personalityName);
    if (existingPersonality) {
      logger.info(`[AddCommand] Personality ${personalityName} already exists globally`);

      // Clear any stale tracking entries for this personality since it already exists
      tracker.clearAllCompletedAddCommandsForPersonality(personalityName);

      return await directSend(
        `The personality "${personalityName}" already exists. If you want to use it, just mention ${botConfig.mentionChar}${personalityName} in your messages.`
      );
    }

    // Check if we've already processed this exact command
    // Use a more specific key that includes the alias if provided
    const commandKey = alias
      ? `${message.author.id}-${personalityName}-alias-${alias}`
      : `${message.author.id}-${personalityName}`;

    // Debug logging to understand the state
    logger.debug(`[AddCommand] Checking if command was already completed:`);
    logger.debug(`[AddCommand] - Message ID: ${message.id}`);
    logger.debug(`[AddCommand] - User ID: ${message.author.id}`);
    logger.debug(`[AddCommand] - Command Key: ${commandKey}`);
    logger.debug(
      `[AddCommand] - isAddCommandCompleted: ${tracker.isAddCommandCompleted(commandKey)}`
    );

    // Only check if the command was already completed (not if the message was processed)
    // We already checked message processing at the top of the function
    if (tracker.isAddCommandCompleted(commandKey)) {
      logger.warn(`[PROTECTION] Command has already been completed: ${commandKey}`);
      return null;
    }

    // Create unique operation key for this add command
    const messageKey = `add-${message.id}-${personalityName}`;
    if (tracker.hasFirstEmbed(messageKey)) {
      logger.warn(`[PROTECTION] Already generated first embed for: ${messageKey}`);
      // Update the status in our tracking
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });
      tracker.markAddCommandCompleted(commandKey);
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
    // Pass an empty object for data, and let the personality manager fetch the info
    let personality;
    try {
      personality = await registerPersonality(message.author.id, personalityName, {
        description: `Added by ${message.author.tag}`,
      });
    } catch (registerError) {
      logger.error(
        `[AddCommand ${commandId}] Error registering personality: ${registerError.message}`
      );
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });

      if (typeof commandKey !== 'undefined') {
        tracker.markAddCommandCompleted(commandKey);
      }

      return await directSend(`Failed to register personality: ${registerError.message}`);
    }

    // Check if we got a valid personality back
    if (!personality || !personality.fullName) {
      logger.error(
        `[AddCommand ${commandId}] Invalid personality returned from registerPersonality`
      );
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });

      tracker.markAddCommandCompleted(commandKey);
      return await directSend(
        'Failed to register personality: Invalid response from personality manager'
      );
    }
    logger.info(
      `[AddCommand ${commandId}] Personality registered successfully: ${personality.fullName}`
    );

    // Set the alias - if one was provided, use it; otherwise use display name
    const aliasToSet =
      alias ||
      (personality.displayName && personality.displayName.toLowerCase() !== personality.fullName
        ? personality.displayName.toLowerCase()
        : null);

    logger.debug(
      `[AddCommand ${commandId}] Alias calculation: alias='${alias}', displayName='${personality.displayName}', fullName='${personality.fullName}', aliasToSet='${aliasToSet}'`
    );

    // Track the actual alias that gets set (might be different due to collisions)
    let actualAlias = aliasToSet;

    if (aliasToSet) {
      try {
        const aliasResult = await setPersonalityAlias(
          aliasToSet,
          personality.fullName,
          false,
          !alias
        ); // skipSave=false, isDisplayName=true if using display name
        if (aliasResult && aliasResult.success) {
          // If alternate aliases were created due to collision, use the first one
          if (aliasResult.alternateAliases && aliasResult.alternateAliases.length > 0) {
            actualAlias = aliasResult.alternateAliases[0];
            logger.info(
              `[AddCommand ${commandId}] Alias '${aliasToSet}' was taken, using alternate alias '${actualAlias}' for personality ${personality.fullName}`
            );
          } else {
            logger.info(
              `[AddCommand ${commandId}] Alias '${aliasToSet}' set for personality ${personality.fullName}${!alias ? ' (from display name)' : ''}`
            );
          }
        } else {
          logger.warn(
            `[AddCommand ${commandId}] Failed to set alias '${aliasToSet}' for personality ${personality.fullName}`
          );
          actualAlias = null; // Clear alias if setting failed
        }
      } catch (aliasError) {
        logger.error(
          `[AddCommand ${commandId}] Error setting alias: ${aliasError.message}`,
          aliasError
        );
        actualAlias = null; // Clear alias if error occurred
        // Continue even if alias setting fails - the personality is already registered
      }
    }

    // Preload the avatar in the background (not awaited)
    preloadPersonalityAvatar(personality).catch(err => {
      logger.error(`[AddCommand ${commandId}] Error preloading avatar: ${err.message}`);
    });

    // First embed for immediate feedback - mark this specific message as having generated the first embed
    tracker.markGeneratedFirstEmbed(messageKey);
    logger.info(`[AddCommand ${commandId}] Marked as having generated first embed: ${messageKey}`);

    // Prepare the basic embed fields with info we know will be available
    const basicEmbed = new EmbedBuilder()
      .setTitle('Personality Added')
      .setDescription(`**${personalityName}** has been added to your collection.`)
      .setColor(0x4caf50)
      .addFields(
        { name: 'Full Name', value: personality.fullName || 'Not available', inline: true },
        { name: 'Alias', value: actualAlias || 'None set', inline: true }
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

    // Add footer with mention instructions
    const mentionText = actualAlias
      ? `Use ${botConfig.mentionChar}${personalityName} or ${botConfig.mentionChar}${actualAlias} to talk to this personality`
      : `Use ${botConfig.mentionChar}${personalityName} to talk to this personality`;

    if (message.channel.isDMBased()) {
      basicEmbed.setFooter({
        text: `${mentionText}. Available in your DMs and all servers with the bot.`,
      });
    } else {
      basicEmbed.setFooter({
        text: `${mentionText}.`,
      });
    }

    logger.debug(`[AddCommand ${commandId}] Sending basic embed response`);

    // Block other handlers from processing while we're sending the embed
    tracker.markSendingEmbed(messageKey);
    const initialResponse = await message.channel.send({ embeds: [basicEmbed] });
    logger.info(`[AddCommand ${commandId}] Initial embed sent with ID: ${initialResponse.id}`);
    tracker.clearSendingEmbed(messageKey);

    // Mark this request as completed
    pendingAdditions.set(userKey, {
      status: 'completed',
      timestamp: Date.now(),
    });

    // Add to completed commands set
    tracker.markAddCommandCompleted(commandKey);

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

    // Mark the command as completed with a consistent command key
    const errorCommandKey = alias
      ? `${message.author.id}-${personalityName}-alias-${alias}`
      : `${message.author.id}-${personalityName}`;
    tracker.markAddCommandCompleted(errorCommandKey);

    return await directSend(`An error occurred while adding the personality: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
