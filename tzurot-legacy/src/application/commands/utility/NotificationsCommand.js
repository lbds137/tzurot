/**
 * Notifications Command - Manage release notification preferences
 *
 * Allows users to configure their preferences for receiving bot update
 * notifications, including opt-in/out and notification level settings.
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Get human-readable description for notification level
 * @param {string} level - Notification level
 * @returns {string} Description
 */
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

/**
 * Creates the executor function for the notifications command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      const { releaseNotificationManager = require('../../../core/notifications').getInstance() } =
        dependencies;

      // Get subcommand from args or options
      const subcommand = context.options.action || context.args[0]?.toLowerCase();
      const userId = context.userId;

      // If no subcommand, show status
      if (!subcommand || subcommand === 'status') {
        return await showStatus(context, userId, releaseNotificationManager);
      }

      switch (subcommand) {
        case 'off':
          return await optOut(context, userId, releaseNotificationManager);

        case 'on':
          return await optIn(context, userId, releaseNotificationManager);

        case 'level': {
          const level = context.options.level || context.args[1];
          return await setLevel(context, userId, level, releaseNotificationManager);
        }

        default:
          await context.respond(
            'Invalid subcommand. Use `status`, `on`, `off`, or `level <major|minor|patch>`.'
          );
      }
    } catch (error) {
      logger.error('[NotificationsCommand] Execution failed:', error);
      await context.respond('An error occurred while managing notification preferences.');
    }
  };
}

async function showStatus(context, userId, manager) {
  try {
    const prefs = manager.preferences.getUserPreferences(userId);

    if (context.respondWithEmbed) {
      const embed = {
        color: prefs.optedOut ? 0xff0000 : 0x00ff00,
        title: '📬 Release Notification Settings',
        description: prefs.optedOut
          ? '❌ You are **opted out** of release notifications.'
          : '✅ You are **opted in** to release notifications.',
        fields: [
          {
            name: 'Notification Level',
            value: getLevelDescription(prefs.notificationLevel),
            inline: true,
          },
          {
            name: 'Last Notified',
            value: prefs.lastNotified || 'Never',
            inline: true,
          },
        ],
        footer: { text: `Use ${context.commandPrefix} help notifications for more options` },
      };

      await context.respondWithEmbed(embed);
    } else {
      // Text fallback
      const status = prefs.optedOut ? 'opted out of' : 'opted in to';
      const lines = [
        `**Release Notification Settings**`,
        `Status: You are ${status} release notifications`,
        `Level: ${prefs.notificationLevel || 'minor'}`,
        `Last notified: ${prefs.lastNotified || 'Never'}`,
      ];
      await context.respond(lines.join('\n'));
    }
  } catch (error) {
    logger.error('[NotificationsCommand] Error showing status:', error);
    await context.respond('An error occurred while fetching your notification settings.');
  }
}

async function optOut(context, userId, manager) {
  try {
    await manager.preferences.setOptOut(userId, true);

    if (context.respondWithEmbed) {
      const embed = {
        color: 0xff0000,
        title: '🔕 Opted Out',
        description: 'You have been opted out of release notifications.',
        footer: { text: `Use ${context.commandPrefix} notifications on to opt back in` },
      };

      await context.respondWithEmbed(embed);
    } else {
      await context.respond('🔕 You have been opted out of release notifications.');
    }
  } catch (error) {
    logger.error('[NotificationsCommand] Error opting out:', error);
    await context.respond('An error occurred while updating your preferences.');
  }
}

async function optIn(context, userId, manager) {
  try {
    await manager.preferences.setOptOut(userId, false);

    if (context.respondWithEmbed) {
      const embed = {
        color: 0x00ff00,
        title: '🔔 Opted In',
        description: 'You have been opted in to release notifications.',
        fields: [
          {
            name: 'Current Level',
            value: getLevelDescription(
              manager.preferences.getUserPreferences(userId).notificationLevel
            ),
          },
        ],
        footer: {
          text: `Use ${context.commandPrefix} notifications level <type> to change notification level`,
        },
      };

      await context.respondWithEmbed(embed);
    } else {
      const prefs = manager.preferences.getUserPreferences(userId);
      await context.respond(
        `🔔 You have been opted in to release notifications.\nCurrent level: ${prefs.notificationLevel || 'minor'}`
      );
    }
  } catch (error) {
    logger.error('[NotificationsCommand] Error opting in:', error);
    await context.respond('An error occurred while updating your preferences.');
  }
}

async function setLevel(context, userId, level, manager) {
  if (!level) {
    await context.respond('Please specify a level: `major`, `minor`, or `patch`.');
    return;
  }

  const validLevels = ['major', 'minor', 'patch'];
  level = level.toLowerCase();

  if (!validLevels.includes(level)) {
    await context.respond(
      `Invalid level. Choose from: ${validLevels.map(l => `\`${l}\``).join(', ')}`
    );
    return;
  }

  try {
    await manager.preferences.setNotificationLevel(userId, level);

    if (context.respondWithEmbed) {
      const embed = {
        color: 0x0099ff,
        title: '⚙️ Notification Level Updated',
        description: `Your notification level has been set to **${level}**.`,
        fields: [
          {
            name: 'What this means',
            value: getLevelDescription(level),
          },
        ],
        footer: { text: 'You will receive notifications starting from the next release' },
      };

      await context.respondWithEmbed(embed);
    } else {
      await context.respond(
        `⚙️ Your notification level has been set to **${level}**.\n${getLevelDescription(level)}`
      );
    }
  } catch (error) {
    logger.error('[NotificationsCommand] Error setting level:', error);
    await context.respond('An error occurred while updating your notification level.');
  }
}

/**
 * Factory function to create the notifications command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The notifications command instance
 */
function createNotificationsCommand(dependencies = {}) {
  return new Command({
    name: 'notifications',
    description: 'Manage release notification preferences',
    category: 'Utility',
    aliases: ['notif', 'notify'],
    options: [
      new CommandOption({
        name: 'action',
        description: 'Action to perform',
        type: 'string',
        required: false,
        choices: [
          { name: 'Show current settings', value: 'status' },
          { name: 'Opt out of notifications', value: 'off' },
          { name: 'Opt in to notifications', value: 'on' },
          { name: 'Set notification level', value: 'level' },
        ],
      }),
      new CommandOption({
        name: 'level',
        description: 'Notification level (when action is "level")',
        type: 'string',
        required: false,
        choices: [
          { name: 'Major releases only', value: 'major' },
          { name: 'Minor and major releases', value: 'minor' },
          { name: 'All releases including patches', value: 'patch' },
        ],
      }),
    ],
    execute: createExecutor(dependencies),
  });
}

module.exports = {
  createNotificationsCommand,
  getLevelDescription, // Export for testing
};
