/**
 * Authentication Middleware
 */
const logger = require('../../logger');
const auth = require('../../auth');
const webhookUserTracker = require('../../utils/webhookUserTracker');
const { botPrefix } = require('../../../config');

/**
 * Authentication middleware for commands
 * Checks if a user is authenticated for using commands
 *
 * @param {Object} message - Discord message object
 * @param {string} command - Command being executed
 * @param {Array<string>} args - Command arguments
 * @returns {Object} Authentication result with status and error
 */
async function authMiddleware(message, command, args) {
  const userId = message.author.id;
  let webhookAuthBypass = false;

  // For webhook messages, check if it's a proxy system
  if (message.webhookId) {
    logger.info(`[Auth Middleware] Processing command from webhook: ${message.author.username}`);

    // Special case for auth command from proxy systems
    if (command === 'auth' && !webhookUserTracker.isAuthenticationAllowed(message)) {
      logger.warn(
        `[Auth Middleware] Auth command from proxy webhook denied: ${message.author.username}`
      );
      return {
        authenticated: false,
        error:
          `**Authentication with Proxy Systems**\n\n` +
          `For security reasons, authentication commands can't be used through webhook systems like PluralKit.\n\n` +
          `Please use your regular Discord account (without the proxy) to run authentication commands.`,
        bypass: true, // Indicates we should stop processing but not as a regular auth failure
      };
    }

    // For non-auth commands from webhooks, check if we should bypass verification
    if (webhookUserTracker.shouldBypassNsfwVerification(message)) {
      logger.info(`[Auth Middleware] Bypassing auth check for webhook command: ${command}`);

      // Only non-auth commands can be bypassed
      const isAuthCommand = command === 'auth';
      if (!isAuthCommand) {
        webhookAuthBypass = true;
        logger.info(`[Auth Middleware] Auth bypass enabled for webhook command: ${command}`);
      }
    }
  }

  // Check if the user is authenticated
  const isAuthenticated = webhookAuthBypass ? true : auth.hasValidToken(userId);
  const isAuthCommand = command === 'auth' || command === 'help';

  // If not authenticated and not using an auth command, reject
  if (!isAuthenticated && !isAuthCommand) {
    logger.info(
      `[Auth Middleware] Unauthorized user ${message.author.tag} attempted to use command: ${command}`
    );

    // Try to send a DM for more secure authentication
    try {
      // First try a DM
      await message.author.send(
        `**Authentication Required**\n\n` +
          `You need to authenticate with the service before using any commands.\n\n` +
          `Please use \`${botPrefix} auth start\` to begin the authentication process. ` +
          `Once authenticated, you'll be able to use all bot commands.\n\n` +
          `For security, I recommend completing the authentication process in DMs rather than in a public channel.`
      );

      // Return failure with channel notification
      return {
        authenticated: false,
        error: `You need to authenticate before using this command. I've sent you a DM with instructions.`,
      };
    } catch (dmError) {
      // If DM fails, prepare channel notification
      logger.warn(
        `[Auth Middleware] Failed to send DM to user ${message.author.id}: ${dmError.message}`
      );
      return {
        authenticated: false,
        error:
          `**Authentication Required**\n\n` +
          `You need to authenticate with the service before using any commands.\n\n` +
          `Please use \`${botPrefix} auth start\` to begin the authentication process.`,
      };
    }
  }

  // User is authenticated or using an auth command
  return {
    authenticated: true,
  };
}

module.exports = authMiddleware;
