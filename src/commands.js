const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const personalityManagerFunctions = require('./personalityManager');
const { registerPersonality, getPersonality, setPersonalityAlias, getPersonalityByAlias, removePersonality, listPersonalitiesForUser } = personalityManagerFunctions;
const { recordConversation, clearConversation, activatePersonality, deactivatePersonality } = require('./conversationManager');
const { knownProblematicPersonalities, runtimeProblematicPersonalities } = require('./aiService');
const { preloadPersonalityAvatar } = require('./webhookManager');
const { botPrefix } = require('../config');

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
  console.log(`Processing command: ${command} with args: ${args.join(' ')} from user: ${message.author.tag}`);

  // ENHANCED LOGGING: Check processed messages in more detail
  console.log(`[Commands] Checking if message ${message.id} is in the processedMessages set (size: ${processedMessages.size})`);
  
  // We now handle ALL command types centrally in the processedMessages check
  // No special case handling needed for add/create commands
  console.log(`[Commands] Processing command: ${command}`);
  
  // Check if this message has already been processed
  // The check needs to handle ALL command types, including add/create
  if (processedMessages.has(message.id)) {
    console.log(`[Commands] Message ${message.id} already processed, skipping duplicate command`);
    return null;
  } else {
    console.log(`[Commands] Message ${message.id} will be processed`);
    // Mark ALL messages as processed when we start handling them
    processedMessages.add(message.id);
    
    // Clean up after 30 seconds
    setTimeout(() => {
      console.log(`[Commands] Removing message ${message.id} from processedMessages after timeout`);
      processedMessages.delete(message.id);
    }, 30000); // 30 seconds
  }

  // Create a unique key for this command execution
  const commandKey = `${message.author.id}-${command}-${args.join('-')}`;
  
  console.log(`[Commands] Command key: ${commandKey}`);
  
  // Check if this exact command was recently executed (within 3 seconds)
  if (recentCommands.has(commandKey)) {
    const timestamp = recentCommands.get(commandKey);
    if (Date.now() - timestamp < 3000) {
      console.log(`[Commands] Detected duplicate command execution: ${command} from ${message.author.tag}, ignoring`);
      return null; // Silently ignore duplicate commands
    }
  }
  
  // Mark this command as recently executed
  recentCommands.set(commandKey, Date.now());
  console.log(`[Commands] Marked command as recently executed with key: ${commandKey}`);
  
  // Skip marking other write commands as processed since we already do that above for add/create
  // and the other commands don't have the duplicate embed issue
  if (['remove', 'delete', 'alias'].includes(command)) {
    console.log(`[Commands] Adding message ${message.id} to processedMessages set for command: ${command}`);
    processedMessages.add(message.id);
    
    // Clean up after 30 seconds (reduced from 5 minutes)
    setTimeout(() => {
      console.log(`[Commands] Removing message ${message.id} from processedMessages after timeout`);
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
    const directSend = async (content) => {
      try {
        if (typeof content === 'string') {
          return await message.channel.send(content);
        } else {
          return await message.channel.send(content);
        }
      } catch (err) {
        console.error('Error sending message:', err);
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
        return await directSend(`Unknown command: \`${command}\`. Use \`${prefix} help\` to see available commands.`);
    }
  } catch (error) {
    console.error(`Error processing command ${command}:`, error);
    return await message.channel.send(`An error occurred while processing the command. Please try again.`);
  }
}

/**
 * Handle the help command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
// Static tracking object to prevent duplicate messages
// This might be a workaround for a Discord.js bug
const messageTracker = {
  lastCommandTime: {},
  isDuplicate: function(userId, commandName) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    const lastTime = this.lastCommandTime[key] || 0;
    
    // Consider it a duplicate if same command from same user within 3 seconds
    if (now - lastTime < 3000) {
      console.log(`Duplicate command detected: ${commandName} from ${userId}`);
      return true;
    }
    
    // Update the timestamp
    this.lastCommandTime[key] = now;
    return false;
  }
};

async function handleHelpCommand(message, args) {
  const prefix = botPrefix;
  const commandName = 'help';
  
  // Removed duplicate check as it's causing issues
  
  console.log(`Processing help command with args: ${args.join(', ')}`);

  try {
    // Create simpler reply function that doesn't use the reply feature
    const directSend = async (msg, content) => {
      if (typeof content === 'string') {
        return await msg.channel.send(content);
      } else {
        return await msg.channel.send({ embeds: content.embeds });
      }
    };

    if (args.length > 0) {
      // Help for a specific command
      const specificCommand = args[0].toLowerCase();

      switch (specificCommand) {
        case 'add':
        case 'create':
          return await directSend(message,
            `**${prefix} add <profile_name> [alias]**\n` +
            `Add a new AI personality to your collection.\n` +
            `- \`profile_name\` is the name of the personality (required)\n` +
            `- \`alias\` is an optional nickname you can use to reference this personality (optional)\n\n` +
            `Example: \`${prefix} add lilith-tzel-shani lilith\``
          );
        
        case 'debug':
          // Only show this for users with Administrator permission
          if (message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await directSend(message,
              `**${prefix} debug <subcommand>**\n` +
              `Advanced debugging tools (Requires Administrator permission).\n` +
              `Available subcommands:\n` +
              `- \`problems\` - Display information about problematic personalities\n\n` +
              `Example: \`${prefix} debug problems\``
            );
          } else {
            return await directSend(message, 
              `This command is only available to administrators.`
            );
          }

        case 'list':
          return await directSend(message,
            `**${prefix} list**\n` +
            `List all AI personalities you've added.\n\n` +
            `Example: \`${prefix} list\``
          );

        case 'alias':
          return await directSend(message,
            `**${prefix} alias <profile_name> <new_alias>**\n` +
            `Add an alias/nickname for an existing personality.\n` +
            `- \`profile_name\` is the name of the personality (required)\n` +
            `- \`new_alias\` is the nickname to assign (required)\n\n` +
            `Example: \`${prefix} alias lilith-tzel-shani lili\``
          );

        case 'remove':
        case 'delete':
          return await directSend(message,
            `**${prefix} remove <profile_name>**\n` +
            `Remove a personality from your collection.\n` +
            `- \`profile_name\` is the name of the personality to remove (required)\n\n` +
            `Example: \`${prefix} remove lilith-tzel-shani\``
          );

        case 'info':
          return await directSend(message,
            `**${prefix} info <profile_name>**\n` +
            `Show detailed information about a personality.\n` +
            `- \`profile_name\` is the name or alias of the personality (required)\n\n` +
            `Example: \`${prefix} info lilith\``
          );

        case 'activate':
          return await directSend(message,
            `**${prefix} activate <personality>**\n` +
            `Activate a personality to automatically respond to all messages in the channel from any user.\n` +
            `- Requires the "Manage Messages" permission\n` +
            `- \`personality\` is the name or alias of the personality to activate (required)\n\n` +
            `Example: \`${prefix} activate lilith\``
          );

        case 'deactivate':
          return await directSend(message,
            `**${prefix} deactivate**\n` +
            `Deactivate the currently active personality in this channel.\n` +
            `- Requires the "Manage Messages" permission\n\n` +
            `Example: \`${prefix} deactivate\``
          );

        case 'autorespond':
        case 'auto':
          return await directSend(message,
            `**${prefix} autorespond <on|off|status>**\n` +
            `Toggle whether personalities continue responding to your messages automatically after you tag or reply to them.\n` +
            `- \`on\` - Enable auto-response for your user\n` +
            `- \`off\` - Disable auto-response (default)\n` +
            `- \`status\` - Check your current setting\n\n` +
            `Example: \`${prefix} autorespond on\``
          );

        default:
          return await directSend(message, `Unknown command: \`${specificCommand}\`. Use \`${prefix} help\` to see available commands.`);
      }
    }

    // General help
    const embed = new EmbedBuilder()
      .setTitle('Tzurot Help')
      .setDescription('Tzurot allows you to interact with multiple AI personalities in Discord.')
      .setColor('#5865F2')
      .addFields(
        { name: `${prefix} add <profile_name> [alias]`, value: 'Add a new AI personality' },
        { name: `${prefix} list`, value: 'List all your AI personalities' },
        { name: `${prefix} alias <profile_name> <new_alias>`, value: 'Add an alias for a personality' },
        { name: `${prefix} remove <profile_name>`, value: 'Remove a personality' },
        { name: `${prefix} info <profile_name>`, value: 'Show details about a personality' },
        { name: `${prefix} help [command]`, value: 'Show this help or help for a specific command' },
        { name: `${prefix} activate <personality>`, value: 'Activate a personality for all users in the channel (requires Manage Messages permission)' },
        { name: `${prefix} deactivate`, value: 'Deactivate the channel-wide personality (requires Manage Messages permission)' },
        { name: `${prefix} autorespond <on|off|status>`, value: 'Toggle whether personalities continue responding to your messages automatically' },
        { name: `${prefix} reset`, value: 'Clear your active conversation' }
      )
      .setFooter({ text: 'To interact with a personality, mention them with @alias or reply to their messages' });
    
    // Add admin commands only for users with Administrator permission
    if (message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      embed.addFields(
        { name: `Admin Commands`, value: 'The following commands are only available to administrators' },
        { name: `${prefix} debug <subcommand>`, value: 'Advanced debugging tools (Use `help debug` for more info)' }
      );
    }

    return await directSend(message, { embeds: [embed] });
  } catch (error) {
    console.error('Error in handleHelpCommand:', error);
    return message.channel.send(`An error occurred while processing the help command: ${error.message}`);
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
setInterval(() => {
  if (processedMessages.size > 0) {
    console.log(`[Commands] Cleaning up processed messages cache (size: ${processedMessages.size})`);
    processedMessages.clear();
  }
  
  // Also clean up the sendingEmbedResponses set in case any entries get stuck
  if (sendingEmbedResponses.size > 0) {
    console.log(`[Commands] Cleaning up sendingEmbedResponses (size: ${sendingEmbedResponses.size})`);
    sendingEmbedResponses.clear();
  }
}, 10 * 60 * 1000).unref(); // unref() allows the process to exit even if timer is active

async function handleAddCommand(message, args) {
  // Message ID deduplication is now handled centrally in processCommand
  console.log(`[Commands] Processing add command with message ${message.id}`);
  
  if (args.length < 1) {
    return message.reply(`Please provide a profile name. Usage: \`${botPrefix} add <profile_name> [alias]\``);
  }

  const profileName = args[0];
  const alias = args[1] || null; // Optional alias
  
  // Create a unique key for this request - normalize to lowercase for case insensitive matching
  const requestKey = `${message.author.id}-${profileName.toLowerCase()}`;
  
  console.log(`[Commands] Processing request key ${requestKey}`);
  
  // Check if this exact request is already being processed
  if (pendingAdditions.has(requestKey)) {
    const pendingData = pendingAdditions.get(requestKey);
    // Only block for 3 seconds to allow retries
    if (Date.now() - pendingData.timestamp < 3000) {
      console.log(`[Commands] Very recent duplicate request detected for ${profileName} by ${message.author.tag}, ignoring`);
      return message.reply(`You just tried to add this personality. Please wait a moment before trying again.`);
    } else {
      console.log(`[Commands] Previous request found but enough time has passed, allowing new request`);
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
    messageId: message.id
  });

  try {
    // Helper function to safely get lowercase version of a string
    const safeToLowerCase = (str) => {
      if (!str) return '';
      return String(str).toLowerCase();
    };

    // Check if the personality already exists for this user
    const existingPersonalities = listPersonalitiesForUser(message.author.id);
    console.log(`[Commands] Checking if ${profileName} already exists among ${existingPersonalities.length} personalities`);
    
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

    // No loading message - we'll do all the work first and only send one message at the end
    console.log(`[Commands] Starting personality registration process for ${profileName} (no loading message)`);

    try {
      // -------------------- STEP 1: Register the base personality --------------------
      console.log(`[Commands] Step 1: Initial personality registration for ${profileName}`);
      
      // Register the personality first - this doesn't fetch profile info
      console.log(`[Commands] Calling registerPersonality with userId=${message.author.id}, profileName=${profileName}`);
      let initialPersonality; // Declare variable outside try block so it's accessible later
      
      try {
        initialPersonality = await registerPersonality(message.author.id, profileName, {
          description: `Added by ${message.author.tag}`
        }, false); // false = don't fetch profile info in the same call
        
        if (!initialPersonality) {
          console.error(`[Commands] registerPersonality returned null or undefined!`);
          throw new Error("Personality registration failed - returned null");
        }
        
        console.log(`[Commands] Initial registration completed successfully:`, JSON.stringify({
          fullName: initialPersonality.fullName,
          displayName: initialPersonality.displayName,
          hasAvatar: !!initialPersonality.avatarUrl
        }));
      } catch (regError) {
        console.error(`[Commands] Error during personality registration:`, regError);
        // Include a descriptive message for the user
        throw new Error(`Failed to register personality: ${regError.message}`);
      }
      
      // -------------------- STEP 2: Fetch profile info separately --------------------
      console.log(`[Commands] Step 2: Fetching profile info explicitly...`);
      const profileInfoFetcher = require('./profileInfoFetcher');
      
      let displayName = null;
      let avatarUrl = null;

      // Fetch basic profile data
      console.log(`[Commands] Making direct calls to profile info fetcher for ${profileName}`);
      
      try {
        const profileData = await profileInfoFetcher.fetchProfileInfo(profileName);
        if (profileData) {
          console.log(`[Commands] RAW profile data:`, JSON.stringify(profileData).substring(0, 200));
        } else {
          console.warn(`[Commands] Profile data fetch returned null or undefined`);
        }
      } catch (infoError) {
        console.error(`[Commands] Error fetching profile data:`, infoError);
        // Continue despite this error
      }
      
      // Get display name with fallback to profile name
      try {
        displayName = await profileInfoFetcher.getProfileDisplayName(profileName);
        console.log(`[Commands] Got display name: ${displayName}`);
      } catch (nameError) {
        console.error(`[Commands] Error fetching display name:`, nameError);
        // If we can't get the display name, use the profile name
        displayName = profileName;
        console.log(`[Commands] Using profileName as fallback: ${displayName}`);
      }
      
      // Get avatar URL
      try {
        avatarUrl = await profileInfoFetcher.getProfileAvatarUrl(profileName);
        console.log(`[Commands] Got avatar URL: ${avatarUrl}`);
      } catch (avatarError) {
        console.error(`[Commands] Error fetching avatar URL:`, avatarError);
      }
      
      console.log(`[Commands] Fetched profile info: displayName=${displayName}, hasAvatar=${!!avatarUrl}, avatarUrl=${avatarUrl}`);
      
      // Update the initial personality with fetched data
      if (displayName) {
        console.log(`[Commands] Setting display name: ${displayName}`);
        initialPersonality.displayName = displayName;
      } else {
        // Ensure we always have a display name
        console.log(`[Commands] No display name found, using profile name`);
        initialPersonality.displayName = profileName;
      }
      
      if (avatarUrl) {
        console.log(`[Commands] Setting avatar URL: ${avatarUrl}`);
        initialPersonality.avatarUrl = avatarUrl;
      }
      
      // Get the saved personality from store
      console.log(`[Commands] Getting personality from store to ensure latest version`);
      const savedPersonality = getPersonality(profileName);
      
      if (!savedPersonality) {
        console.error(`[Commands] Failed to retrieve personality from store after registration!`);
        // Don't throw, just log the error and continue
        console.error(`[Commands] Will attempt to continue with initialPersonality object`);
      } else {
        // Update the saved personality with our fetched info
        console.log(`[Commands] Updating saved personality with display name and avatar`);
        if (displayName) {
          savedPersonality.displayName = displayName;
        }
        if (avatarUrl) {
          savedPersonality.avatarUrl = avatarUrl;
        }
        
        // Explicitly save all personality data to ensure it's persisted
        console.log(`[Commands] Saving all personality data`);
        const personalityManager = require('./personalityManager');
        await personalityManager.saveAllPersonalities();
        console.log(`[Commands] Updated and saved personality with display name and avatar`);
      }
      
      // -------------------- STEP 3: Set up aliases --------------------
      console.log(`[Commands] Step 3: Setting up aliases`);
      
      // If an alias was provided, set it
      if (alias && alias.toLowerCase() !== profileName.toLowerCase() && 
          (!initialPersonality.displayName || 
           alias.toLowerCase() !== initialPersonality.displayName.toLowerCase())) {
        await setPersonalityAlias(alias, profileName);
        console.log(`[Commands] Set manual alias: ${alias} -> ${profileName}`);
      }
      
      // Also set display name as alias if it's different from the full name
      if (initialPersonality.displayName && 
          initialPersonality.displayName.toLowerCase() !== profileName.toLowerCase()) {
        const defaultAlias = initialPersonality.displayName.toLowerCase();
        await setPersonalityAlias(defaultAlias, profileName);
        console.log(`[Commands] Set display name as alias: ${defaultAlias} -> ${profileName}`);
      }
      
      // -------------------- STEP 4: Save profile data and pre-load Avatar --------------------
      console.log(`[Commands] Step 4: Saving profile data and pre-loading avatar`);
      
      // Use the already imported personalityManager for consistency
      // We already have: const personalityManagerFunctions = require('./personalityManager');
      // at the top of the file
      
      // Important: Force save personality data after updates
      await personalityManagerFunctions.saveAllPersonalities();
      console.log(`[Commands] Explicitly saved all personality data`);
      
      // Get the final personality with all updates - AFTER explicit save
      const finalPersonality = getPersonality(profileName);
      
      if (!finalPersonality) {
        console.error(`[Commands] Error: Personality registration returned no data for ${profileName}`);
        throw new Error("Failed to register personality");
      }
      
      console.log(`[Commands] Final personality after all updates:`, {
        fullName: finalPersonality.fullName,
        displayName: finalPersonality.displayName,
        hasAvatar: !!finalPersonality.avatarUrl
      });
      
      // Add extra safety checks for display name and avatar
      if (!finalPersonality.displayName && displayName) {
        console.log(`[Commands] Setting display name again: ${displayName}`);
        finalPersonality.displayName = displayName;
        await personalityManagerFunctions.saveAllPersonalities();
      } else if (!finalPersonality.displayName) {
        console.log(`[Commands] No display name found, using profile name: ${profileName}`);
        finalPersonality.displayName = profileName;
        await personalityManagerFunctions.saveAllPersonalities();
      }
      
      if (!finalPersonality.avatarUrl && avatarUrl) {
        console.log(`[Commands] Setting avatar URL again: ${avatarUrl}`);
        finalPersonality.avatarUrl = avatarUrl;
        await personalityManagerFunctions.saveAllPersonalities();
      } else if (!finalPersonality.avatarUrl) {
        console.log(`[Commands] No avatar URL found in final personality object`);
        // Try one more explicit fetch from the API
        try {
          console.log(`[Commands] Making one final attempt to fetch avatar URL...`);
          const profileInfoFetcher = require('./profileInfoFetcher');
          const finalAttemptUrl = await profileInfoFetcher.getProfileAvatarUrl(profileName);
          if (finalAttemptUrl) {
            console.log(`[Commands] Successfully fetched avatar URL in final attempt: ${finalAttemptUrl}`);
            finalPersonality.avatarUrl = finalAttemptUrl;
            await personalityManagerFunctions.saveAllPersonalities();
          }
        } catch (err) {
          console.error(`[Commands] Final avatar URL fetch attempt failed:`, err);
        }
      }
      
      // Pre-load avatar if available - this ensures it shows up correctly on first use
      if (finalPersonality.avatarUrl) {
        console.log(`[Commands] Pre-loading avatar for new personality: ${finalPersonality.avatarUrl}`);
        try {
          // Use fetch to warm up the avatar URL first with proper error handling and timeout
          const fetch = require('node-fetch');
          const response = await fetch(finalPersonality.avatarUrl, { 
            method: 'GET',
            timeout: 5000, // 5 second timeout to prevent hanging
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          
          if (!response.ok) {
            console.error(`[Commands] Avatar image fetch failed with status: ${response.status}`);
          } else {
            // Read the response body to fully load it into Discord's cache
            const buffer = await response.buffer();
            console.log(`[Commands] Explicitly pre-fetched avatar URL (${buffer.length} bytes)`);
          }
          
          // Then use the webhook manager's preload function with our own direct URL
          await preloadPersonalityAvatar({
            ...finalPersonality,
            avatarUrl: finalPersonality.avatarUrl // Ensure it's using the correct URL
          });
          console.log(`[Commands] Avatar pre-loaded successfully for ${finalPersonality.displayName}`);
          
          // Save again after preloading to ensure data persistence
          await personalityManagerFunctions.saveAllPersonalities();
        } catch (avatarError) {
          console.error(`[Commands] Avatar pre-loading failed, but continuing:`, avatarError);
          // Continue despite error - not critical
        }
      }

      // -------------------- STEP 5: Send Final Response --------------------
      console.log(`[Commands] Step 5: Sending final response with complete info`);
      
      // CRITICAL FIX: Check for duplicate send attempts using a mutex-like pattern
      // Create a unique key for this specific send attempt
      const embedSendKey = `${message.id}-${message.channel.id}-${profileName}`;
      
      // If we're already sending an embed for this exact command, don't send another one
      if (sendingEmbedResponses.has(embedSendKey)) {
        console.log(`[Commands] CRITICAL: Already sending an embed for ${embedSendKey} - preventing duplicate`);
        // Still mark as completed for cleanup purposes
        pendingAdditions.delete(requestKey);
        // Return a dummy response to indicate we handled the command
        return { id: 'duplicate-prevented', isDuplicate: true };
      }
      
      // Mark that we're in the process of sending an embed for this command
      sendingEmbedResponses.add(embedSendKey);
      console.log(`[Commands] Added ${embedSendKey} to sendingEmbedResponses set (size: ${sendingEmbedResponses.size})`);
      
      try {
        // Force one more save and get very latest data
        await personalityManagerFunctions.saveAllPersonalities();
        const veryFinalPersonality = getPersonality(profileName);
        
        // Use this with our forced loaded data
        const displayNameToUse = veryFinalPersonality.displayName || displayName || profileName;
        const avatarUrlToUse = veryFinalPersonality.avatarUrl || avatarUrl;
        
        console.log(`[Commands] FINAL DATA FOR EMBED: displayName=${displayNameToUse}, hasAvatar=${!!avatarUrlToUse}, avatarUrl=${avatarUrlToUse}`);
        
        // Create an embed with the finalized personality info
        const embed = new EmbedBuilder()
          .setTitle('Personality Added')
          .setDescription(`Successfully added personality: ${displayNameToUse}`)
          .setColor('#00FF00')
          .addFields(
            { name: 'Full Name', value: profileName },
            { name: 'Display Name', value: displayNameToUse || 'Not set' },
            { name: 'Alias', value: alias || (displayNameToUse && displayNameToUse.toLowerCase() !== profileName.toLowerCase() ? displayNameToUse.toLowerCase() : 'None set') }
          );
  
        // Add the avatar to the embed if available
        if (avatarUrlToUse) {
          // Validate the URL format first
          const isValidUrl = (urlString) => {
            try {
              return Boolean(new URL(urlString));
            } catch (error) {
              return false;
            }
          };
          
          if (isValidUrl(avatarUrlToUse)) {
            console.log(`[Commands] Adding avatar URL to embed: ${avatarUrlToUse}`);
            embed.setThumbnail(avatarUrlToUse);
          } else {
            console.error(`[Commands] Invalid avatar URL format: ${avatarUrlToUse}`);
          }
        } else {
          console.log(`[Commands] No avatar URL available for embed`);
        }
  
        // Send a single complete message - no loading message to update!
        const responseMsg = await message.reply({ embeds: [embed] });
        console.log(`[Commands] Successfully sent complete personality embed with ID: ${responseMsg.id}`);
        return responseMsg;
      } catch (error) {
        console.error(`[Commands] Error sending embed:`, error);
        throw error;
      } finally {
        // Always clean up our mutex-like tracking set, even if there's an error
        console.log(`[Commands] Removing ${embedSendKey} from sendingEmbedResponses set`);
        sendingEmbedResponses.delete(embedSendKey);
        
        // Also set a delayed cleanup to ensure we don't leave stale entries
        setTimeout(() => {
          if (sendingEmbedResponses.has(embedSendKey)) {
            console.log(`[Commands] Cleanup: Removing stale entry ${embedSendKey} from sendingEmbedResponses set`);
            sendingEmbedResponses.delete(embedSendKey);
          }
        }, 10000); // 10 seconds
      }
      
      // Note: pendingAdditions cleanup is now handled inside the try/finally block above
    } catch (innerError) {
      console.error(`[Commands] Inner error during personality registration:`, innerError);
      
      // Send error message - no loading message to update
      try {
        const errorResponse = await message.reply(`Failed to complete the personality registration: ${innerError.message}`);
        console.log(`[Commands] Sent error response with ID: ${errorResponse.id}`);
        
        // Clear pending even on error
        pendingAdditions.delete(requestKey);
        
        // Return the error response to indicate we've handled this command
        return errorResponse;
      } catch (err) {
        console.error(`[Commands] Error sending error message:`, err);
        // Clear pending even on error
        pendingAdditions.delete(requestKey);
        // Return something to indicate we've handled this command
        return null;
      }
    }
  } catch (error) {
    console.error(`Error adding personality ${profileName}:`, error);
    // Clear pending on error
    pendingAdditions.delete(requestKey);
    
    // Return a proper response to the user
    const errorResponse = await message.reply(`Failed to add personality \`${profileName}\`. Error: ${error.message}`);
    console.log(`[Commands] Sent error response with ID: ${errorResponse.id}`);
    
    // Return the error response to indicate we've handled this command
    return errorResponse;
  } finally {
    // Ensure we always clean up, even if an unexpected error occurs
    setTimeout(() => {
      if (pendingAdditions.has(requestKey)) {
        const pendingData = pendingAdditions.get(requestKey);
        const elapsedTime = Date.now() - pendingData.timestamp;
        
        if (elapsedTime > 30000) {
          console.log(`[Commands] Cleaning up stale pending addition request for ${requestKey} after ${elapsedTime}ms`);
          pendingAdditions.delete(requestKey);
        }
      }
    }, 30000); // Clean up after 30 seconds no matter what
    
    // Add a periodic cleaner for all pending additions - runs every 2 minutes
    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of pendingAdditions.entries()) {
        if (now - data.timestamp > 120000) { // Clean entries older than 2 minutes
          console.log(`[Commands] Automatic cleanup of stale pending addition: ${data.profileName}`);
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
    return message.reply(`You haven't added any personalities yet. Use \`${botPrefix} add <profile_name>\` to add one.`);
  }

  // Create an embed with the list
  const embed = new EmbedBuilder()
    .setTitle('Your Personalities')
    .setDescription(`You have ${personalities.length} personalities`)
    .setColor('#5865F2');

  // Add each personality to the embed
  personalities.forEach(p => {
    // Find all aliases for this personality
    const aliases = [];
    for (const [alias, name] of Object.entries(require('./personalityManager').personalityAliases)) {
      if (name === p.fullName) {
        aliases.push(alias);
      }
    }

    const aliasText = aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : 'No aliases';

    embed.addFields({
      name: p.displayName || p.fullName,
      value: `ID: \`${p.fullName}\`\n${aliasText}`
    });
  });

  return message.reply({ embeds: [embed] });
}

/**
 * Handle the alias command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAliasCommand(message, args) {
  if (args.length < 2) {
    return message.reply(`Please provide a profile name and an alias. Usage: \`${botPrefix} alias <profile_name> <alias>\``);
  }

  const profileName = args[0];
  const newAlias = args[1];

  // Check if the personality exists
  const personality = getPersonality(profileName);

  if (!personality) {
    return message.reply(`Personality \`${profileName}\` not found. Use \`${botPrefix} list\` to see your personalities.`);
  }

  // Check if the personality belongs to the user
  if (personality.createdBy !== message.author.id) {
    return message.reply(`Personality \`${profileName}\` doesn't belong to you.`);
  }

  // Check if the alias is already in use
  const existingPersonality = getPersonalityByAlias(newAlias);

  if (existingPersonality && existingPersonality.fullName !== profileName) {
    return message.reply(`Alias \`${newAlias}\` is already in use for personality \`${existingPersonality.fullName}\`.`);
  }

  // Set the alias
  setPersonalityAlias(newAlias, profileName);

  return message.reply(`Alias \`${newAlias}\` set for personality \`${personality.displayName || profileName}\`.`);
}

/**
 * Handle the remove command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleRemoveCommand(message, args) {
  if (args.length < 1) {
    return message.reply(`Please provide a profile name. Usage: \`${botPrefix} remove <profile_name>\``);
  }

  const profileName = args[0];

  // Try with alias first
  let personality = getPersonalityByAlias(profileName);

  // If not found by alias, try with full name
  if (!personality) {
    personality = getPersonality(profileName);
  }

  if (!personality) {
    return message.reply(`Personality \`${profileName}\` not found. Use \`${botPrefix} list\` to see your personalities.`);
  }

  // Check if the personality belongs to the user
  if (personality.createdBy !== message.author.id) {
    return message.reply(`Personality \`${personality.fullName}\` doesn't belong to you.`);
  }

  // Remove the personality
  const success = removePersonality(personality.fullName);

  if (success) {
    return message.reply(`Personality \`${personality.displayName || personality.fullName}\` removed.`);
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
    return message.reply(`Please provide a profile name or alias. Usage: \`${botPrefix} info <profile_name>\``);
  }

  const profileQuery = args[0];

  // Try with alias first
  let personality = getPersonalityByAlias(profileQuery);

  // If not found by alias, try with full name
  if (!personality) {
    personality = getPersonality(profileQuery);
  }

  if (!personality) {
    return message.reply(`Personality \`${profileQuery}\` not found. Use \`${botPrefix} list\` to see your personalities.`);
  }

  // Find all aliases for this personality
  const aliases = [];
  for (const [alias, name] of Object.entries(require('./personalityManager').personalityAliases)) {
    if (name === personality.fullName) {
      aliases.push(alias);
    }
  }

  // Create an embed with the personality info
  const embed = new EmbedBuilder()
    .setTitle(personality.displayName || personality.fullName)
    .setDescription(personality.description || 'No description')
    .setColor('#5865F2')
    .addFields(
      { name: 'Full Name', value: personality.fullName },
      { name: 'Display Name', value: personality.displayName || 'Not set' },
      { name: 'Aliases', value: aliases.length > 0 ? aliases.join(', ') : 'None' },
      { name: 'Added By', value: `<@${personality.createdBy}>` },
      { name: 'Added On', value: new Date(personality.createdAt).toLocaleString() }
    );

  // Add the avatar to the embed if available
  if (personality.avatarUrl) {
    embed.setThumbnail(personality.avatarUrl);
  }

  return message.reply({ embeds: [embed] });
}

/**
 * Handle the reset command (clears conversation)
 * @param {Object} message - Discord message object
 */
async function handleResetCommand(message) {
  const cleared = clearConversation(message.author.id, message.channel.id);

  if (cleared) {
    return message.reply('Conversation history cleared. The next message will start a new conversation.');
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
    return message.reply(`Please provide a personality name or alias. Usage: \`${botPrefix} activate <personality>\``);
  }

  const personalityQuery = args[0];

  // Try with alias first
  let personality = getPersonalityByAlias(personalityQuery);

  // If not found by alias, try with full name
  if (!personality) {
    personality = getPersonality(personalityQuery);
  }

  if (!personality) {
    return message.reply(`Personality \`${personalityQuery}\` not found. Use \`${botPrefix} list\` to see your personalities.`);
  }

  // Activate the personality in this channel
  activatePersonality(message.channel.id, personality.fullName, message.author.id);

  return message.reply(`**Channel-wide activation:** ${personality.displayName || personality.fullName} will now respond to all messages in this channel from any user. Use \`${botPrefix} deactivate\` to turn this off.`);
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
    return message.reply(`**Channel-wide activation disabled.** Personalities will now only respond to direct mentions, replies, or users with auto-response enabled.`);
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
  const { enableAutoResponse, disableAutoResponse, isAutoResponseEnabled } = require('./conversationManager');
  
  // Parse the on/off argument
  const subCommand = args[0]?.toLowerCase();

  if (!subCommand || !['on', 'off', 'status'].includes(subCommand)) {
    return message.reply(`Please specify 'on', 'off', or 'status'. Usage: \`${botPrefix} autorespond <on|off|status>\``);
  }

  const userId = message.author.id;

  if (subCommand === 'status') {
    const status = isAutoResponseEnabled(userId) ? 'enabled' : 'disabled';
    return message.reply(`Your auto-response is currently **${status}**. When enabled, a personality will continue responding to your messages after you mention or reply to it.`);
  }

  if (subCommand === 'on') {
    enableAutoResponse(userId);
    return message.reply(`**Auto-response enabled.** After mentioning or replying to a personality, it will continue responding to your messages in that channel without needing to tag it again.`);
  }

  if (subCommand === 'off') {
    disableAutoResponse(userId);
    return message.reply(`**Auto-response disabled.** Personalities will now only respond when you directly mention or reply to them.`);
  }
}

/**
 * Handle the status command
 * @param {Object} message - Discord message object
 */
async function handleStatusCommand(message) {
  const { listPersonalitiesForUser } = require('./personalityManager');
  
  // Get Discord client from global scope rather than importing from bot.js to avoid circular dependency
  const client = global.tzurotClient;
  
  if (!client) {
    return message.reply('Bot client not properly initialized. Please try again later.');
  }
  
  // Count total personalities - use the personalityManager's listPersonalitiesForUser with no filter
  const allPersonalities = listPersonalitiesForUser();
  const totalPersonalities = allPersonalities ? allPersonalities.length : 0;
  const userPersonalities = listPersonalitiesForUser(message.author.id).length;

  const embed = new EmbedBuilder()
    .setTitle('Tzurot Status')
    .setDescription('Current bot status and statistics')
    .setColor('#5865F2')
    .addFields(
      { name: 'Uptime', value: formatUptime(client.uptime) },
      { name: 'Total Personalities', value: totalPersonalities.toString() },
      { name: 'Your Personalities', value: userPersonalities.toString() },
      { name: 'Connected Servers', value: client.guilds.cache.size.toString() },
      { name: 'Memory Usage', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB` }
    )
    .setFooter({ text: `Bot Version: 1.0.0` });

  return message.reply({ embeds: [embed] });
}

/**
 * Format milliseconds as a readable uptime string
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted uptime
 */
function formatUptime(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Handle the debug command - only available to administrators
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleDebugCommand(message, args) {
  if (args.length < 1) {
    return message.reply(`Please specify a debug subcommand. Available subcommands: \`problems\``);
  }

  const subCommand = args[0].toLowerCase();

  switch (subCommand) {
    case 'problems':
    case 'problematic':
      return await handleDebugProblematicCommand(message, args.slice(1));
    
    default:
      return message.reply(`Unknown debug subcommand: \`${subCommand}\`. Available subcommands: \`problems\``);
  }
}

/**
 * Handle the debug problematic command to show problematic personalities
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleDebugProblematicCommand(message, args) {
  // Gather information about known and runtime problematic personalities
  const knownCount = Object.keys(knownProblematicPersonalities).length;
  const runtimeCount = runtimeProblematicPersonalities.size;
  
  // Create the embed
  const embed = new EmbedBuilder()
    .setTitle('Problematic Personalities Debug')
    .setDescription('These personalities have been detected as having issues with the API')
    .setColor('#FF5555')
    .addFields(
      { name: 'Known Problematic Personalities', value: knownCount > 0 ? `${knownCount} personalities` : 'None' },
      { name: 'Runtime Detected Problematic Personalities', value: runtimeCount > 0 ? `${runtimeCount} personalities` : 'None' }
    );
  
  // Add known problematic personalities
  if (knownCount > 0) {
    for (const [name, info] of Object.entries(knownProblematicPersonalities)) {
      embed.addFields({
        name: `Known: ${name}`,
        value: `Error Patterns: ${info.errorPatterns ? info.errorPatterns.join(', ') : 'Not specified'}\nCustom Responses: ${info.responses ? 'Yes' : 'No'}`
      });
    }
  }
  
  // Add runtime detected problematic personalities
  if (runtimeCount > 0) {
    for (const [name, info] of runtimeProblematicPersonalities.entries()) {
      const detectedAt = new Date(info.firstDetectedAt).toLocaleString();
      embed.addFields({
        name: `Runtime: ${name}`,
        value: `Detected: ${detectedAt}\nError Count: ${info.errorCount}\nLast Error: ${info.lastErrorContent?.substring(0, 100) || 'Unknown'}${info.lastErrorContent?.length > 100 ? '...' : ''}`
      });
    }
  }
  
  // Add tips for handling problematic personalities
  embed.addFields({
    name: 'Tips for Handling',
    value: [
      '1. Consider adding recurring problematic personalities to the knownProblematicPersonalities in aiService.js',
      '2. Create custom themed responses for known problematic personalities',
      '3. Runtime-detected problematic personalities are reset when the bot restarts'
    ].join('\n')
  });
  
  return message.reply({ embeds: [embed] });
}

module.exports = {
  processCommand
};