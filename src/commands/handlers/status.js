/**
 * Status Command Handler
 * Shows bot status information
 */
const { EmbedBuilder } = require('discord.js');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const auth = require('../../auth');
const { listPersonalitiesForUser } = require('../../personalityManager');
const { isAutoResponseEnabled } = require('./autorespond');
const { botPrefix } = require('../../../config');

/**
 * Command metadata
 */
const meta = {
  name: 'status',
  description: 'Show bot status information',
  usage: 'status',
  aliases: [],
  permissions: [],
};

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
 * Execute the status command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, _args) {
  // Create direct send function
  const directSend = validator.createDirectSend(message);

  try {
    // Get uptime info
    const uptime = process.uptime();
    const formattedUptime = formatUptime(uptime);

    // Import client from global
    const client = global.tzurotClient;

    // Check if user is authenticated
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
        value:
          personalities && personalities.length > 0
            ? `${personalities.length} personalities`
            : 'None added yet',
        inline: true,
      });
    }

    // Add auto-response status
    const autoResponseStatus = isAutoResponseEnabled(message.author.id);
    embed.addFields({
      name: 'Auto-Response',
      value: autoResponseStatus ? '✅ Enabled' : '❌ Disabled',
      inline: true,
    });

    // Add bot avatar if available
    if (client.user.avatarURL()) {
      embed.setThumbnail(client.user.avatarURL());
    }

    // Set footer with help command info
    embed.setFooter({
      text: `Use "${botPrefix} help" for available commands.`,
    });

    return await directSend({ embeds: [embed] });
  } catch (error) {
    logger.error('Error in status command:', error);
    return await directSend(`An error occurred while getting bot status: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
};
