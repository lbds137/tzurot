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
const { knownProblematicPersonalities, runtimeProblematicPersonalities } = require('./aiService');
const { preloadPersonalityAvatar } = require('./webhookManager');
const { botPrefix } = require('../config');
const logger = require('./logger');
const utils = require('./utils');
const embedHelpers = require('./embedHelpers');
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
      logger.debug(`[Commands] Removing message ${message.id} from processedMessages after timeout`);
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

      case 'autorespond':
      case 'auto':
        return await handleAutoRespondCommand(message, args);

      case 'status':
        return await handleStatusCommand(message, args);

      case 'debug':
        // Only server admins should have access to debug commands
        if (message.member.permissions.has(PermissionFlagsBits.Administrator)) {
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
          if (message.member.permissions.has(PermissionFlagsBits.Administrator)) {
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
            `**${prefix} list**\n` +
              `List all AI personalities you've added.\n\n` +
              `Example: \`${prefix} list\``
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
              `- \`personality\` is the name or alias of the personality to activate (required)\n\n` +
              `Example: \`${prefix} activate lilith\``
          );

        case 'deactivate':
          return await directSend(
            `**${prefix} deactivate**\n` +
              `Deactivate the currently active personality in this channel.\n` +
              `- Requires the "Manage Messages" permission\n\n` +
              `Example: \`${prefix} deactivate\``
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
    const isAdmin = message.member.permissions.has(PermissionFlagsBits.Administrator);
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

    // Also clean up lastEmbedSendTimes
    if (lastEmbedSendTimes.size > 0) {
      logger.debug(
        `[Commands] Cleaning up lastEmbedSendTimes map (size: ${lastEmbedSendTimes.size})`
      );
      lastEmbedSendTimes.clear();
    }
  },
  60 * 60 * 1000
).unref(); // unref() allows the process to exit even if timer is active

// FINAL SOLUTION: Global registry of active add requests to prevent duplicates
// This will be used and shared across all components
global.addRequestRegistry = global.addRequestRegistry || new Map();

// CRITICAL: Additional global flag to prevent duplicate embeds at the source level
global.lastEmbedTime = global.lastEmbedTime || 0;
global.embedDeduplicationWindow = 5000; // 5 seconds deduplication window

// Set a 10 minute timer to clean up old registry entries (prevent memory leaks)
if (!global.addRegistryCleanupInitialized) {
  global.addRegistryCleanupInitialized = true;
  setInterval(
    () => {
      if (global.addRequestRegistry.size > 0) {
        logger.debug(
          `[Global] Periodic cleanup of addRequestRegistry (size: ${global.addRequestRegistry.size})`
        );
        const now = Date.now();
        for (const [key, data] of global.addRequestRegistry.entries()) {
          if (now - data.timestamp > 10 * 60 * 1000) {
            // 10 minutes
            global.addRequestRegistry.delete(key);
          }
        }
      }
    },
    10 * 60 * 1000
  ).unref();
}

// An array of embeds to always and completely block from appearing
const EMBEDS_TO_BLOCK = [
  'Successfully added personality: add-',
  'Successfully added personality: aria-ha-olam',
  'Successfully added personality: bartzabel-harsani',
  'Successfully added personality: bambi-prime-yakhas-isha',
  'Successfully added personality: lucifuge-rofocale-or-emet',
  'Successfully added personality: eris-at-heres',
  'Successfully added personality: uriel-rakhem',
];

/**
 * Checks if a rate limit is in effect for sending embed messages
 *
 * @returns {Object|null} Rate limit result object or null if no rate limit
 */
function checkRateLimit() {
  const now = Date.now();
  if (global.lastEmbedTime && now - global.lastEmbedTime < global.embedDeduplicationWindow) {
    logger.warn(
      `[Commands] GLOBAL RATE LIMIT: An embed was just sent ${now - global.lastEmbedTime}ms ago - blocking this request entirely`
    );
    return { id: `global-rate-limited-${now}`, isRateLimited: true };
  }
  return null;
}

/**
 * Checks if a request has already been processed
 *
 * @param {string} messageKey - Unique key for the message request
 * @returns {Object|null} Request status or null if not processed
 */
function checkDuplicateRequest(messageKey) {
  if (global.addRequestRegistry.has(messageKey)) {
    // We've already processed this message, check how it was handled
    const existingRequest = global.addRequestRegistry.get(messageKey);

    logger.info(
      `[Commands] DUPLICATE REQUEST: This message has already been processed: ${messageKey}`
    );
    logger.debug(`[Commands] Previous request: ${JSON.stringify(existingRequest)}`);

    // If the previous request was completed with an embed, block this one
    if (existingRequest.embedSent) {
      logger.warn(
        `[Commands] BLOCKING: Previous request already sent an embed - blocking this duplicate`
      );
      return { id: `blocked-duplicate-${Date.now()}`, isDuplicate: true };
    }

    // If the previous request is still in progress, wait for it to complete
    if (!existingRequest.completed) {
      logger.info(`[Commands] WAITING: Previous request is still in progress - returning early`);
      return { id: `waiting-for-completion-${Date.now()}`, isWaiting: true };
    }
  }
  return null;
}

/**
 * Registers a new add request to prevent duplicates
 *
 * @param {string} messageKey - Unique key for the message request
 * @param {string} addRequestId - Unique ID for this request
 * @param {Array<string>} args - Command arguments
 */
function registerNewRequest(messageKey, addRequestId, args) {
  global.addRequestRegistry.set(messageKey, {
    requestId: addRequestId,
    timestamp: Date.now(),
    profileName: args[0] || 'unknown',
    completed: false,
    embedSent: false,
  });

  logger.info(
    `[Commands] NEW REQUEST: Registered new add request: ${addRequestId} for message: ${messageKey}`
  );
}

/**
 * Checks if a command has already been completed
 *
 * @param {string} addCommandKey - Unique key for the command
 * @returns {Object|null} Command status or null if not completed
 */
function checkCompletedCommand(addCommandKey) {
  if (completedAddCommands.has(addCommandKey)) {
    logger.warn(
      `[Commands] CRITICAL: Add command ${addCommandKey} has already been processed to completion - completely ignoring repeat call`
    );
    return { id: 'repeat-prevented', isDuplicate: true };
  }
  return null;
}

/**
 * Marks a command as completed and sets up cleanup
 *
 * @param {string} addCommandKey - Unique key for the command
 */
function markCommandAsCompleted(addCommandKey) {
  // IMMEDIATELY add to completed commands set
  // We do this at the start to prevent ANY possibility of race conditions
  completedAddCommands.add(addCommandKey);
  logger.info(
    `[Commands] Added ${addCommandKey} to completedAddCommands set (size: ${completedAddCommands.size})`
  );

  // Set a timeout to clean up this entry after 10 minutes
  setTimeout(
    () => {
      if (completedAddCommands.has(addCommandKey)) {
        completedAddCommands.delete(addCommandKey);
        logger.info(
          `[Commands] Cleaned up ${addCommandKey} from completedAddCommands set after timeout`
        );
      }
    },
    10 * 60 * 1000
  ); // 10 minutes
}

/**
 * Helper function to safely get lowercase version of a string
 *
 * @param {string} str - String to convert
 * @returns {string} Lowercase string or empty string if input is falsy
 */
function safeToLowerCase(str) {
  if (!str) return '';
  return String(str).toLowerCase();
}

/**
 * Validates and parses arguments for the add command
 *
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Object} Parsed arguments object
 */
function validateAndParseArgs(message, args) {
  if (args.length < 1) {
    return { profileName: null };
  }

  const profileName = args[0];
  const alias = args[1] || null; // Optional alias

  // Create a unique key for this request - normalize to lowercase for case insensitive matching
  const requestKey = `${message.author.id}-${profileName.toLowerCase()}`;

  return { profileName, alias, requestKey };
}

/**
 * Handles pending requests to prevent duplicates
 *
 * @param {Object} message - Discord message object
 * @param {string} profileName - Name of the personality
 * @param {string} requestKey - Unique key for the request
 * @returns {Object|null} Response message or null if not a duplicate
 */
function handlePendingRequests(message, profileName, requestKey) {
  logger.info(`[Commands] Processing request key ${requestKey}`);

  // Check if this exact request is already being processed
  if (pendingAdditions.has(requestKey)) {
    const pendingData = pendingAdditions.get(requestKey);
    // Only block for 3 seconds to allow retries
    if (Date.now() - pendingData.timestamp < 3000) {
      logger.warn(
        `[Commands] Very recent duplicate request detected for ${profileName} by ${message.author.tag}, ignoring`
      );
      return message.reply(
        `You just tried to add this personality. Please wait a moment before trying again.`
      );
    } else {
      logger.info(
        `[Commands] Previous request found but enough time has passed, allowing new request`
      );
    }
  }

  // Clear any existing pending requests for this user-personality combo
  pendingAdditions.delete(requestKey);

  // Mark this request as being processed with more metadata (still useful for cleanup)
  pendingAdditions.set(requestKey, {
    timestamp: Date.now(),
    profileName: profileName,
    userId: message.author.id,
    channelId: message.channel.id,
    messageId: message.id,
  });

  return null;
}

/**
 * Checks if a personality already exists for the user
 *
 * @param {Object} message - Discord message object
 * @param {string} profileName - Name of the personality to check
 * @param {string} requestKey - Request key for cleanup
 * @returns {Object|null} Reply message if exists, null otherwise
 */
async function checkExistingPersonality(message, profileName, requestKey) {
  // Check if the personality already exists for this user
  const existingPersonalities = listPersonalitiesForUser(message.author.id);
  logger.info(
    `[Commands] Checking if ${profileName} already exists among ${existingPersonalities.length} personalities`
  );

  // Safely check for existing personality
  const normalizedProfileName = safeToLowerCase(profileName);
  const alreadyExists = existingPersonalities.some(p => {
    if (!p || !p.fullName) return false;
    return safeToLowerCase(p.fullName) === normalizedProfileName;
  });

  if (alreadyExists) {
    pendingAdditions.delete(requestKey); // Remove from pending
    return message.reply(`You already have a personality with the name \`${profileName}\`.`);
  }

  return null;
}

/**
 * Handles the initial personality registration step
 *
 * @param {Object} message - Discord message object
 * @param {string} profileName - Name of the personality to register
 * @returns {Promise<Object>} The registered personality object
 * @throws {Error} If registration fails
 */
async function registerInitialPersonality(message, profileName) {
  logger.info(`[Commands] Step 1: Initial personality registration for ${profileName}`);

  // Register the personality first - this doesn't fetch profile info
  logger.info(
    `[Commands] Calling registerPersonality with userId=${message.author.id}, profileName=${profileName}`
  );
  let initialPersonality; // Declare variable outside try block so it's accessible later

  try {
    initialPersonality = await registerPersonality(
      message.author.id,
      profileName,
      {
        description: `Added by ${message.author.tag}`,
      },
      false
    ); // false = don't fetch profile info in the same call

    if (!initialPersonality) {
      logger.error(`[Commands] registerPersonality returned null or undefined!`);
      throw new Error('Personality registration failed - returned null');
    }

    logger.info(
      `[Commands] Initial registration completed successfully:`,
      JSON.stringify({
        fullName: initialPersonality.fullName,
        displayName: initialPersonality.displayName,
        hasAvatar: !!initialPersonality.avatarUrl,
      })
    );

    return initialPersonality;
  } catch (regError) {
    logger.error(`[Commands] Error during personality registration:`, regError);
    // Include a descriptive message for the user
    throw new Error(`Failed to register personality: ${regError.message}`);
  }
}

/**
 * Fetches profile information for a personality
 *
 * @param {string} profileName - Name of the personality
 * @param {Object} initialPersonality - The initial personality object to update
 * @returns {Promise<Object>} Display name and avatar URL
 */
async function fetchProfileInfo(profileName, initialPersonality) {
  logger.info(`[Commands] Step 2: Fetching profile info explicitly...`);
  const profileInfoFetcher = require('./profileInfoFetcher');

  let displayName = null;
  let avatarUrl = null;

  // Fetch basic profile data
  logger.info(`[Commands] Making direct calls to profile info fetcher for ${profileName}`);

  try {
    const profileData = await profileInfoFetcher.fetchProfileInfo(profileName);
    if (profileData) {
      logger.debug(`[Commands] RAW profile data: ${JSON.stringify(profileData).substring(0, 200)}`);
    } else {
      logger.warn(`[Commands] Profile data fetch returned null or undefined`);
    }
  } catch (infoError) {
    logger.error(`[Commands] Error fetching profile data:`, infoError);
    // Continue despite this error
  }

  // Get display name with fallback to profile name
  try {
    displayName = await profileInfoFetcher.getProfileDisplayName(profileName);
    logger.info(`[Commands] Got display name: ${displayName}`);
  } catch (nameError) {
    logger.error(`[Commands] Error fetching display name:`, nameError);
    // If we can't get the display name, use the profile name
    displayName = profileName;
    logger.info(`[Commands] Using profileName as fallback: ${displayName}`);
  }

  // Get avatar URL
  try {
    avatarUrl = await profileInfoFetcher.getProfileAvatarUrl(profileName);
    logger.info(`[Commands] Got avatar URL: ${avatarUrl}`);
  } catch (avatarError) {
    logger.error(`[Commands] Error fetching avatar URL:`, avatarError);
  }

  logger.info(
    `[Commands] Fetched profile info: displayName=${displayName}, hasAvatar=${!!avatarUrl}, avatarUrl=${avatarUrl}`
  );

  // Update the initial personality with fetched data
  if (displayName) {
    logger.info(`[Commands] Setting display name: ${displayName}`);
    initialPersonality.displayName = displayName;
  } else {
    // Ensure we always have a display name
    logger.info(`[Commands] No display name found, using profile name`);
    initialPersonality.displayName = profileName;
  }

  if (avatarUrl) {
    logger.info(`[Commands] Setting avatar URL: ${avatarUrl}`);
    initialPersonality.avatarUrl = avatarUrl;
  }

  return { displayName, avatarUrl };
}

/**
 * Updates and saves the personality with fetched profile information
 *
 * @param {string} profileName - Name of the personality
 * @param {string} displayName - Display name to update
 * @param {string} avatarUrl - Avatar URL to update
 * @returns {Promise<void>}
 */
async function updateAndSavePersonality(profileName, displayName, avatarUrl) {
  // Get the saved personality from store
  logger.info(`[Commands] Getting personality from store to ensure latest version`);
  const savedPersonality = getPersonality(profileName);

  if (!savedPersonality) {
    logger.error(`[Commands] Failed to retrieve personality from store after registration!`);
    // Don't throw, just log the error and continue
    logger.error(`[Commands] Will attempt to continue with initialPersonality object`);
  } else {
    // Update the saved personality with our fetched info
    logger.info(`[Commands] Updating saved personality with display name and avatar`);
    if (displayName) {
      savedPersonality.displayName = displayName;
    }
    if (avatarUrl) {
      savedPersonality.avatarUrl = avatarUrl;
    }

    // Explicitly save all personality data to ensure it's persisted
    logger.info(`[Commands] Saving all personality data`);
    const personalityManager = require('./personalityManager');
    await personalityManager.saveAllPersonalities();
    logger.info(`[Commands] Updated and saved personality with display name and avatar`);
  }
}

/**
 * Sets up all aliases for a personality
 *
 * @param {string} profileName - Name of the personality
 * @param {string} alias - User-provided alias (if any)
 * @param {Object} initialPersonality - The initial personality object
 * @returns {Promise<void>}
 */
async function setupPersonalityAliases(profileName, alias, initialPersonality) {
  logger.info(`[Commands] Step 3: Setting up aliases - THIS IS THE CRITICAL SECTION`);

  // CRITICAL FIX: This is where we're setting aliases multiple times which is causing multiple embed responses
  // We need to modify our approach to prevent multiple alias settings

  // Get all current aliases for this personality to avoid duplicate settings
  const existingAliases = [];
  const personalityManager = require('./personalityManager');
  const allAliases = personalityManager.personalityAliases;

  // Check which aliases already exist for this profile
  for (const [aliasKey, targetProfile] of Object.entries(allAliases)) {
    if (targetProfile === profileName) {
      existingAliases.push(aliasKey.toLowerCase());
      logger.debug(`[Commands] Found existing alias: ${aliasKey} -> ${profileName}`);
    }
  }

  // Collect all aliases to set, then set them all at once with a single save
  const aliasesToSet = [];

  // IMPROVEMENT: Skip self-referential aliases entirely since they're redundant
  // @mentions directly work with the personality's full name without needing an alias
  const selfReferentialAlias = profileName.toLowerCase();
  logger.info(
    `[Commands] Skipping self-referential alias creation for ${selfReferentialAlias} - no longer needed with improved @mention support`
  );
  
  // Add to existingAliases to ensure we don't try to add it elsewhere
  if (!existingAliases.includes(selfReferentialAlias)) {
    existingAliases.push(selfReferentialAlias);
  }

  // Now handle the manual alias if provided - but check if it already exists first
  if (alias) {
    const normalizedAlias = alias.toLowerCase();
    if (
      !existingAliases.includes(normalizedAlias) &&
      normalizedAlias !== profileName.toLowerCase()
    ) {
      aliasesToSet.push(normalizedAlias);
      logger.info(`[Commands] Will set NEW manual alias: ${normalizedAlias} -> ${profileName}`);
      existingAliases.push(normalizedAlias);
    } else {
      logger.info(
        `[Commands] Manual alias ${normalizedAlias} already exists or matches profile name - skipping`
      );
    }
  }

  // Handle the display name alias - but check if it already exists first
  if (initialPersonality.displayName) {
    const displayNameAlias = initialPersonality.displayName.toLowerCase();
    if (
      !existingAliases.includes(displayNameAlias) &&
      displayNameAlias !== profileName.toLowerCase()
    ) {
      aliasesToSet.push(displayNameAlias);
      logger.info(
        `[Commands] Will set NEW display name alias: ${displayNameAlias} -> ${profileName}`
      );
    } else {
      logger.info(
        `[Commands] Display name alias ${displayNameAlias} already exists or matches profile name - skipping`
      );
    }
  }

  // Collect all aliases to set, then set them all without saving - we'll do ONE save at the end
  logger.info(
    `[Commands] Setting ${aliasesToSet.length} aliases with deferred save (no saves until end of process)`
  );

  // Sort the aliases so that display name aliases come last (they're more likely to have conflicts)
  const sortedAliases = aliasesToSet.slice().sort((a, b) => {
    const aIsDisplayName = a.toLowerCase() === initialPersonality.displayName?.toLowerCase();
    const bIsDisplayName = b.toLowerCase() === initialPersonality.displayName?.toLowerCase();
    return aIsDisplayName === bIsDisplayName ? 0 : aIsDisplayName ? 1 : -1;
  });

  // Create a collection for all alternate aliases that might be created for display name collisions
  const alternateAliases = [];

  // Set all aliases without any saves
  for (let i = 0; i < sortedAliases.length; i++) {
    const currentAlias = sortedAliases[i];
    const isDisplayName =
      currentAlias.toLowerCase() === initialPersonality.displayName?.toLowerCase();

    // IMPORTANT: Never save from setPersonalityAlias - all saves will happen once at the end
    logger.info(
      `[Commands] Setting alias ${i + 1}/${sortedAliases.length}: ${currentAlias} -> ${profileName} (isDisplayName: ${isDisplayName})`
    );
    const result = await setPersonalityAlias(currentAlias, profileName, true, isDisplayName);

    // Collect any alternate aliases that were created for display name collisions
    if (result.alternateAliases && result.alternateAliases.length > 0) {
      alternateAliases.push(...result.alternateAliases);
      logger.info(
        `[Commands] Collected alternate aliases for collision: ${result.alternateAliases.join(', ')}`
      );
    }

    logger.info(
      `[Commands] Completed setting alias ${i + 1}/${sortedAliases.length}: ${currentAlias} -> ${profileName} (skipSave: true)`
    );
  }

  // Log the alternate aliases if any were created
  if (alternateAliases.length > 0) {
    logger.info(
      `[Commands] Created ${alternateAliases.length} alternate aliases for display name collisions: ${alternateAliases.join(', ')}`
    );
  }

  // CRITICAL FIX: Perform a single save for all alias operations
  logger.info(`[Commands] 💾 SINGLE SAVE OPERATION: Saving all personalities and aliases at once`);
  await personalityManagerFunctions.saveAllPersonalities();
  logger.info(`[Commands] ✅ Completed single save operation for all aliases`);
}

/**
 * Finalizes personality data and preloads avatar
 *
 * @param {string} profileName - Name of the personality
 * @param {string} displayName - Display name to use if not set
 * @param {string} avatarUrl - Avatar URL to use if not set
 * @returns {Promise<Object>} The finalized personality object
 */
async function finalizePersonalityData(profileName, displayName, avatarUrl) {
  logger.info(`[Commands] Step 4: Saving profile data and pre-loading avatar`);

  // Get the personality with all updates - without an explicit save
  // We'll perform a single save at the end
  logger.info(`[Commands] Getting personality from store (without explicit save)`);
  const finalPersonality = getPersonality(profileName);

  if (!finalPersonality) {
    logger.error(`[Commands] Error: Personality registration returned no data for ${profileName}`);
    throw new Error('Failed to register personality');
  }

  logger.debug(`[Commands] Final personality after all updates:`, {
    fullName: finalPersonality.fullName,
    displayName: finalPersonality.displayName,
    hasAvatar: !!finalPersonality.avatarUrl,
  });

  // Add extra safety checks for display name and avatar
  let needsSave = false;

  if (!finalPersonality.displayName && displayName) {
    logger.info(`[Commands] Setting display name again: ${displayName}`);
    finalPersonality.displayName = displayName;
    needsSave = true;
  } else if (!finalPersonality.displayName) {
    logger.info(`[Commands] No display name found, using profile name: ${profileName}`);
    finalPersonality.displayName = profileName;
    needsSave = true;
  }

  if (!finalPersonality.avatarUrl && avatarUrl) {
    logger.info(`[Commands] Setting avatar URL again: ${avatarUrl}`);
    finalPersonality.avatarUrl = avatarUrl;
    needsSave = true;
  } else if (!finalPersonality.avatarUrl) {
    logger.info(`[Commands] No avatar URL found in final personality object`);
    // Try one more explicit fetch from the API
    try {
      logger.info(`[Commands] Making one final attempt to fetch avatar URL...`);
      const profileInfoFetcher = require('./profileInfoFetcher');
      const finalAttemptUrl = await profileInfoFetcher.getProfileAvatarUrl(profileName);
      if (finalAttemptUrl) {
        logger.info(
          `[Commands] Successfully fetched avatar URL in final attempt: ${finalAttemptUrl}`
        );
        finalPersonality.avatarUrl = finalAttemptUrl;
        needsSave = true;
      }
    } catch (err) {
      logger.error(`[Commands] Final avatar URL fetch attempt failed:`, err);
    }
  }

  // Perform a single save if needed
  if (needsSave) {
    logger.info(`[Commands] 💾 SECOND SAVE OPERATION: Saving personality data with any updates`);
    await personalityManagerFunctions.saveAllPersonalities();
    logger.info(`[Commands] ✅ Completed second save operation for personality updates`);
  }

  // Pre-load avatar if available - this ensures it shows up correctly on first use
  if (finalPersonality.avatarUrl) {
    logger.info(`[Commands] Pre-loading avatar for new personality: ${finalPersonality.avatarUrl}`);
    try {
      // Use fetch to warm up the avatar URL first with proper error handling and timeout
      const fetch = require('node-fetch');
      const response = await fetch(finalPersonality.avatarUrl, {
        method: 'GET',
        timeout: 5000, // 5 second timeout to prevent hanging
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      if (!response.ok) {
        logger.error(`[Commands] Avatar image fetch failed with status: ${response.status}`);
      } else {
        // Read the response body to fully load it into Discord's cache
        const buffer = await response.buffer();
        logger.debug(`[Commands] Explicitly pre-fetched avatar URL (${buffer.length} bytes)`);
      }

      // Then use the webhook manager's preload function with our own direct URL
      await preloadPersonalityAvatar({
        ...finalPersonality,
        avatarUrl: finalPersonality.avatarUrl, // Ensure it's using the correct URL
      });
      logger.info(`[Commands] Avatar pre-loaded successfully for ${finalPersonality.displayName}`);

      // No save needed here - we'll do a final save before sending the embed
    } catch (avatarError) {
      logger.error(`[Commands] Avatar pre-loading failed, but continuing:`, avatarError);
      // Continue despite error - not critical
    }
  }

  return finalPersonality;
}

/**
 * Creates and sends the final embed response
 *
 * @param {Object} message - Discord message object
 * @param {string} profileName - Name of the personality
 * @param {string} messageKey - Registry key for deduplication
 * @param {Object} finalPersonality - Final personality object
 * @param {string} alias - User-provided alias
 * @param {string} displayName - Display name for the personality
 * @param {string} avatarUrl - Avatar URL for the personality
 * @param {string} requestKey - Request key for cleanup
 * @returns {Promise<Object>} Response message or status object
 */
async function createAndSendEmbed(
  message,
  profileName,
  messageKey,
  finalPersonality,
  alias,
  displayName,
  avatarUrl,
  requestKey
) {
  logger.info(`[Commands] Step 5: Sending final response with complete info`);

  // Update our registry entry to mark this as completed
  if (global.addRequestRegistry.has(messageKey)) {
    const registryEntry = global.addRequestRegistry.get(messageKey);
    registryEntry.completed = true;
    global.addRequestRegistry.set(messageKey, registryEntry);
    logger.debug(`[Commands] ✅ Updated registry: marked ${messageKey} as completed`);
  }

  // CRITICAL FIX: Final save operation before creating embed
  logger.info(
    `[Commands] 💾 FINAL SAVE OPERATION: Ensuring all data is persisted before creating embed`
  );
  await personalityManagerFunctions.saveAllPersonalities();
  logger.info(`[Commands] ✅ Completed final save operation`);

  // Get the very latest data after final save
  const veryFinalPersonality = getPersonality(profileName);

  // Use this with our forced loaded data
  const displayNameToUse = veryFinalPersonality.displayName || displayName || profileName;
  const avatarUrlToUse = veryFinalPersonality.avatarUrl || avatarUrl;

  logger.debug(
    `[Commands] FINAL DATA FOR EMBED: displayName=${displayNameToUse}, hasAvatar=${!!avatarUrlToUse}, avatarUrl=${avatarUrlToUse}`
  );

  // =========================================================================
  // CRITICAL: Check if this embed should be blocked based on content
  // =========================================================================
  const embedDescription = `Successfully added personality: ${displayNameToUse}`;

  // ULTRA-EXTREME: Block embeds for specific personalities by name
  // This is a last resort to prevent duplicates
  for (const blockPattern of EMBEDS_TO_BLOCK) {
    if (embedDescription.includes(blockPattern)) {
      logger.warn(
        `[Commands] 🛑 EMERGENCY BLOCK: Found blocked embed pattern "${blockPattern}" in "${embedDescription}"`
      );
      logger.warn(`[Commands] Blocking this embed for a known problematic personality`);

      // Still mark as completed for cleanup purposes
      pendingAdditions.delete(requestKey);

      // Return a fake response to indicate we handled the command
      return { id: `emergency-blocked-${Date.now()}`, isEmergencyBlocked: true };
    }
  }

  // Create an embed with the finalized personality info
  const embed = new EmbedBuilder()
    .setTitle('Personality Added')
    .setDescription(embedDescription)
    .setColor('#00FF00')
    .addFields(
      { name: 'Full Name', value: profileName },
      { name: 'Display Name', value: displayNameToUse || 'Not set' },
      {
        name: 'Alias',
        value:
          alias ||
          (displayNameToUse && displayNameToUse.toLowerCase() !== profileName.toLowerCase()
            ? displayNameToUse.toLowerCase()
            : 'None set'),
      }
    );

  // Add the avatar to the embed if available
  if (avatarUrlToUse) {
    // Validate the URL format first
    const isValidUrl = urlString => {
      try {
        return Boolean(new URL(urlString));
      } catch {
        return false;
      }
    };

    if (isValidUrl(avatarUrlToUse)) {
      logger.debug(`[Commands] Adding avatar URL to embed: ${avatarUrlToUse}`);
      embed.setThumbnail(avatarUrlToUse);
    } else {
      logger.error(`[Commands] Invalid avatar URL format: ${avatarUrlToUse}`);
    }
  } else {
    logger.debug(`[Commands] No avatar URL available for embed`);
  }

  // Update registry to note we're sending an embed
  if (global.addRequestRegistry.has(messageKey)) {
    const registryEntry = global.addRequestRegistry.get(messageKey);
    registryEntry.embedPrepared = true;
    global.addRequestRegistry.set(messageKey, registryEntry);
    logger.debug(`[Commands] ✅ Updated registry: marked ${messageKey} as embedPrepared`);
  }

  // FINAL APPROACH: Use a globally tracked direct API call
  // This completely bypasses all Discord.js race conditions and duplicate logic

  logger.info(`[Commands] 📤 SENDING: Using direct REST API call to send embed`);
  let responseMsg;

  try {
    // CRITICAL UPDATE: We've stopped using time-based deduplication for personality embeds
    // Instead, we're specifically detecting and deleting incomplete embeds in bot.js

    // We're keeping this message for debugging purposes
    const now = Date.now();
    if (global.lastEmbedTime && now - global.lastEmbedTime < global.embedDeduplicationWindow) {
      logger.info(
        `[Commands] ⚠️ NOTE: Another embed was sent ${now - global.lastEmbedTime}ms ago, but we will NOT block this complete embed`
      );
      logger.info(
        `[Commands] ✅ SENDING ANYWAY: This is the high-quality embed with complete info`
      );
    }

    // Final check - has another process already sent an embed for this message?
    if (global.addRequestRegistry.has(messageKey)) {
      const registryEntry = global.addRequestRegistry.get(messageKey);
      if (registryEntry.embedSent) {
        logger.warn(
          `[Commands] ⚠️ LAST-MINUTE BLOCK: Embed already sent for ${messageKey} - preventing duplicate`
        );
        return { id: `last-minute-blocked-${Date.now()}`, isLastMinuteBlocked: true };
      }
    }

    // Update global time tracker immediately to prevent race conditions
    global.lastEmbedTime = now;
    logger.debug(`[Commands] ⏱️ Setting global lastEmbedTime to ${now}`);

    // Get the Discord.js REST instance
    const { REST } = require('discord.js');
    const restInstance = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    // Prepare the API payload
    const payload = {
      content: '', // No text content, just the embed
      embeds: [embed.toJSON()], // Convert the embed to JSON
      message_reference: {
        // Set up the reply reference
        message_id: message.id,
        channel_id: message.channel.id,
        guild_id: message.guild?.id,
      },
      allowed_mentions: {
        parse: ['users', 'roles'],
      },
    };

    // Log that we're making a direct API call for better debugging
    logger.info(`[Commands] 📝 NOTE: Making direct API call to send embed with all complete data`);

    // Call the Discord API directly
    logger.info(
      `[Commands] 📞 API CALL: Sending direct API call to create message - WILL OVERRIDE time check`
    );

    // CRITICAL UPDATE: Force the API call even if we've sent an embed recently
    // The earlier embed has incomplete data, and this one has the full name, display name, and avatar
    logger.info(
      `[Commands] 🔥 FORCING SEND: This is the high-quality embed with complete data - ignoring time check`
    );

    // Reset the global time tracker to avoid blocking this embed
    global.lastEmbedTime = 0;

    const result = await restInstance.post(`/channels/${message.channel.id}/messages`, {
      body: payload,
    });

    // Create a fake Message object to maintain API compatibility
    responseMsg = {
      id: result.id,
      channel: message.channel,
      author: { id: 'direct-api-call' },
      content: '',
      embeds: [embed],
    };

    logger.info(
      `[Commands] ✅ SUCCESS: Sent personality embed with direct API call, ID: ${responseMsg.id}`
    );

    // Mark in global registry that we've sent an embed for this message
    if (global.addRequestRegistry.has(messageKey)) {
      const registryEntry = global.addRequestRegistry.get(messageKey);
      registryEntry.embedSent = true;
      registryEntry.embedId = responseMsg.id;
      global.addRequestRegistry.set(messageKey, registryEntry);
      logger.debug(
        `[Commands] ✅ Updated registry: marked ${messageKey} as embedSent with ID ${responseMsg.id}`
      );
    }
  } catch (apiError) {
    logger.error(`[Commands] ❌ ERROR: Direct API call failed:`, apiError);

    // Fall back to normal message.reply only if we haven't sent an embed yet
    logger.info(`[Commands] 🔄 FALLBACK: Trying normal message.reply`);

    let embedAlreadySentByOtherProcess = false;

    // Final check - did another process already send an embed for this message while we were working?
    if (global.addRequestRegistry.has(messageKey)) {
      const registryEntry = global.addRequestRegistry.get(messageKey);
      if (registryEntry.embedSent) {
        logger.warn(
          `[Commands] ⚠️ FALLBACK BLOCKED: Embed already sent for ${messageKey} by another process`
        );
        embedAlreadySentByOtherProcess = true;
      }
    }

    if (!embedAlreadySentByOtherProcess) {
      responseMsg = await message.reply({ embeds: [embed] });
      logger.info(`[Commands] ✅ SUCCESS: Sent embed with fallback method, ID: ${responseMsg.id}`);

      // Mark in global registry that we've sent an embed for this message
      if (global.addRequestRegistry.has(messageKey)) {
        const registryEntry = global.addRequestRegistry.get(messageKey);
        registryEntry.embedSent = true;
        registryEntry.embedId = responseMsg.id;
        global.addRequestRegistry.set(messageKey, registryEntry);
        logger.debug(
          `[Commands] ✅ Updated registry: marked ${messageKey} as embedSent with ID ${responseMsg.id}`
        );
      }
    } else {
      // Create a dummy response object to maintain API compatibility
      responseMsg = { id: `blocked-fallback-${Date.now()}`, isDuplicateBlocked: true };
    }
  }

  // Add a small delay before sending the embed to ensure everything is complete
  logger.debug(`[Commands] ⏱️ DELAY: Adding 1-second delay before sending final embed`);
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Return the response
  return responseMsg;
}

// Completely reimplemented add command with global deduplication
async function handleAddCommand(message, args) {
  // Check for rate limiting
  const rateLimitResult = checkRateLimit();
  if (rateLimitResult) return rateLimitResult;

  // Create a truly unique ID for this specific add request
  const addRequestId = `add-req-${message.id}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  // Create a key specifically for this message+args combination
  const messageKey = `add-msg-${message.id}-${args.join('-')}`;

  // Check for duplicate requests
  const duplicateResult = checkDuplicateRequest(messageKey);
  if (duplicateResult) return duplicateResult;

  // Register this request immediately to prevent double processing
  registerNewRequest(messageKey, addRequestId, args);

  // Check if we've already processed this exact command fully
  const addCommandKey = `${message.id}-${message.channel.id}-${args.join('-')}`;

  // Check if the command has already been completed
  const completedResult = checkCompletedCommand(addCommandKey);
  if (completedResult) return completedResult;

  // Message ID deduplication is now handled centrally in processCommand
  logger.info(`[Commands] Processing add command with message ${message.id}`);

  // Mark as completed and set up cleanup
  markCommandAsCompleted(addCommandKey);

  // Validate arguments and parse profile information
  const validationResult = validateAndParseArgs(message, args);
  if (!validationResult.profileName) {
    return message.reply(
      `Please provide a profile name. Usage: \`${botPrefix} add <profile_name> [alias]\``
    );
  }

  const { profileName, alias, requestKey } = validationResult;

  // Check if this is a duplicate request and handle pending requests
  const pendingRequestResult = handlePendingRequests(message, profileName, requestKey);
  if (pendingRequestResult) return pendingRequestResult;

  try {
    // Check if the personality already exists for this user
    const existingCheckResult = await checkExistingPersonality(message, profileName, requestKey);
    if (existingCheckResult) return existingCheckResult;

    // No loading message - we'll do all the work first and only send one message at the end
    logger.info(
      `[Commands] Starting personality registration process for ${profileName} (no loading message)`
    );

    try {
      // STEP 1: Register the base personality
      const initialPersonality = await registerInitialPersonality(message, profileName);

      // STEP 2: Fetch profile info separately
      const { displayName, avatarUrl } = await fetchProfileInfo(profileName, initialPersonality);

      // STEP 3: Update and save the personality
      await updateAndSavePersonality(profileName, displayName, avatarUrl);

      // STEP 4: Set up aliases
      await setupPersonalityAliases(profileName, alias, initialPersonality);

      // STEP 5: Save final profile data and pre-load avatar
      const finalPersonality = await finalizePersonalityData(profileName, displayName, avatarUrl);

      // STEP 6: Send final response
      return await createAndSendEmbed(
        message,
        profileName,
        messageKey,
        finalPersonality,
        alias,
        displayName,
        avatarUrl,
        requestKey
      );
    } catch (innerError) {
      logger.error(`[Commands] Inner error during personality registration:`, innerError);

      // Send error message - no loading message to update
      try {
        const errorResponse = await message.reply(
          `Failed to complete the personality registration: ${innerError.message}`
        );
        logger.info(`[Commands] Sent error response with ID: ${errorResponse.id}`);

        // Clear pending even on error
        pendingAdditions.delete(requestKey);

        // Return the error response to indicate we've handled this command
        return errorResponse;
      } catch (err) {
        logger.error(`[Commands] Error sending error message:`, err);
        // Clear pending even on error
        pendingAdditions.delete(requestKey);
        // Return something to indicate we've handled this command
        return null;
      }
    }
  } catch (error) {
    logger.error(`Error adding personality ${profileName}:`, error);

    // Clear pending on error
    pendingAdditions.delete(requestKey);

    // Return a proper response to the user
    const errorResponse = await message.reply(
      `Failed to add personality \`${profileName}\`. Error: ${error.message}`
    );
    logger.info(`[Commands] Sent error response with ID: ${errorResponse.id}`);

    // Return the error response to indicate we've handled this command
    return errorResponse;
  } finally {
    // Ensure we always clean up, even if an unexpected error occurs

    setTimeout(() => {
      if (pendingAdditions.has(requestKey)) {
        const pendingData = pendingAdditions.get(requestKey);
        const elapsedTime = Date.now() - pendingData.timestamp;

        if (elapsedTime > 30000) {
          logger.debug(
            `[Commands] Cleaning up stale pending addition request for ${requestKey} after ${elapsedTime}ms`
          );
          pendingAdditions.delete(requestKey);
        }
      }
    }, 30000); // Clean up after 30 seconds no matter what

    // Add a periodic cleaner for all pending additions - runs every 2 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of pendingAdditions.entries()) {
        if (now - data.timestamp > 120000) {
          // Clean entries older than 2 minutes
          logger.debug(
            `[Commands] Automatic cleanup of stale pending addition: ${data.profileName}`
          );
          pendingAdditions.delete(key);
        }
      }
    }, 120000).unref(); // unref() allows the process to exit even if timer is active
  }
}

/**
 * Handle the list command
 * @param {Object} message - Discord message object
 */
async function handleListCommand(message) {
  // Get all personalities for the user
  const personalities = listPersonalitiesForUser(message.author.id);

  if (personalities.length === 0) {
    return message.reply(
      `You haven't added any personalities yet. Use \`${botPrefix} add <profile_name>\` to add one.`
    );
  }

  // Create an embed with the list using the helper function
  const embed = embedHelpers.createPersonalityListEmbed(message.author.id);

  return message.reply({ embeds: [embed] });
}

/**
 * Handle the alias command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAliasCommand(message, args) {
  if (args.length < 2) {
    return message.reply(
      `Please provide a profile name and an alias. Usage: \`${botPrefix} alias <profile_name> <alias>\``
    );
  }

  const profileName = args[0];
  const newAlias = args[1];

  // Check if the personality exists
  const personality = getPersonality(profileName);

  if (!personality) {
    return message.reply(
      `Personality \`${profileName}\` not found. Use \`${botPrefix} list\` to see your personalities.`
    );
  }

  // Check if the personality belongs to the user
  if (personality.createdBy !== message.author.id) {
    return message.reply(`Personality \`${profileName}\` doesn't belong to you.`);
  }

  // Check if the alias is already in use
  const existingPersonality = getPersonalityByAlias(newAlias);

  if (existingPersonality && existingPersonality.fullName !== profileName) {
    return message.reply(
      `Alias \`${newAlias}\` is already in use for personality \`${existingPersonality.fullName}\`.`
    );
  }

  // Set the alias
  setPersonalityAlias(newAlias, profileName);

  return message.reply(
    `Alias \`${newAlias}\` set for personality \`${personality.displayName || profileName}\`.`
  );
}

/**
 * Handle the remove command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleRemoveCommand(message, args) {
  if (args.length < 1) {
    return message.reply(
      `Please provide a profile name. Usage: \`${botPrefix} remove <profile_name>\``
    );
  }

  const profileName = args[0];

  // Try with alias first
  let personality = getPersonalityByAlias(profileName);

  // If not found by alias, try with full name
  if (!personality) {
    personality = getPersonality(profileName);
  }

  if (!personality) {
    return message.reply(
      `Personality \`${profileName}\` not found. Use \`${botPrefix} list\` to see your personalities.`
    );
  }

  // Check if the personality belongs to the user
  if (personality.createdBy !== message.author.id) {
    return message.reply(`Personality \`${personality.fullName}\` doesn't belong to you.`);
  }

  // Remove the personality
  const success = removePersonality(personality.fullName);

  if (success) {
    return message.reply(
      `Personality \`${personality.displayName || personality.fullName}\` removed.`
    );
  } else {
    return message.reply(`Failed to remove personality \`${personality.fullName}\`.`);
  }
}

/**
 * Handle the info command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleInfoCommand(message, args) {
  if (args.length < 1) {
    return message.reply(
      `Please provide a profile name or alias. Usage: \`${botPrefix} info <profile_name>\``
    );
  }

  const profileQuery = args[0];

  // Try with alias first
  let personality = getPersonalityByAlias(profileQuery);

  // If not found by alias, try with full name
  if (!personality) {
    personality = getPersonality(profileQuery);
  }

  if (!personality) {
    return message.reply(
      `Personality \`${profileQuery}\` not found. Use \`${botPrefix} list\` to see your personalities.`
    );
  }

  // Find all aliases for this personality
  const aliases = utils.getAllAliasesForPersonality(
    personality.fullName,
    personalityManagerFunctions.personalityAliases
  );

  // Create an embed with the personality info
  const embed = embedHelpers.createPersonalityInfoEmbed(personality, aliases);

  return message.reply({ embeds: [embed] });
}

/**
 * Handle the reset command (clears conversation)
 * @param {Object} message - Discord message object
 */
async function handleResetCommand(message) {
  const cleared = clearConversation(message.author.id, message.channel.id);

  if (cleared) {
    return message.reply(
      'Conversation history cleared. The next message will start a new conversation.'
    );
  } else {
    return message.reply('No active conversation to clear.');
  }
}

/**
 * Handle the activate command (channel-wide activation)
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleActivateCommand(message, args) {
  // Check if user has Manage Messages permission
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return message.reply('You need the "Manage Messages" permission to use this command.');
  }

  if (args.length < 1) {
    return message.reply(
      `Please provide a personality name or alias. Usage: \`${botPrefix} activate <personality>\``
    );
  }

  const personalityQuery = args[0];

  // Try with alias first
  let personality = getPersonalityByAlias(personalityQuery);

  // If not found by alias, try with full name
  if (!personality) {
    personality = getPersonality(personalityQuery);
  }

  if (!personality) {
    return message.reply(
      `Personality \`${personalityQuery}\` not found. Use \`${botPrefix} list\` to see your personalities.`
    );
  }

  // Activate the personality in this channel
  activatePersonality(message.channel.id, personality.fullName, message.author.id);

  return message.reply(
    `**Channel-wide activation:** ${personality.displayName || personality.fullName} will now respond to all messages in this channel from any user. Use \`${botPrefix} deactivate\` to turn this off.`
  );
}

/**
 * Handle the deactivate command (channel-wide deactivation)
 * @param {Object} message - Discord message object
 */
async function handleDeactivateCommand(message) {
  // Check if user has Manage Messages permission
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return message.reply('You need the "Manage Messages" permission to use this command.');
  }

  const deactivated = deactivatePersonality(message.channel.id);

  if (deactivated) {
    return message.reply(
      `**Channel-wide activation disabled.** Personalities will now only respond to direct mentions, replies, or users with auto-response enabled.`
    );
  } else {
    return message.reply(`No personality was activated in this channel.`);
  }
}

/**
 * Handle the autorespond command (user-specific toggle)
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAutoRespondCommand(message, args) {
  // Import the functions we need from conversationManager
  const {
    enableAutoResponse,
    disableAutoResponse,
    isAutoResponseEnabled,
  } = require('./conversationManager');

  // Parse the on/off argument
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand || !['on', 'off', 'status'].includes(subCommand)) {
    return message.reply(
      `Please specify 'on', 'off', or 'status'. Usage: \`${botPrefix} autorespond <on|off|status>\``
    );
  }

  const userId = message.author.id;

  if (subCommand === 'status') {
    const status = isAutoResponseEnabled(userId) ? 'enabled' : 'disabled';
    return message.reply(
      `Your auto-response is currently **${status}**. When enabled, a personality will continue responding to your messages after you mention or reply to it.`
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
async function handleStatusCommand(message) {
  // Get Discord client from global scope rather than importing from bot.js to avoid circular dependency
  const client = global.tzurotClient;

  if (!client) {
    return message.reply('Bot client not properly initialized. Please try again later.');
  }

  // Count total personalities - use the personalityManager's listPersonalitiesForUser with no filter
  const allPersonalities = listPersonalitiesForUser();
  const totalPersonalities = allPersonalities ? allPersonalities.length : 0;
  const userPersonalities = listPersonalitiesForUser(message.author.id).length;

  const embed = embedHelpers.createStatusEmbed(client, totalPersonalities, userPersonalities);

  return message.reply({ embeds: [embed] });
}

// formatUptime has been moved to embedHelpers.js

/**
 * Handle the debug command - only available to administrators
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleDebugCommand(message, args) {
  if (args.length < 1) {
    return message.reply(`Please specify a debug subcommand. Available subcommands: \`problems\`, \`seedpersonalities\``);
  }

  const subCommand = args[0].toLowerCase();

  switch (subCommand) {
    case 'problems':
    case 'problematic':
      return await handleDebugProblematicCommand(message, args.slice(1));
      
    case 'seedpersonalities':
    case 'seed':
      return await handleDebugSeedPersonalitiesCommand(message);

    default:
      return message.reply(
        `Unknown debug subcommand: \`${subCommand}\`. Available subcommands: \`problems\`, \`seedpersonalities\``
      );
  }
}

/**
 * Handle the debug seed personalities command to manually trigger owner personality seeding
 * @param {Object} message - Discord message object
 */
async function handleDebugSeedPersonalitiesCommand(message) {
  // Import needed functions
  const { USER_CONFIG } = require('./constants');
  const { seedOwnerPersonalities } = require('./personalityManager');
  
  // Check if the user is the owner
  if (message.author.id !== USER_CONFIG.OWNER_ID) {
    return message.reply('This command can only be used by the bot owner.');
  }
  
  try {
    // Show initiating message
    await message.reply('Seeding personalities from constants.js... This may take a moment.');
    
    // Run the seeding operation
    await seedOwnerPersonalities();
    
    // Return success
    return message.reply('✅ Personalities successfully seeded from constants.js configuration.');
  } catch (error) {
    logger.error(`[Commands] Error seeding personalities: ${error.message}`);
    return message.reply(`❌ Error seeding personalities: ${error.message}`);
  }
}

/**
 * Handle the debug problematic command to show problematic personalities
 * @param {Object} message - Discord message object
 */
async function handleDebugProblematicCommand(message) {
  // Gather information about known and runtime problematic personalities
  const knownCount = Object.keys(knownProblematicPersonalities).length;
  const runtimeCount = runtimeProblematicPersonalities.size;

  // Create the embed
  const embed = new EmbedBuilder()
    .setTitle('Problematic Personalities Debug')
    .setDescription('These personalities have been detected as having issues with the API')
    .setColor('#FF5555')
    .addFields(
      {
        name: 'Known Problematic Personalities',
        value: knownCount > 0 ? `${knownCount} personalities` : 'None',
      },
      {
        name: 'Runtime Detected Problematic Personalities',
        value: runtimeCount > 0 ? `${runtimeCount} personalities` : 'None',
      }
    );

  // Add known problematic personalities
  if (knownCount > 0) {
    for (const [name, info] of Object.entries(knownProblematicPersonalities)) {
      embed.addFields({
        name: `Known: ${name}`,
        value: `Error Patterns: ${info.errorPatterns ? info.errorPatterns.join(', ') : 'Not specified'}\nCustom Responses: ${info.responses ? 'Yes' : 'No'}`,
      });
    }
  }

  // Add runtime detected problematic personalities
  if (runtimeCount > 0) {
    for (const [name, info] of runtimeProblematicPersonalities.entries()) {
      const detectedAt = new Date(info.firstDetectedAt).toLocaleString();
      embed.addFields({
        name: `Runtime: ${name}`,
        value: `Detected: ${detectedAt}\nError Count: ${info.errorCount}\nLast Error: ${info.lastErrorContent?.substring(0, 100) || 'Unknown'}${info.lastErrorContent?.length > 100 ? '...' : ''}`,
      });
    }
  }

  // Add tips for handling problematic personalities
  embed.addFields({
    name: 'Tips for Handling',
    value: [
      '1. Consider adding recurring problematic personalities to the knownProblematicPersonalities in aiService.js',
      '2. Create custom themed responses for known problematic personalities',
      '3. Runtime-detected problematic personalities are reset when the bot restarts',
    ].join('\n'),
  });

  return message.reply({ embeds: [embed] });
}

module.exports = {
  processCommand,
  // Export for testing
  messageTracker,
  handleResetCommand,
  handleAutoRespondCommand,
  handleInfoCommand,
  directSend: (content) => {
    try {
      if (typeof content === 'string') {
        return Promise.resolve({id: 'mock-message-id', content});
      } else {
        return Promise.resolve({id: 'mock-message-id', content: 'mock-embed'});
      }
    } catch (err) {
      console.error('Error sending message:', err);
      return Promise.resolve(null);
    }
  },
};
