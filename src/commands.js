const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const personalityManagerFunctions = require('./personalityManager');
const {
  registerPersonality,
  getPersonality,
  setPersonalityAlias,
  getPersonalityByAlias,
  removePersonality,
  listPersonalitiesForUser,
} = personalityManagerFunctions;
// Note: Some imports like recordConversation and Registry are currently imported
// but not used in this file. They're kept for future use or documentation.
const {
  /* recordConversation (currently unused but kept for future), */
  clearConversation,
  activatePersonality,
  deactivatePersonality,
} = require('./conversationManager');
const { knownProblematicPersonalities, runtimeProblematicPersonalities, errorBlackoutPeriods } = require('./aiService');
const { preloadPersonalityAvatar } = require('./webhookManager');
const { botPrefix } = require('../config');
const logger = require('./logger');
const utils = require('./utils');
const embedHelpers = require('./embedHelpers');
const channelUtils = require('./utils/channelUtils');
// Registry is imported for documentation but not currently used
// eslint-disable-next-line no-unused-vars
const { Registry } = require('./requestRegistry');

/**
 * Process a command
 * @param {Object} message - Discord message object
 * @param {string} command - Command name
 * @param {Array<string>} args - Command arguments
 */
// Create a Map to track recently executed commands to prevent duplicates
const recentCommands = new Map();

async function processCommand(message, command, args) {
  // Get the prefix for use in help messages
  const prefix = botPrefix;

  // Add a simple debug log to track command processing
  logger.info(
    `Processing command: ${command} with args: ${args.join(' ')} from user: ${message.author.tag}`
  );

  // Import auth module and webhookUserTracker to check if user is authenticated
  const auth = require('./auth');
  const webhookUserTracker = require('./utils/webhookUserTracker');

  // CRITICAL: Check if user is authenticated, and if not, restrict to auth commands only
  // Special handling for webhook users to get their real user ID when possible
  let userId = message.author.id;
  
  // Create variable to track if we should bypass auth for webhooks
  let webhookAuthBypass = false;
  
  // For webhook messages, try to get the real user ID
  if (message.webhookId) {
    // Log that we're processing a command from a webhook user
    logger.info(`[Commands] Processing command from webhook user: ${message.author.username || 'unknown'} with webhook ID: ${message.webhookId}`);
    
    // If this is a proxy system webhook, check if auth commands are restricted
    if (command === 'auth' && !webhookUserTracker.isAuthenticationAllowed(message)) {
      // Auth commands are not allowed from proxy systems - special handling
      logger.warn(`[Commands] Auth command from proxy webhook denied: ${message.author.username || 'unknown'}`);
      await directSend(
        `**Authentication with Proxy Systems**\n\n` +
        `For security reasons, authentication commands can't be used through webhook systems like PluralKit.\n\n` +
        `Please use your regular Discord account (without the proxy) to run authentication commands.`
      );
      return true; // Return success to prevent further handling
    }
    
    // For non-auth commands from webhooks, bypass verification if appropriate
    if (webhookUserTracker.shouldBypassNsfwVerification(message)) {
      logger.info(`[Commands] Bypassing authentication check for webhook command: ${command}`);
      // Set the bypass flag to true for non-auth commands
      const isAuthCommand = (command === 'auth');
      if (!isAuthCommand) {
        webhookAuthBypass = true;
        logger.info(`[Commands] Authentication bypass enabled for webhook command: ${command}`);
      }
    }
  }
  
  // Check authentication using the user ID (may be the real user behind a webhook)
  // If webhookAuthBypass is true, override the authentication check
  const isAuthenticated = webhookAuthBypass ? true : auth.hasValidToken(userId);
  const isAuthCommand = (command === 'auth' || command === 'help');
  
  // Special bypass for help command for webhook users - moved this inside the isAuthenticated check
  // The logic is already handled by webhookAuthBypass above
  
  if (!isAuthenticated && !isAuthCommand) {
    // User is trying to use a non-auth command without authentication
    logger.info(`[Commands] Unauthorized user ${message.author.tag} attempted to use command: ${command}`);
    
    // Try to send a DM to the user for more secure authentication
    try {
      // First try a DM
      await message.author.send(
        `**Authentication Required**\n\n` +
        `You need to authenticate with the service before using any commands.\n\n` +
        `Please use \`${prefix} auth start\` to begin the authentication process. ` +
        `Once authenticated, you'll be able to use all bot commands.\n\n` +
        `For security, I recommend completing the authentication process in DMs rather than in a public channel.`
      );
      
      // Let them know in the channel that we've sent a DM
      return await message.reply('You need to authenticate before using this command. I\'ve sent you a DM with instructions.');
    } catch (dmError) {
      // If DM fails, reply in the channel
      logger.warn(`[Commands] Failed to send DM to user ${message.author.id}: ${dmError.message}`);
      return await message.reply(
        `**Authentication Required**\n\n` +
        `You need to authenticate with the service before using any commands.\n\n` +
        `Please use \`${prefix} auth start\` to begin the authentication process.`
      );
    }
  }

  // ENHANCED LOGGING: Check processed messages in more detail
  logger.debug(
    `[Commands] Checking if message ${message.id} is in the processedMessages set (size: ${processedMessages.size})`
  );

  // We now handle ALL command types centrally in the processedMessages check
  // No special case handling needed for add/create commands
  logger.info(`[Commands] Processing command: ${command}`);

  // Check if this message has already been processed
  // The check needs to handle ALL command types, including add/create
  if (processedMessages.has(message.id)) {
    logger.info(`[Commands] Message ${message.id} already processed, skipping duplicate command`);
    return null;
  } else {
    logger.info(`[Commands] Message ${message.id} will be processed`);
    // Mark ALL messages as processed when we start handling them
    processedMessages.add(message.id);

    // Clean up after 30 seconds
    setTimeout(() => {
      logger.info(`[Commands] Removing message ${message.id} from processedMessages after timeout`);
      processedMessages.delete(message.id);
    }, 30000); // 30 seconds
  }

  // Create a unique key for this command execution
  const commandKey = `${message.author.id}-${command}-${args.join('-')}`;

  logger.debug(`[Commands] Command key: ${commandKey}`);

  // Check if this exact command was recently executed (within 3 seconds)
  if (recentCommands.has(commandKey)) {
    const timestamp = recentCommands.get(commandKey);
    if (Date.now() - timestamp < 3000) {
      logger.info(
        `[Commands] Detected duplicate command execution: ${command} from ${message.author.tag}, ignoring`
      );
      return null; // Silently ignore duplicate commands
    }
  }

  // Mark this command as recently executed
  recentCommands.set(commandKey, Date.now());
  logger.debug(`[Commands] Marked command as recently executed with key: ${commandKey}`);

  // Skip marking other write commands as processed since we already do that above for add/create
  // and the other commands don't have the duplicate embed issue
  if (['remove', 'delete', 'alias'].includes(command)) {
    logger.debug(
      `[Commands] Adding message ${message.id} to processedMessages set for command: ${command}`
    );
    processedMessages.add(message.id);

    // Clean up after 30 seconds (reduced from 5 minutes)
    setTimeout(() => {
      logger.debug(
        `[Commands] Removing message ${message.id} from processedMessages after timeout`
      );
      processedMessages.delete(message.id);
    }, 30000); // 30 seconds instead of 5 minutes
  }

  // Clean up old entries from the recentCommands map (older than 10 seconds)
  const now = Date.now();
  for (const [key, timestamp] of recentCommands.entries()) {
    if (now - timestamp > 10000) {
      recentCommands.delete(key);
    }
  }

  // Use a try/catch to avoid uncaught exceptions
  try {
    // Create a direct send function to avoid Discord.js reply bug
    const directSend = async content => {
      try {
        if (typeof content === 'string') {
          return await message.channel.send(content);
        } else {
          return await message.channel.send(content);
        }
      } catch (err) {
        logger.error('Error sending message:', err);
        return null;
      }
    };

    switch (command) {
      case 'help':
        return await handleHelpCommand(message, args);

      case 'add':
      case 'create':
        return await handleAddCommand(message, args);

      case 'list':
        return await handleListCommand(message, args);

      case 'alias':
        return await handleAliasCommand(message, args);

      case 'remove':
      case 'delete':
        return await handleRemoveCommand(message, args);

      case 'info':
        return await handleInfoCommand(message, args);

      case 'ping':
        return await directSend('Pong! Tzurot is operational.');

      case 'reset':
        return await handleResetCommand(message, args);

      case 'activate':
        return await handleActivateCommand(message, args);

      case 'deactivate':
        return await handleDeactivateCommand(message, args);
        
      case 'clearerrors':
        return await handleClearErrorsCommand(message, args);

      case 'autorespond':
      case 'auto':
        return await handleAutoRespondCommand(message, args);
        
      case 'auth':
        return await handleAuthCommand(message, args);

      case 'verify':
      case 'nsfw':
        return await handleVerifyCommand(message, args);

      case 'status':
        return await handleStatusCommand(message, args);

      case 'debug':
        // Only server admins should have access to debug commands
        // Check if this is a DM channel (no member object)
        const isDMDebug = message.channel.isDMBased();
        if (!isDMDebug && message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return await handleDebugCommand(message, args);
        } else {
          return await directSend(`You need Administrator permission to use this command.`);
        }

      default:
        return await directSend(
          `Unknown command: \`${command}\`. Use \`${prefix} help\` to see available commands.`
        );
    }
  } catch (error) {
    logger.error(`Error processing command ${command}:`, error);
    return await message.channel.send(
      `An error occurred while processing the command. Please try again.`
    );
  }
}

/**
 * Handle the help command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
// Static tracking objects to prevent duplicate messages
// This might be a workaround for a Discord.js bug
const lastEmbedSendTimes = new Map();

// Message tracker is used to prevent duplicate message processing
// This is referenced in tests directly, so exporting for unit test purposes
const messageTracker = {
  lastCommandTime: {},
  isDuplicate: function (userId, commandName) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const lastTime = this.lastCommandTime[key] || 0;

    // Consider it a duplicate if same command from same user within 3 seconds
    if (now - lastTime < 3000) {
      logger.info(`Duplicate command detected: ${commandName} from ${userId}`);
      return true;
    }

    // Update the timestamp
    this.lastCommandTime[key] = now;
    return false;
  },
};

async function handleHelpCommand(message, args) {
  const prefix = botPrefix;

  logger.info(`Processing help command with args: ${args.join(', ')}`);

  try {
    // Create simpler reply function that doesn't use the reply feature
    const directSend = utils.createDirectSend(message);

    if (args.length > 0) {
      // Help for a specific command
      const specificCommand = args[0].toLowerCase();

      switch (specificCommand) {
        case 'auth':
          return await directSend(
            `**${prefix} auth <subcommand>**\n` +
            `Authentication commands for accessing the AI service with your account.\n\n` +
            `Subcommands:\n` +
            `- \`start\` - Begin the authentication process and get an authorization URL\n` +
            `- \`code <code>\` - Submit your authorization code (DM only for security)\n` +
            `- \`status\` - Check your current authentication status\n` +
            `- \`revoke\` - Remove your authorization\n\n` +
            `Security Note: For your protection, authorization codes must be submitted via DM only. ` +
            `Messages with authorization codes in public channels will be deleted.`
          );
        case 'add':
        case 'create':
          return await directSend(
            `**${prefix} add <profile_name> [alias]**\n` +
              `Add a new AI personality to your collection.\n` +
              `- \`profile_name\` is the name of the personality (required)\n` +
              `- \`alias\` is an optional nickname you can use to reference this personality (optional)\n\n` +
              `Example: \`${prefix} add lilith-tzel-shani lilith\``
          );

        case 'debug':
          // Only show this for users with Administrator permission
          // Check if this is a DM channel (no member object)
          const isDMDebugHelp = message.channel.isDMBased();
          if (!isDMDebugHelp && message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await directSend(
              `**${prefix} debug <subcommand>**\n` +
                `Advanced debugging tools (Requires Administrator permission).\n` +
                `Available subcommands:\n` +
                `- \`problems\` - Display information about problematic personalities\n\n` +
                `Example: \`${prefix} debug problems\``
            );
          } else {
            return await directSend(`This command is only available to administrators.`);
          }

        case 'list':
          return await directSend(
            `**${prefix} list [page]**\n` +
              `List all AI personalities you've added.\n` +
              `- \`page\` is an optional page number for pagination (default: 1)\n\n` +
              `Examples:\n` +
              `\`${prefix} list\` - Show first page of personalities\n` +
              `\`${prefix} list 2\` - Show second page of personalities`
          );

        case 'alias':
          return await directSend(
            `**${prefix} alias <profile_name> <new_alias>**\n` +
              `Add an alias/nickname for an existing personality.\n` +
              `- \`profile_name\` is the name of the personality (required)\n` +
              `- \`new_alias\` is the nickname to assign (required)\n\n` +
              `Example: \`${prefix} alias lilith-tzel-shani lili\``
          );

        case 'remove':
        case 'delete':
          return await directSend(
            `**${prefix} remove <profile_name>**\n` +
              `Remove a personality from your collection.\n` +
              `- \`profile_name\` is the name of the personality to remove (required)\n\n` +
              `Example: \`${prefix} remove lilith-tzel-shani\``
          );

        case 'info':
          return await directSend(
            `**${prefix} info <profile_name>**\n` +
              `Show detailed information about a personality.\n` +
              `- \`profile_name\` is the name or alias of the personality (required)\n\n` +
              `Example: \`${prefix} info lilith\``
          );

        case 'activate':
          return await directSend(
            `**${prefix} activate <personality>**\n` +
              `Activate a personality to automatically respond to all messages in the channel from any user.\n` +
              `- Requires the "Manage Messages" permission\n` +
              `- \`personality\` is the name or alias of the personality to activate (required)\n` +
              `- Multi-word personality names are supported (like \`${prefix} activate lucifer-seraph-ha-lev-nafal\`)\n\n` +
              `Examples:\n` +
              `\`${prefix} activate lilith\` - Activate personality with alias 'lilith'\n` +
              `\`${prefix} activate lucifer-seraph-ha-lev-nafal\` - Activate personality with multi-word name`
          );

        case 'deactivate':
          return await directSend(
            `**${prefix} deactivate**\n` +
              `Deactivate the currently active personality in this channel.\n` +
              `- Requires the "Manage Messages" permission\n\n` +
              `Example: \`${prefix} deactivate\``
          );
          
        case 'verify':
        case 'nsfw':
          return await directSend(
            `**${prefix} verify**\n` +
              `Verify your age to use AI personalities in Direct Messages.\n` +
              `- Must be run in a NSFW-marked channel in a server\n` +
              `- Checks if you have access to NSFW content on Discord\n` +
              `- Required for using personalities in DMs\n\n` +
              `Example: \`${prefix} verify\``
          );
          
        case 'clearerrors':
          return await directSend(
            `**${prefix} clearerrors**\n` +
              `Clears any error state for personalities that might be preventing them from responding.\n` +
              `- Use this if a personality is repeatedly failing to respond\n` +
              `- Clears both problematic personality registrations and blackout periods\n` +
              `- Requires admin permission\n\n` +
              `Example: \`${prefix} clearerrors\``
          );

        case 'autorespond':
        case 'auto':
          return await directSend(
            `**${prefix} autorespond <on|off|status>**\n` +
              `Toggle whether personalities continue responding to your messages automatically after you tag or reply to them.\n` +
              `- \`on\` - Enable auto-response for your user\n` +
              `- \`off\` - Disable auto-response (default)\n` +
              `- \`status\` - Check your current setting\n\n` +
              `Example: \`${prefix} autorespond on\``
          );

        default:
          return await directSend(
            `Unknown command: \`${specificCommand}\`. Use \`${prefix} help\` to see available commands.`
          );
      }
    }
    

    // General help
    // Check if this is a DM channel (no member object)
    const isDM = message.channel.isDMBased();
    // In DMs, treat as non-admin; in servers, check permissions
    // Fix: Handle webhook users without member object
    const isAdmin = isDM ? false : (message.member ? message.member.permissions.has(PermissionFlagsBits.Administrator) : false);
    const embed = embedHelpers.createHelpEmbed(isAdmin);

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleHelpCommand:', error);
    return message.channel.send(
      `An error occurred while processing the help command: ${error.message}`
    );
  }
}

/**
 * Handle the add command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
// Track in-progress personality additions to prevent duplicate messages
const pendingAdditions = new Map();

// Global variable to track message IDs that have already been processed
// This prevents multiple handlers from processing the same message
const processedMessages = new Set();

// CRITICAL: Set to track commands that are currently in the process of sending an embed response
// This is a critical fix for the duplicate embed issue
const sendingEmbedResponses = new Set();

// Periodically clean up old processed message entries (every 10 minutes)
setInterval(
  () => {
    if (processedMessages.size > 0) {
      logger.debug(
        `[Commands] Cleaning up processed messages cache (size: ${processedMessages.size})`
      );
      processedMessages.clear();
    }

    // Also clean up the sendingEmbedResponses set in case any entries get stuck
    if (sendingEmbedResponses.size > 0) {
      logger.debug(
        `[Commands] Cleaning up sendingEmbedResponses (size: ${sendingEmbedResponses.size})`
      );
      sendingEmbedResponses.clear();
    }
  },
  10 * 60 * 1000
).unref(); // unref() allows the process to exit even if timer is active

// Global set to track exact add commands we've processed to completion
// This is a critical fix to prevent double messages at the source
const completedAddCommands = new Set();

// Set a periodic cleaner for completedAddCommands set (every hour)
setInterval(
  () => {
    if (completedAddCommands.size > 0) {
      logger.debug(
        `[Commands] Cleaning up completedAddCommands set (size: ${completedAddCommands.size})`
      );
      completedAddCommands.clear();
    }
  },
  60 * 60 * 1000
).unref(); // unref() allows the process to exit even if timer is active

// Global set to track which commands have already generated a first embed response
const hasGeneratedFirstEmbed = new Set();

// Set a periodic cleaner for this set (every hour)
setInterval(
  () => {
    if (hasGeneratedFirstEmbed.size > 0) {
      logger.debug(
        `[Commands] Cleaning up hasGeneratedFirstEmbed set (size: ${hasGeneratedFirstEmbed.size})`
      );
      hasGeneratedFirstEmbed.clear();
    }
  },
  60 * 60 * 1000
).unref();

// Tracking if add command was already processed
const addCommandMessageIds = new Set();

// Periodically clean up old sets (every 10 minutes) to prevent memory leaks
setInterval(
  () => {
    if (addCommandMessageIds.size > 0) {
      logger.debug(
        `[Commands] Cleaning up addCommandMessageIds set (size: ${addCommandMessageIds.size})`
      );
      addCommandMessageIds.clear();
    }
  },
  10 * 60 * 1000
).unref();

/**
 * Handle the add command implementation
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAddCommand(message, args) {
  const directSend = utils.createDirectSend(message);

  // Check if this message was already processed
  if (addCommandMessageIds.has(message.id)) {
    logger.warn(`[PROTECTION] This message (${message.id}) has already been processed by handleAddCommand`);
    return null;
  }

  // Mark the message as processed
  addCommandMessageIds.add(message.id);

  // Later cleanup
  setTimeout(() => {
    addCommandMessageIds.delete(message.id);
  }, 60 * 1000); // 1 minute

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name. Usage: \`${botPrefix} add <personality-name> [alias]\``
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
    if (completedAddCommands.has(commandKey)) {
      logger.warn(`[PROTECTION] Command has already been processed: ${commandKey}`);
      return null;
    }

    // Create unique operation key for this add command
    const messageKey = `add-${message.id}-${personalityName}`;
    if (hasGeneratedFirstEmbed.has(messageKey)) {
      logger.warn(`[PROTECTION] Already generated first embed for: ${messageKey}`);
      // Update the status in our tracking
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });
      completedAddCommands.add(commandKey);
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
    const registrationResult = await registerPersonality(message.author.id, personalityName, alias);

    if (registrationResult.error) {
      logger.warn(`[AddCommand ${commandId}] Registration error: ${registrationResult.error}`);
      
      // Mark as completed even in error case
      pendingAdditions.set(userKey, {
        status: 'completed',
        timestamp: Date.now(),
      });
      completedAddCommands.add(commandKey);
      
      return await directSend(registrationResult.error);
    }

    const personality = registrationResult.personality;
    logger.info(`[AddCommand ${commandId}] Personality registered successfully: ${personality.fullName}`);

    // Preload the avatar in the background
    // This is intentionally not awaited because we want it to happen in the background
    preloadPersonalityAvatar(personality)
      .catch(err => {
        logger.error(`[AddCommand ${commandId}] Error preloading avatar: ${err.message}`);
      });

    // First embed for immediate feedback - mark this specific message as having generated the first embed
    hasGeneratedFirstEmbed.add(messageKey);
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
    sendingEmbedResponses.add(messageKey);
    const initialResponse = await message.channel.send({ embeds: [basicEmbed] });
    logger.info(`[AddCommand ${commandId}] Initial embed sent with ID: ${initialResponse.id}`);
    sendingEmbedResponses.delete(messageKey);

    // Mark this request as completed
    pendingAdditions.set(userKey, {
      status: 'completed',
      timestamp: Date.now(),
    });

    // Add to completed commands set
    completedAddCommands.add(commandKey);

    logger.info(`[AddCommand ${commandId}] Command completed successfully`);
    return initialResponse;
  } catch (error) {
    logger.error(`Error in handleAddCommand for ${personalityName}:`, error);

    // Mark as completed even in case of error
    pendingAdditions.set(`${message.author.id}-${personalityName}`, {
      status: 'completed',
      timestamp: Date.now(),
    });

    return await directSend(`An error occurred while adding the personality: ${error.message}`);
  }
}

/**
 * Handle the list command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleListCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  try {
    // Get the user's personalities
    const personalities = listPersonalitiesForUser(message.author.id);

    if (!personalities || personalities.length === 0) {
      return await directSend(
        `You haven't added any personalities yet. Use \`${botPrefix} add <personality-name>\` to add one.`
      );
    }

    // Get the page number from args, default to 1
    const page = args.length > 0 && !isNaN(args[0]) ? parseInt(args[0], 10) : 1;
    const pageSize = 10; // Number of personalities per page
    const totalPages = Math.ceil(personalities.length / pageSize);

    // Validate page number
    if (page < 1 || page > totalPages) {
      return await directSend(
        `Invalid page number. Please specify a page between 1 and ${totalPages}.`
      );
    }

    // Calculate slice indices
    const startIdx = (page - 1) * pageSize;
    const endIdx = Math.min(startIdx + pageSize, personalities.length);
    const pagePersonalities = personalities.slice(startIdx, endIdx);

    // Build the embed
    const embed = embedHelpers.createListEmbed(pagePersonalities, page, totalPages, message.author);
    
    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleListCommand:', error);
    return await directSend(`An error occurred while listing personalities: ${error.message}`);
  }
}

/**
 * Handle the alias command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAliasCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 2) {
    return await directSend(
      `You need to provide a personality name and an alias. Usage: \`${botPrefix} alias <personality-name> <alias>\``
    );
  }

  // Extract the personality name and alias
  const personalityName = args[0].toLowerCase();
  const alias = args[1].toLowerCase();

  try {
    // Find the personality first
    const personality = getPersonality(personalityName);

    if (!personality) {
      return await directSend(
        `Personality "${personalityName}" not found. Please check the name and try again.`
      );
    }

    // Set the alias
    const result = await setPersonalityAlias(message.author.id, personalityName, alias);

    if (result.error) {
      return await directSend(result.error);
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Alias Added')
      .setDescription(`An alias has been set for **${personalityName}**.`)
      .setColor(0x4caf50)
      .addFields(
        { name: 'Full Name', value: personalityName, inline: true },
        { name: 'Alias', value: alias, inline: true }
      );

    // Add avatar if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleAliasCommand:', error);
    return await directSend(`An error occurred while setting the alias: ${error.message}`);
  }
}

/**
 * Handle the remove command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleRemoveCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name. Usage: \`${botPrefix} remove <personality-name>\``
    );
  }

  // Extract the personality name
  const personalityName = args[0].toLowerCase();

  try {
    // Try to find the personality first to get a displayName for the confirmation message
    let personality = null;
    
    // First check if this is an alias
    personality = getPersonalityByAlias(message.author.id, personalityName);
    
    // If not found by alias, try the direct name
    if (!personality) {
      personality = getPersonality(personalityName);
    }
    
    if (!personality) {
      return await directSend(
        `Personality "${personalityName}" not found. Please check the name or alias and try again.`
      );
    }

    // Remove the personality
    const result = await removePersonality(message.author.id, personality.fullName);

    if (result.error) {
      return await directSend(result.error);
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Personality Removed')
      .setDescription(`**${personality.displayName || personality.fullName}** has been removed from your collection.`)
      .setColor(0xf44336);

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleRemoveCommand:', error);
    return await directSend(`An error occurred while removing the personality: ${error.message}`);
  }
}

/**
 * Handle the info command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleInfoCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if the user provided the correct arguments
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name or alias. Usage: \`${botPrefix} info <personality-name-or-alias>\``
    );
  }

  // Extract the personality name or alias
  const personalityInput = args[0].toLowerCase();

  try {
    // Try to find the personality (first by alias, then by name)
    let personality = getPersonalityByAlias(message.author.id, personalityInput);
    
    if (!personality) {
      personality = getPersonality(personalityInput);
    }

    if (!personality) {
      return await directSend(
        `Personality "${personalityInput}" not found. Please check the name or alias and try again.`
      );
    }

    // Create the info embed
    const embed = new EmbedBuilder()
      .setTitle('Personality Info')
      .setDescription(`Information for **${personality.displayName || personality.fullName}**`)
      .setColor(0x2196f3)
      .addFields(
        { name: 'Full Name', value: personality.fullName, inline: true },
        { name: 'Display Name', value: personality.displayName || 'Not set', inline: true }
      );

    // Add the alias if exists
    const userAliases = personality.aliases?.[message.author.id];
    if (userAliases && userAliases.length > 0) {
      embed.addFields({ name: 'Your Aliases', value: userAliases.join(', '), inline: true });
    } else {
      embed.addFields({ name: 'Your Aliases', value: 'None set', inline: true });
    }

    // Add health status check
    const isKnownProblematic = knownProblematicPersonalities.includes(personality.fullName);
    const isRuntimeProblematic = runtimeProblematicPersonalities.has(personality.fullName);
    
    if (isKnownProblematic || isRuntimeProblematic) {
      embed.addFields({ 
        name: 'Status', 
        value: '⚠️ This personality has experienced issues. It may not work correctly.', 
        inline: false 
      });
    } else {
      embed.addFields({ 
        name: 'Status', 
        value: '✅ This personality is working normally.', 
        inline: false 
      });
    }

    // Add avatar if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleInfoCommand:', error);
    return await directSend(`An error occurred while getting personality info: ${error.message}`);
  }
}

/**
 * Handle the reset command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleResetCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if the user provided a personality name
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name or alias. Usage: \`${botPrefix} reset <personality-name-or-alias>\``
    );
  }

  // Extract the personality name or alias
  const personalityInput = args[0].toLowerCase();

  try {
    // Try to find the personality (first by alias, then by name)
    let personality = getPersonalityByAlias(message.author.id, personalityInput);
    
    if (!personality) {
      personality = getPersonality(personalityInput);
    }

    if (!personality) {
      return await directSend(
        `Personality "${personalityInput}" not found. Please check the name or alias and try again.`
      );
    }

    // Clear the conversation for this personality in this channel
    clearConversation(message.author.id, message.channel.id, personality.fullName);

    return await directSend(
      `Conversation with **${personality.displayName || personality.fullName}** has been reset in this channel.`
    );
  } catch (error) {
    logger.error('Error in handleResetCommand:', error);
    return await directSend(`An error occurred while resetting the conversation: ${error.message}`);
  }
}

/**
 * Handle the activate command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleActivateCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if this is a DM channel (we don't allow activate in DMs)
  if (message.channel.isDMBased()) {
    return await directSend(
      `Channel activation is not needed in DMs. Simply send a message to interact with personalities.`
    );
  }

  // Check if the user has permission to manage messages
  // Ensure member exists (could be missing for webhook users like Pluralkit)
  if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return await directSend(
      `You need the "Manage Messages" permission to activate a personality in this channel.`
    );
  }

  // Check if the channel is NSFW (including parent for threads)
  if (!channelUtils.isChannelNSFW(message.channel)) {
    return await directSend(
      `⚠️ For safety and compliance reasons, personalities can only be activated in channels marked as NSFW. Please mark this channel as NSFW in the channel settings first.`
    );
  }

  // Check if the user provided a personality name
  if (args.length < 1) {
    return await directSend(
      `You need to provide a personality name or alias. Usage: \`${botPrefix} activate <personality-name-or-alias>\``
    );
  }

  // Join the args to support multi-word personality names/aliases (e.g., "bambi prime")
  const personalityInput = args.join(' ').toLowerCase();

  try {
    // Try to find the personality (first by alias, then by name)
    let personality = getPersonalityByAlias(message.author.id, personalityInput);
    
    if (!personality) {
      personality = getPersonality(personalityInput);
    }

    if (!personality) {
      return await directSend(
        `Personality "${personalityInput}" not found. Please check the name or alias and try again.`
      );
    }

    // Activate the personality for this channel
    const result = activatePersonality(message.channel.id, personality.fullName);

    if (result.error) {
      return await directSend(result.error);
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Personality Activated')
      .setDescription(
        `**${personality.displayName || personality.fullName}** is now active in this channel and will respond to all messages.`
      )
      .setColor(0x4caf50)
      .setFooter({
        text: `Use "${botPrefix} deactivate" to turn off automatic responses.`,
      });

    // Add avatar if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleActivateCommand:', error);
    return await directSend(`An error occurred while activating the personality: ${error.message}`);
  }
}

/**
 * Handle the deactivate command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleDeactivateCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if this is a DM channel (we don't allow deactivate in DMs as it's not needed)
  if (message.channel.isDMBased()) {
    return await directSend(
      `Channel activation is not used in DMs. You can simply stop messaging to end the conversation.`
    );
  }

  // Check if the user has permission to manage messages
  // Ensure member exists (could be missing for webhook users like Pluralkit)
  if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return await directSend(
      `You need the "Manage Messages" permission to deactivate a personality in this channel.`
    );
  }

  try {
    // Deactivate personality for this channel
    const result = deactivatePersonality(message.channel.id);

    if (result.error) {
      return await directSend(result.error);
    }

    // Create the success embed
    const embed = new EmbedBuilder()
      .setTitle('Channel Deactivated')
      .setDescription(
        `The active personality has been deactivated in this channel. It will no longer respond to all messages.`
      )
      .setColor(0xf44336);

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleDeactivateCommand:', error);
    return await directSend(`An error occurred while deactivating the personality: ${error.message}`);
  }
}

/**
 * Handle the clearerrors command - Clears any runtime error state for personalities
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleClearErrorsCommand(message, args) {
  // Check if user has Administrator permission for this command
  const isDM = message.channel.isDMBased();
  const isAdmin = isDM ? false : (message.member ? message.member.permissions.has(PermissionFlagsBits.Administrator) : false);
  
  // Create direct send function
  const directSend = utils.createDirectSend(message);
  
  // For safety, require Admin permissions in servers
  if (!isDM && !isAdmin) {
    return directSend('You need Administrator permission to use this command.');
  }

  // Import the AIService
  const {
    runtimeProblematicPersonalities,
    errorBlackoutPeriods
  } = require('./aiService');
  
  // Clear all runtime problematic personalities
  const problemPersonalityCount = runtimeProblematicPersonalities.size;
  runtimeProblematicPersonalities.clear();
  
  // Clear all error blackout periods
  const blackoutCount = errorBlackoutPeriods.size;
  errorBlackoutPeriods.clear();
  
  // Return success message with counts
  return directSend(`✅ Error state has been cleared:
- Cleared ${problemPersonalityCount} problematic personality registrations
- Cleared ${blackoutCount} error blackout periods

Personalities should now respond normally if they were previously failing.`);
}

/**
 * Handle the debug command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleDebugCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Check if the user provided a subcommand
  if (args.length < 1) {
    return await directSend(
      `You need to provide a subcommand. Usage: \`${botPrefix} debug <subcommand>\`\n\n` +
      `Available subcommands:\n` +
      `- \`problems\` - Display information about problematic personalities`
    );
  }

  const subCommand = args[0].toLowerCase();

  switch (subCommand) {
    case 'problems':
      // Show information about problematic personalities
      const knownProblems = knownProblematicPersonalities.length;
      const runtimeProblems = runtimeProblematicPersonalities.size;
      
      // Prepare lists for the embed
      const knownList = knownProblematicPersonalities.length > 0 
        ? knownProblematicPersonalities.join('\n') 
        : 'None';
        
      const runtimeList = runtimeProblematicPersonalities.size > 0
        ? Array.from(runtimeProblematicPersonalities.entries())
          .map(([name, timestamp]) => {
            const time = new Date(timestamp).toLocaleString();
            return `${name} (since ${time})`;
          })
          .join('\n')
        : 'None';
      
      // Create the embed
      const embed = new EmbedBuilder()
        .setTitle('Problematic Personalities Report')
        .setDescription(`Information about personalities that have experienced issues.`)
        .setColor(0xff9800)
        .addFields(
          { 
            name: `Known Problematic (${knownProblems})`, 
            value: knownList.length > 1024 ? `${knownList.substring(0, 1021)}...` : knownList, 
            inline: false 
          },
          { 
            name: `Runtime Problematic (${runtimeProblems})`, 
            value: runtimeList.length > 1024 ? `${runtimeList.substring(0, 1021)}...` : runtimeList, 
            inline: false 
          }
        )
        .setFooter({
          text: `Use "${botPrefix} clearerrors" to reset runtime problematic personalities.`,
        });
      
      return await directSend({ embeds: [embed] });

    default:
      return await directSend(
        `Unknown debug subcommand: \`${subCommand}\`. Use \`${botPrefix} debug\` to see available subcommands.`
      );
  }
}

/**
 * Handle the autorespond command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
// Store user auto-response preferences 
// Map of userId -> boolean (true = enabled, false = disabled)
const autoResponseEnabled = new Map();

// Helper functions for auto-response
function isAutoResponseEnabled(userId) {
  return autoResponseEnabled.get(userId) === true;
}

function enableAutoResponse(userId) {
  autoResponseEnabled.set(userId, true);
}

function disableAutoResponse(userId) {
  autoResponseEnabled.set(userId, false);
}

async function handleAutoRespondCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);

  // Get the user ID
  const userId = message.author.id;

  // Check if the user provided a subcommand
  if (args.length < 1) {
    const currentSetting = isAutoResponseEnabled(userId);
    return await directSend(
      `Your auto-response setting is currently **${currentSetting ? 'ON' : 'OFF'}**.\n\n` +
      `Use \`${botPrefix} autorespond on\` to enable or \`${botPrefix} autorespond off\` to disable.`
    );
  }

  const subCommand = args[0].toLowerCase();

  if (subCommand === 'status') {
    const currentSetting = isAutoResponseEnabled(userId);
    return await directSend(
      `Your auto-response setting is currently **${currentSetting ? 'ON' : 'OFF'}**.`
    );
  }

  if (subCommand === 'on') {
    enableAutoResponse(userId);
    return message.reply(
      `**Auto-response enabled.** After mentioning or replying to a personality, it will continue responding to your messages in that channel without needing to tag it again.`
    );
  }

  if (subCommand === 'off') {
    disableAutoResponse(userId);
    return message.reply(
      `**Auto-response disabled.** Personalities will now only respond when you directly mention or reply to them.`
    );
  }
}

/**
 * Handle the status command
 * @param {Object} message - Discord message object
 */
/**
 * Handle the verify command for age/NSFW verification
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleVerifyCommand(message, args) {
  // Import auth module
  const auth = require('./auth');
  
  // Create direct send function with proper error handling
  const directSend = content => message.reply(content);
  
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
    logger.error('Error in handleVerifyCommand:', error);
    return await directSend(
      "❌ **Verification Error**\n\n" +
      `An error occurred during verification: ${error.message}`
    );
  }
}

/**
 * Handle the status command - provides bot status info
 * @param {Object} message - Discord message object
 */
async function handleStatusCommand(message, args) {
  // Create direct send function
  const directSend = utils.createDirectSend(message);
  
  try {
    // Get uptime info
    const uptime = process.uptime();
    const formattedUptime = formatUptime(uptime);
    
    // Import client from global
    const client = global.tzurotClient;
    
    // Check if user is authenticated
    const auth = require('./auth');
    const isAuthenticated = auth.hasValidToken(message.author.id);
    const isNsfwVerified = auth.isNsfwVerified(message.author.id);
    
    // Create the status embed
    const embed = new EmbedBuilder()
      .setTitle('Bot Status')
      .setDescription(`Current status and information for ${client.user.username}.`)
      .setColor(0x2196f3)
      .addFields(
        { name: 'Uptime', value: formattedUptime, inline: true },
        { name: 'Ping', value: `${Math.round(client.ws.ping)}ms`, inline: true },
        { name: 'Authenticated', value: isAuthenticated ? '✅ Yes' : '❌ No', inline: true },
        { name: 'Age Verified', value: isNsfwVerified ? '✅ Yes' : '❌ No', inline: true },
        { name: 'Guild Count', value: `${client.guilds.cache.size} servers`, inline: true }
      );
    
    // Get user's personalities count if authenticated
    if (isAuthenticated) {
      const personalities = listPersonalitiesForUser(message.author.id);
      embed.addFields({ 
        name: 'Your Personalities', 
        value: personalities && personalities.length > 0 
          ? `${personalities.length} personalities` 
          : 'None added yet', 
        inline: true 
      });
    }
    
    // Add auto-response status
    const autoResponseStatus = isAutoResponseEnabled(message.author.id);
    embed.addFields({ 
      name: 'Auto-Response', 
      value: autoResponseStatus ? '✅ Enabled' : '❌ Disabled', 
      inline: true 
    });
    
    // Add bot avatar if available
    if (client.user.avatarURL()) {
      embed.setThumbnail(client.user.avatarURL());
    }
    
    // Set footer with version
    embed.setFooter({
      text: `Use "${botPrefix} help" for available commands.`,
    });
    
    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in handleStatusCommand:', error);
    return await directSend(`An error occurred while getting bot status: ${error.message}`);
  }
}

/**
 * Format uptime into a human-readable string
 * @param {number} uptime - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor(((uptime % 86400) % 3600) / 60);
  const seconds = Math.floor(((uptime % 86400) % 3600) % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  
  return parts.join(', ');
}

/**
 * Handle the auth command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAuthCommand(message, args) {
  // Import auth module and webhookUserTracker
  const auth = require('./auth');
  const webhookUserTracker = require('./utils/webhookUserTracker');
  
  // Create direct send function
  const directSend = utils.createDirectSend(message);
  
  // If this is a webhook message, check if it's from a proxy system
  let userId = message.author.id;
  if (message.webhookId) {
    // Check if this is a known proxy system like PluralKit
    if (webhookUserTracker.isProxySystemWebhook(message)) {
      // Handle proxy system webhooks specially for auth
      logger.info(`[Auth] Detected proxy system webhook for auth command: ${message.author.username}`);
      // Return a more informative message for proxy systems
      return await directSend(
        `**Authentication with Proxy Systems**\n\n` +
        `For security reasons, authentication commands can't be used through webhook systems like PluralKit.\n\n` +
        `Please use your regular Discord account (without the proxy) to run authentication commands.`
      );
    }
  }
  
  // Check if the user provided a subcommand
  if (args.length < 1) {
    return await directSend(
      `**Authentication Commands**\n\n` +
      `- \`${botPrefix} auth start\` - Begin the authentication process\n` +
      `- \`${botPrefix} auth code <code>\` - Submit your authorization code (DM only)\n` +
      `- \`${botPrefix} auth status\` - Check your authentication status\n` +
      `- \`${botPrefix} auth revoke\` - Revoke your authorization\n\n` +
      `For security, authorization codes should only be submitted via DM.`
    );
  }
  
  const subCommand = args[0].toLowerCase();
  
  switch (subCommand) {
    case 'start':
      // Start the authentication process
      try {
        const authUrl = await auth.getAuthorizationUrl();
        
        if (!authUrl) {
          return await directSend('❌ Failed to generate authentication URL. Please try again later.');
        }
        
        // Check if this is a DM or a public channel
        const isDM = message.channel.isDMBased();
        
        if (isDM) {
          // In DMs, we can safely send the auth URL directly
          return await directSend(
            `**Authentication Required**\n\n` +
            `Please click the link below to authenticate with the service:\n\n` +
            `${authUrl}\n\n` +
            `After authorizing, you'll receive a code. Use \`${botPrefix} auth code YOUR_CODE\` to complete the process.`
          );
        } else {
          // In public channels, send a DM with the auth URL
          try {
            await message.author.send(
              `**Authentication Required**\n\n` +
              `Please click the link below to authenticate with the service:\n\n` +
              `${authUrl}\n\n` +
              `After authorizing, you'll receive a code. Use \`${botPrefix} auth code YOUR_CODE\` here in DM to complete the process.`
            );
            
            // Let them know in the channel that we've sent a DM
            return await directSend(
              `I've sent you a DM with authentication instructions. Please check your DMs.`
            );
          } catch (dmError) {
            // If DM fails, let them know but with less specific info
            return await directSend(
              `❌ Unable to send you a DM. Please ensure your DMs are open, then try again. You can open DMs in User Settings > Privacy & Safety.`
            );
          }
        }
      } catch (error) {
        logger.error(`[Auth] Error starting auth process: ${error.message}`);
        return await directSend(`❌ An error occurred: ${error.message}`);
      }
      
    case 'code':
      // Check if a code was provided
      if (args.length < 2) {
        return await directSend(`Please provide your authorization code. Usage: \`${botPrefix} auth code YOUR_CODE\``);
      }
      
      // Get the code from the args
      const code = args[1];
      
      // Check if this is a DM channel
      const isDM = message.channel.isDMBased();
      
      // For security, only accept auth codes in DMs
      if (!isDM) {
        // Try to delete the message to protect the code
        try {
          await message.delete();
        } catch (deleteError) {
          logger.warn(`[Auth] Failed to delete auth code message: ${deleteError.message}`);
        }
        
        return await directSend(
          `❌ For security, please submit your authorization code via DM, not in a public channel.`
        );
      }
      
      // Check if the code is wrapped in Discord spoiler tags ||code||
      if (code.startsWith('||') && code.endsWith('||')) {
        // Remove the spoiler tags
        code = code.substring(2, code.length - 2);
        logger.info(`[Auth] Extracted code from spoiler tags`);
      }
      
      // Show typing indicator while processing
      message.channel.sendTyping().catch(() => {});
      
      try {
        // Exchange the code for a token
        logger.info(`[Auth] Exchanging code for token...`);
        const token = await auth.exchangeCodeForToken(code);
        
        if (!token) {
          return await directSend('❌ Authorization failed. The code may be invalid or expired.');
        }
        
        // Store the token
        logger.info(`[Auth] Storing token for user ${userId}`);
        const stored = await auth.storeUserToken(userId, token);
        
        if (!stored) {
          return await directSend('❌ Failed to store authorization token. Please try again later.');
        }
        
        // Attempt to delete the message again just in case the first attempt failed,
        // but only if we're not in a DM
        if (!isDM) {
          try {
            await message.delete();
          } catch (deleteError) {
            // It's likely already deleted, so just log it at debug level
            logger.debug(`[Auth] Second attempt to delete message failed (probably already deleted): ${deleteError.message}`);
          }
        }
        
        return await directSend('✅ Authorization successful! The bot will now use your account for AI interactions.');
      } catch (error) {
        logger.error(`Error during auth code exchange: ${error.message}`);
        return await directSend('❌ An error occurred during authorization. Please try again later.');
      }
      
    case 'status':
      // Check if the user has a valid token
      // Use the possibly modified userId (for webhook users)
      const hasToken = auth.hasValidToken(userId);
      
      if (hasToken) {
        return await directSend('✅ You have a valid authorization token. The bot is using your account for AI interactions.');
      } else {
        return await directSend(
          `❌ You don't have an authorization token. Use \`${botPrefix} auth start\` to begin the authorization process.`
        );
      }
      
    case 'revoke':
      // Delete the user's token
      // Use the possibly modified userId (for webhook users)
      const deleted = await auth.deleteUserToken(userId);
      
      if (deleted) {
        return await directSend('✅ Your authorization has been revoked. The bot will no longer use your personal account.');
      } else {
        return await directSend('❌ Failed to revoke authorization. Please try again later.');
      }
      
    default:
      return await directSend(
        `Unknown auth subcommand: \`${subCommand}\`. Use \`${botPrefix} auth\` to see available subcommands.`
      );
  }
}

module.exports = {
  processCommand,
  // Export for testing
  messageTracker,
  handleResetCommand,
  handleAutoRespondCommand,
  handleInfoCommand,
  handleActivateCommand,
  handleDeactivateCommand,
  handleClearErrorsCommand,
  handleListCommand,
  handleAuthCommand,
  handleVerifyCommand,
  directSend: content => {
    try {
      if (typeof content === 'string') {
        return Promise.resolve({ id: 'mock-message-id', content });
      } else {
        return Promise.resolve({ id: 'mock-message-id', content: 'mock-embed' });
      }
    } catch (err) {
      console.error('Error sending message:', err);
      return Promise.resolve(null);
    }
  },
};