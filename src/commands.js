const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { registerPersonality, getPersonality, setPersonalityAlias, getPersonalityByAlias, removePersonality, listPersonalitiesForUser } = require('./personalityManager');
const { recordConversation, clearConversation, activatePersonality, deactivatePersonality } = require('./conversationManager');
const { botPrefix } = require('../config');

/**
 * Process a command
 * @param {Object} message - Discord message object
 * @param {string} command - Command name
 * @param {Array<string>} args - Command arguments
 */
async function processCommand(message, command, args) {
  // Get the prefix for use in help messages
  const prefix = botPrefix;
  
  // Add a simple debug log to track command processing
  console.log(`Processing command: ${command} with args: ${args.join(' ')} from user: ${message.author.tag}`);

  // Use a try/catch to avoid uncaught exceptions
  try {
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
        return await message.reply('Pong! Tzurot is operational.');

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

      default:
        return await message.reply(`Unknown command: \`${command}\`. Use \`${prefix} help\` to see available commands.`);
    }
  } catch (error) {
    console.error(`Error processing command ${command}:`, error);
    return await message.reply(`An error occurred while processing the command. Please try again.`);
  }
}

/**
 * Handle the help command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleHelpCommand(message, args) {
  const prefix = botPrefix;

  if (args.length > 0) {
    // Help for a specific command
    const specificCommand = args[0].toLowerCase();

    switch (specificCommand) {
      case 'add':
      case 'create':
        return message.reply(
          `**${prefix} add <profile_name> [alias]**\n` +
          `Add a new AI personality to your collection.\n` +
          `- \`profile_name\` is the name of the personality (required)\n` +
          `- \`alias\` is an optional nickname you can use to reference this personality (optional)\n\n` +
          `Example: \`${prefix} add lilith-tzel-shani lilith\``
        );

      case 'list':
        return message.reply(
          `**${prefix} list**\n` +
          `List all AI personalities you've added.\n\n` +
          `Example: \`${prefix} list\``
        );

      case 'alias':
        return message.reply(
          `**${prefix} alias <profile_name> <new_alias>**\n` +
          `Add an alias/nickname for an existing personality.\n` +
          `- \`profile_name\` is the name of the personality (required)\n` +
          `- \`new_alias\` is the nickname to assign (required)\n\n` +
          `Example: \`${prefix} alias lilith-tzel-shani lili\``
        );

      case 'remove':
      case 'delete':
        return message.reply(
          `**${prefix} remove <profile_name>**\n` +
          `Remove a personality from your collection.\n` +
          `- \`profile_name\` is the name of the personality to remove (required)\n\n` +
          `Example: \`${prefix} remove lilith-tzel-shani\``
        );

      case 'info':
        return message.reply(
          `**${prefix} info <profile_name>**\n` +
          `Show detailed information about a personality.\n` +
          `- \`profile_name\` is the name or alias of the personality (required)\n\n` +
          `Example: \`${prefix} info lilith\``
        );

      case 'activate':
        return message.reply(
          `**${prefix} activate <personality>**\n` +
          `Activate a personality to automatically respond to all messages in the channel from any user.\n` +
          `- Requires the "Manage Messages" permission\n` +
          `- \`personality\` is the name or alias of the personality to activate (required)\n\n` +
          `Example: \`${prefix} activate lilith\``
        );

      case 'deactivate':
        return message.reply(
          `**${prefix} deactivate**\n` +
          `Deactivate the currently active personality in this channel.\n` +
          `- Requires the "Manage Messages" permission\n\n` +
          `Example: \`${prefix} deactivate\``
        );

      case 'autorespond':
      case 'auto':
        return message.reply(
          `**${prefix} autorespond <on|off|status>**\n` +
          `Toggle whether personalities continue responding to your messages automatically after you tag or reply to them.\n` +
          `- \`on\` - Enable auto-response for your user\n` +
          `- \`off\` - Disable auto-response (default)\n` +
          `- \`status\` - Check your current setting\n\n` +
          `Example: \`${prefix} autorespond on\``
        );

      default:
        return message.reply(`Unknown command: \`${specificCommand}\`. Use \`${prefix} help\` to see available commands.`);
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

  return message.reply({ embeds: [embed] });
}

/**
 * Handle the add command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 */
async function handleAddCommand(message, args) {
  if (args.length < 1) {
    return message.reply(`Please provide a profile name. Usage: \`${botPrefix} add <profile_name> [alias]\``);
  }

  const profileName = args[0];
  const alias = args[1] || null; // Optional alias

  try {
    // Check if the personality already exists for this user
    const existingPersonalities = listPersonalitiesForUser(message.author.id);
    const alreadyExists = existingPersonalities.some(p => p.fullName.toLowerCase() === profileName.toLowerCase());

    if (alreadyExists) {
      return message.reply(`You already have a personality with the name \`${profileName}\`.`);
    }

    // Create a loading message
    const loadingMsg = await message.reply(`Adding personality \`${profileName}\`... This might take a moment.`);

    // Register the new personality with fetching profile info
    const personality = await registerPersonality(message.author.id, profileName, {
      // No need to provide display name or avatar as they'll be fetched
      description: `Added by ${message.author.tag}`
    }, true);

    // If an alias was provided, set it
    if (alias) {
      setPersonalityAlias(alias, profileName);
    }

    // Create an embed with the personality info
    const embed = new EmbedBuilder()
      .setTitle('Personality Added')
      .setDescription(`Successfully added personality: ${personality.displayName}`)
      .setColor('#00FF00')
      .addFields(
        { name: 'Full Name', value: personality.fullName },
        { name: 'Display Name', value: personality.displayName || 'Not set' },
        { name: 'Alias', value: alias || 'None set' }
      );

    // Add the avatar to the embed if available
    if (personality.avatarUrl) {
      embed.setThumbnail(personality.avatarUrl);
    }

    // Update the loading message with the result
    await loadingMsg.edit({ content: null, embeds: [embed] });
  } catch (error) {
    console.error(`Error adding personality ${profileName}:`, error);
    return message.reply(`Failed to add personality \`${profileName}\`. Error: ${error.message}`);
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
  const { client } = require('./bot');
  
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

module.exports = {
  processCommand
};