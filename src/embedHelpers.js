const { EmbedBuilder } = require('discord.js');
const { botPrefix } = require('../config');
const { listPersonalitiesForUser, personalityAliases } = require('./personalityManager');

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
 * @param {string} userId - User ID
 * @returns {EmbedBuilder} Discord embed
 */
function createPersonalityListEmbed(userId) {
  // Get all personalities for the user
  const personalities = listPersonalitiesForUser(userId);

  const embed = new EmbedBuilder()
    .setTitle('Your Personalities')
    .setDescription(`You have ${personalities.length} personalities`)
    .setColor('#5865F2');

  // Add each personality to the embed
  personalities.forEach(p => {
    // Find all aliases for this personality
    const aliases = [];
    for (const [alias, name] of Object.entries(personalityAliases)) {
      if (name === p.fullName) {
        aliases.push(alias);
      }
    }

    const aliasText = aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : 'No aliases';

    embed.addFields({
      name: p.displayName || p.fullName,
      value: `ID: \`${p.fullName}\`\n${aliasText}`,
    });
  });

  return embed;
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
 * @returns {EmbedBuilder} Discord embed
 */
function createStatusEmbed(client, totalPersonalities, userPersonalities) {
  const embed = new EmbedBuilder()
    .setTitle('Tzurot Status')
    .setDescription('Current bot status and statistics')
    .setColor('#5865F2')
    .addFields(
      { name: 'Uptime', value: formatUptime(client.uptime) },
      { name: 'Total Personalities', value: totalPersonalities.toString() },
      { name: 'Your Personalities', value: userPersonalities.toString() },
      { name: 'Connected Servers', value: client.guilds.cache.size.toString() },
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
    .setTitle('Tzurot Help')
    .setDescription('Tzurot allows you to interact with multiple AI personalities in Discord.')
    .setColor('#5865F2')
    .addFields(
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
      { name: `${prefix} reset`, value: 'Clear your active conversation' }
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
  createPersonalityInfoEmbed,
  createStatusEmbed,
  createHelpEmbed,
  formatUptime
};