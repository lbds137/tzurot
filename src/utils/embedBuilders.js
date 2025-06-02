/**
 * Utilities for building Discord embeds for UI display
 *
 * This module contains functions for creating formatted Discord embeds:
 * - Personality list embeds
 * - Status embeds
 * - Help embeds
 * - Information embeds
 */

const { EmbedBuilder } = require('discord.js');
const { botPrefix, botConfig } = require('../../config');
const { listPersonalitiesForUser, personalityAliases } = require('../personalityManager');

/**
 * Creates an embed announcing a personality has been added
 * @param {string} profileName - Full name of the personality
 * @param {string} displayName - Display name of the personality
 * @param {string} alias - Optional alias for the personality
 * @param {string} avatarUrl - Optional avatar URL for the personality
 * @returns {EmbedBuilder} Discord embed
 */
function createPersonalityAddedEmbed(profileName, displayName, alias, avatarUrl) {
  const embed = new EmbedBuilder()
    .setTitle('Personality Added')
    .setDescription(`Successfully added personality: ${displayName || profileName}`)
    .setColor('#00FF00')
    .addFields(
      { name: 'Full Name', value: profileName },
      { name: 'Display Name', value: displayName || 'Not set' },
      {
        name: 'Alias',
        value:
          alias ||
          (displayName && displayName.toLowerCase() !== profileName.toLowerCase()
            ? displayName.toLowerCase()
            : 'None set'),
      }
    );

  // Add the avatar to the embed if available
  if (avatarUrl) {
    // Validate the URL format first
    const isValidUrl = urlString => {
      try {
        return Boolean(new URL(urlString));
      } catch {
        return false;
      }
    };

    if (isValidUrl(avatarUrl)) {
      embed.setThumbnail(avatarUrl);
    }
  }

  return embed;
}

/**
 * Creates an embed listing all personalities for a user
 * Discord has a limit of 25 fields per embed, so this function paginates if needed.
 * @param {string} userId - User ID
 * @param {number} [page=1] - Page number (1-based)
 * @returns {Object} Object containing the embed and pagination info
 */
function createPersonalityListEmbed(userId, page = 1) {
  try {
    // Check if userId is valid
    if (!userId) {
      console.error('[EmbedBuilders] Invalid user ID provided to createPersonalityListEmbed');
      // Return a basic error embed rather than throwing
      return {
        embed: new EmbedBuilder()
          .setTitle('Error')
          .setDescription('An error occurred while retrieving personalities')
          .setColor('#FF0000'),
        totalPages: 1,
        currentPage: 1,
      };
    }

    // Get all personalities for the user
    const personalities = listPersonalitiesForUser(userId);

    // Handle non-array return values
    if (!Array.isArray(personalities)) {
      console.error(
        `[EmbedBuilders] listPersonalitiesForUser returned a non-array: ${typeof personalities}`
      );
      // Return a basic error embed
      return {
        embed: new EmbedBuilder()
          .setTitle('Error')
          .setDescription('An error occurred while retrieving personalities')
          .setColor('#FF0000'),
        totalPages: 1,
        currentPage: 1,
      };
    }

    // Constants for pagination
    const FIELDS_PER_PAGE = 20; // Discord allows 25 max, but we'll use 20 for better display

    // Calculate pagination
    const personalityCount = personalities.length;
    const totalPages = Math.max(1, Math.ceil(personalityCount / FIELDS_PER_PAGE));

    // Validate and normalize page number
    page = Number.isFinite(page) ? Math.max(1, Math.min(page, totalPages)) : 1;

    // Get personalities for the current page
    const startIdx = (page - 1) * FIELDS_PER_PAGE;
    const endIdx = Math.min(startIdx + FIELDS_PER_PAGE, personalityCount);
    const paginatedPersonalities = personalities.slice(startIdx, endIdx);

    console.log(
      `[EmbedBuilders] Creating page ${page}/${totalPages} with personalities ${startIdx}-${endIdx - 1} of ${personalityCount}`
    );

    // Create the embed with explicit checks for number safety
    const embed = new EmbedBuilder()
      .setTitle(`Your Personalities (Page ${page}/${totalPages})`)
      .setDescription(`You have ${personalityCount} personalities`)
      .setColor('#5865F2')
      .setFooter({ text: `Page ${page} of ${totalPages}` });

    // Check if personalityAliases is a Map
    let aliasesMap;
    if (!(personalityAliases instanceof Map)) {
      console.error(
        `[EmbedBuilders] personalityAliases is not a Map: ${typeof personalityAliases}`
      );
      // If it's not a Map, we can try to convert it
      aliasesMap = new Map();
      if (typeof personalityAliases === 'object' && personalityAliases !== null) {
        Object.entries(personalityAliases).forEach(([key, value]) => {
          aliasesMap.set(key, value);
        });
      }
    } else {
      aliasesMap = personalityAliases;
    }

    // Add just the personalities for this page to the embed
    paginatedPersonalities.forEach(p => {
      // Safety check for personality structure
      if (!p || typeof p !== 'object') {
        console.error(`[EmbedBuilders] Invalid personality object: ${typeof p}`);
        return; // Skip this personality
      }

      // Default fallback for fullName if missing
      const fullName = p.fullName || 'unknown';
      const displayName = p.displayName || fullName;

      // Find all aliases for this personality
      const aliases = [];
      try {
        // Make sure aliasesMap is actually a Map before using entries()
        if (aliasesMap && typeof aliasesMap.entries === 'function') {
          for (const [alias, name] of aliasesMap.entries()) {
            if (name === fullName) {
              aliases.push(alias);
            }
          }
        } else {
          console.error(`[EmbedBuilders] aliasesMap is not a valid Map:`, aliasesMap);
          // If aliasesMap is an object, try to iterate through it as a fallback
          if (aliasesMap && typeof aliasesMap === 'object') {
            for (const [alias, name] of Object.entries(aliasesMap)) {
              if (name === fullName) {
                aliases.push(alias);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[EmbedBuilders] Error iterating aliasesMap: ${error.message}`);
        // Continue with empty aliases
      }

      const aliasText = aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : 'No aliases';

      // Ensure all values are valid strings for Discord.js
      const safeDisplayName = displayName ? String(displayName) : 'Unknown';
      const safeFullName = fullName ? String(fullName) : 'unknown';
      const safeAliasText = aliasText ? String(aliasText) : 'No aliases';

      embed.addFields({
        name: safeDisplayName,
        value: `ID: \`${safeFullName}\`\n${safeAliasText}`,
      });
    });

    // Add navigation instructions if not on the last page
    if (totalPages > 1 && page < totalPages) {
      embed.addFields({
        name: 'Navigation',
        value: `Use \`${botPrefix} list ${page + 1}\` to see the next page`,
      });
    }

    // Add navigation to previous page if not on the first page
    if (page > 1) {
      embed.addFields({
        name: 'Navigation',
        value: `Use \`${botPrefix} list ${page - 1}\` to go back to the previous page`,
      });
    }

    return {
      embed,
      totalPages,
      currentPage: page,
    };
  } catch (error) {
    console.error(`[EmbedBuilders] Error creating personality list embed: ${error.message}`, error);

    // Create a dump of the problematic data for debugging
    // Note: personalities might not be defined in the catch block scope
    const debugInfo = {
      personalitiesType: 'unknown', // Can't reference personalities variable here as it's not in scope
      isArray: false,
      count: 'N/A',
      aliasesType:
        typeof personalityAliases !== 'undefined' ? typeof personalityAliases : 'undefined',
      isMap:
        typeof personalityAliases !== 'undefined' ? personalityAliases instanceof Map : 'undefined',
    };

    console.error(`[EmbedBuilders] Debug data: ${JSON.stringify(debugInfo)}`);

    // Return a basic error embed
    return {
      embed: new EmbedBuilder()
        .setTitle('Error')
        .setDescription(
          `Sorry, there was a problem displaying your personalities. Please try again later.`
        )
        .setColor('#FF0000'),
      totalPages: 1,
      currentPage: 1,
    };
  }
}

/**
 * Creates an embed listing personalities on a single page
 * @param {Array<Object>} personalities - Array of personality objects for the current page
 * @param {number} page - Current page number
 * @param {number} totalPages - Total number of pages
 * @param {Object} author - Message author object
 * @returns {EmbedBuilder} Discord embed
 */
function createListEmbed(personalities, page, totalPages, _author) {
  try {
    // Create the embed
    const embed = new EmbedBuilder()
      .setTitle(`Your Personalities (Page ${page}/${totalPages})`)
      .setDescription(`You have ${personalities.length} personalities on this page`)
      .setColor('#5865F2')
      .setFooter({ text: `Page ${page} of ${totalPages}` });

    // Add personalities to the embed
    personalities.forEach(p => {
      // Default fallback for fullName if missing
      const fullName = p.fullName || 'unknown';
      const displayName = p.displayName || fullName;

      // Ensure all values are valid strings for Discord.js
      const safeDisplayName = displayName ? String(displayName) : 'Unknown';
      const safeFullName = fullName ? String(fullName) : 'unknown';

      embed.addFields({
        name: safeDisplayName,
        value: `ID: \`${safeFullName}\``,
      });
    });

    // Add navigation instructions
    if (totalPages > 1) {
      let navigationText = '';

      if (page < totalPages) {
        navigationText += `Use \`${botPrefix} list ${page + 1}\` to see the next page\n`;
      }

      if (page > 1) {
        navigationText += `Use \`${botPrefix} list ${page - 1}\` to see the previous page`;
      }

      if (navigationText) {
        embed.addFields({
          name: 'Navigation',
          value: navigationText,
        });
      }
    }

    return embed;
  } catch (error) {
    console.error(`[EmbedBuilders] Error creating list embed: ${error.message}`, error);

    // Return a basic error embed
    return new EmbedBuilder()
      .setTitle('Error')
      .setDescription(
        'Sorry, there was a problem displaying your personalities. Please try again later.'
      )
      .setColor('#FF0000');
  }
}

/**
 * Creates an embed with detailed personality information
 * @param {Object} personality - Personality object
 * @param {Array<string>} aliases - Array of aliases for the personality
 * @returns {EmbedBuilder} Discord embed
 */
function createPersonalityInfoEmbed(personality, aliases) {
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

  return embed;
}

/**
 * Creates an embed with bot status information
 * @param {Object} client - Discord client instance
 * @param {number} totalPersonalities - Total number of personalities
 * @param {number} userPersonalities - Number of personalities for the user
 * @param {string} [verificationStatus="Unknown"] - User's age verification status
 * @returns {EmbedBuilder} Discord embed
 */
function createStatusEmbed(
  client,
  totalPersonalities,
  userPersonalities,
  verificationStatus = 'Unknown'
) {
  const embed = new EmbedBuilder()
    .setTitle(`${botConfig.name} Status`)
    .setDescription('Current bot status and statistics')
    .setColor('#5865F2')
    .addFields(
      { name: 'Uptime', value: formatUptime(client.uptime) },
      { name: 'Total Personalities', value: totalPersonalities.toString() },
      { name: 'Your Personalities', value: userPersonalities.toString() },
      { name: 'Connected Servers', value: client.guilds.cache.size.toString() },
      { name: 'Age Verification', value: verificationStatus },
      {
        name: 'Memory Usage',
        value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
      }
    )
    .setFooter({ text: `Bot Version: 1.0.0` });

  return embed;
}

/**
 * Creates the general help embed
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {EmbedBuilder} Discord embed
 */
function createHelpEmbed(isAdmin) {
  const prefix = botPrefix;
  const embed = new EmbedBuilder()
    .setTitle(`${botConfig.name} Help`)
    .setDescription(
      `${botConfig.name} allows you to interact with multiple AI personalities in Discord.`
    )
    .setColor('#5865F2')
    .addFields(
      // Authentication commands
      {
        name: 'Authentication',
        value: 'You must authenticate before using the bot. Use these commands:',
      },
      {
        name: `${prefix} auth start`,
        value: 'Start the authentication process and get a link',
      },
      {
        name: `${prefix} auth code <code>`,
        value: 'Submit your authorization code (DM only for security)',
      },
      {
        name: `${prefix} auth status`,
        value: 'Check your current authorization status',
      },
      {
        name: `${prefix} auth revoke`,
        value: 'Revoke your authorization',
      },
      // Personality management
      {
        name: 'Personality Management',
        value: 'Commands for adding and managing personalities:',
      },
      { name: `${prefix} add <profile_name> [alias]`, value: 'Add a new AI personality' },
      { name: `${prefix} list`, value: 'List all your AI personalities' },
      {
        name: `${prefix} alias <profile_name> <new_alias>`,
        value: 'Add an alias for a personality',
      },
      { name: `${prefix} remove <profile_name>`, value: 'Remove a personality' },
      { name: `${prefix} info <profile_name>`, value: 'Show details about a personality' },
      {
        name: `${prefix} help [command]`,
        value: 'Show this help or help for a specific command',
      },
      // Channel and conversation management
      {
        name: 'Channel and Conversation Management',
        value: 'Commands for managing conversations:',
      },
      {
        name: `${prefix} activate <personality>`,
        value:
          'Activate a personality for all users in the channel (requires Manage Messages permission)',
      },
      {
        name: `${prefix} deactivate`,
        value: 'Deactivate the channel-wide personality (requires Manage Messages permission)',
      },
      {
        name: `${prefix} autorespond <on|off|status>`,
        value: 'Toggle whether personalities continue responding to your messages automatically',
      },
      { name: `${prefix} reset`, value: 'Clear your active conversation' },
      {
        name: `${prefix} verify`,
        value:
          'Verify your age to use AI personalities in Direct Messages (must be run in NSFW channel)',
      }
    )
    .setFooter({
      text: 'To interact with a personality, mention them with @alias or reply to their messages',
    });

  // Add admin commands only for users with Administrator permission
  if (isAdmin) {
    embed.addFields(
      {
        name: `Admin Commands`,
        value: 'The following commands are only available to administrators',
      },
      {
        name: `${prefix} debug <subcommand>`,
        value: 'Advanced debugging tools (Use `help debug` for more info)',
      }
    );
  }

  return embed;
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
  createPersonalityAddedEmbed,
  createPersonalityListEmbed,
  createListEmbed,
  createPersonalityInfoEmbed,
  createStatusEmbed,
  createHelpEmbed,
  formatUptime,
};
