/**
 * Permissions Middleware
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');

/**
 * Permissions middleware for commands
 * Checks if a user has the required permissions to use a command
 *
 * @param {Object} message - Discord message object
 * @param {string} command - Command being executed
 * @param {Object} commandModule - Command module with meta
 * @returns {Object} Permission check result with status and error
 */
function permissionsMiddleware(message, command, commandModule) {
  // If no command module or no permissions required, allow
  if (
    !commandModule ||
    !commandModule.meta.permissions ||
    commandModule.meta.permissions.length === 0
  ) {
    return {
      hasPermission: true,
    };
  }

  // Check each required permission
  for (const permission of commandModule.meta.permissions) {
    switch (permission) {
      case 'ADMINISTRATOR':
        if (!validator.isAdmin(message)) {
          logger.info(
            `[Permissions] User ${message.author.tag} lacks ADMINISTRATOR permission for ${command}`
          );
          return {
            hasPermission: false,
            error: validator.getPermissionErrorMessage('ADMINISTRATOR', command),
          };
        }
        break;

      case 'MANAGE_MESSAGES':
        if (!validator.canManageMessages(message)) {
          logger.info(
            `[Permissions] User ${message.author.tag} lacks MANAGE_MESSAGES permission for ${command}`
          );
          return {
            hasPermission: false,
            error: validator.getPermissionErrorMessage('MANAGE_MESSAGES', command),
          };
        }
        break;

      case 'NSFW_CHANNEL':
        if (!validator.isNsfwChannel(message.channel)) {
          logger.info(`[Permissions] Channel ${message.channel.id} is not NSFW for ${command}`);
          return {
            hasPermission: false,
            error: validator.getPermissionErrorMessage('NSFW_CHANNEL', command),
          };
        }
        break;

      default:
        logger.warn(`[Permissions] Unknown permission requirement: ${permission}`);
    }
  }

  // All permission checks passed
  return {
    hasPermission: true,
  };
}

module.exports = permissionsMiddleware;
