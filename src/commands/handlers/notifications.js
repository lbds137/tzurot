const logger = require('../../logger');
const { EmbedBuilder } = require('discord.js');
const validator = require('../utils/commandValidator');

/**
 * Command metadata
 */
const meta = {
  name: 'notifications',
  aliases: ['notif', 'notify'],
  description: 'Manage release notification preferences',
  usage: 'notifications [on|off|status|level <major|minor|patch>]',
  examples: [
    'notifications status - Check your notification settings',
    'notifications off - Opt out of all release notifications',
    'notifications on - Opt back in to release notifications',
    'notifications level major - Only notify for major releases',
    'notifications level minor - Notify for minor and major releases (default)',
    'notifications level patch - Notify for all releases including patches',
  ],
  category: 'utility',
  permissions: [],
};

/**
 * Execute the notifications command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @param {Object} context - Command context
 * @returns {Promise<Object>} Command result
 */
async function execute(message, args, { releaseNotificationManager }) {
  const userId = message.author.id;
  const subcommand = args[0]?.toLowerCase();

  // If no subcommand, show status
  if (!subcommand) {
    return showStatus(message, userId, releaseNotificationManager);
  }

  switch (subcommand) {
    case 'status':
      return showStatus(message, userId, releaseNotificationManager);

    case 'off':
      return optOut(message, userId, releaseNotificationManager);

    case 'on':
      return optIn(message, userId, releaseNotificationManager);

    case 'level':
      return setLevel(message, userId, args[1], releaseNotificationManager);

    default: {
      const directSend = validator.createDirectSend(message);
      return directSend(
        'Invalid subcommand. Use `status`, `on`, `off`, or `level <major|minor|patch>`.'
      );
    }
  }
}

async function showStatus(message, userId, manager) {
  try {
    const prefs = manager.preferences.getUserPreferences(userId);

    const embed = new EmbedBuilder()
      .setColor(prefs.optedOut ? 0xff0000 : 0x00ff00)
      .setTitle('📬 Release Notification Settings')
      .setDescription(
        prefs.optedOut
          ? '❌ You are **opted out** of release notifications.'
          : '✅ You are **opted in** to release notifications.'
      )
      .addFields(
        {
          name: 'Notification Level',
          value: getLevelDescription(prefs.notificationLevel),
          inline: true,
        },
        {
          name: 'Last Notified',
          value: prefs.lastNotified || 'Never',
          inline: true,
        }
      )
      .setFooter({ text: 'Use !tz notifications help for more options' });

    return message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`[notifications] Error showing status: ${error.message}`);
    return message.reply('An error occurred while fetching your notification settings.');
  }
}

async function optOut(message, userId, manager) {
  try {
    await manager.preferences.setOptOut(userId, true);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🔕 Opted Out')
      .setDescription('You have been opted out of release notifications.')
      .setFooter({ text: 'Use !tz notifications on to opt back in' });

    return message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`[notifications] Error opting out: ${error.message}`);
    return message.reply('An error occurred while updating your preferences.');
  }
}

async function optIn(message, userId, manager) {
  try {
    await manager.preferences.setOptOut(userId, false);

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('🔔 Opted In')
      .setDescription('You have been opted in to release notifications.')
      .addFields({
        name: 'Current Level',
        value: getLevelDescription(
          manager.preferences.getUserPreferences(userId).notificationLevel
        ),
      })
      .setFooter({ text: 'Use !tz notifications level <type> to change notification level' });

    return message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`[notifications] Error opting in: ${error.message}`);
    return message.reply('An error occurred while updating your preferences.');
  }
}

async function setLevel(message, userId, level, manager) {
  if (!level) {
    return message.reply('Please specify a level: `major`, `minor`, or `patch`.');
  }

  const validLevels = ['major', 'minor', 'patch'];
  level = level.toLowerCase();

  if (!validLevels.includes(level)) {
    return message.reply(
      `Invalid level. Choose from: ${validLevels.map(l => `\`${l}\``).join(', ')}`
    );
  }

  try {
    await manager.preferences.setNotificationLevel(userId, level);

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('⚙️ Notification Level Updated')
      .setDescription(`Your notification level has been set to **${level}**.`)
      .addFields({
        name: 'What this means',
        value: getLevelDescription(level),
      })
      .setFooter({ text: 'You will receive notifications starting from the next release' });

    return message.reply({ embeds: [embed] });
  } catch (error) {
    logger.error(`[notifications] Error setting level: ${error.message}`);
    return message.reply('An error occurred while updating your notification level.');
  }
}

function getLevelDescription(level) {
  switch (level) {
    case 'major':
      return '🚀 **Major releases only** - Breaking changes and major new features';
    case 'minor':
      return '✨ **Minor and major releases** - All new features (default)';
    case 'patch':
      return '🔧 **All releases** - Including bug fixes and patches';
    case 'none':
      return '🚫 **No notifications** - Effectively opted out';
    default:
      return '✨ **Minor and major releases** (default)';
  }
}

module.exports = {
  meta,
  execute,
};
