/**
 * AuthCommand - Manages user authentication with the AI service
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/authentication/AuthCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Factory function to create an AuthCommand instance
 * @returns {Command} Configured auth command
 */
function createAuthCommand(dependencies = {}) {
  return new Command({
    name: 'auth',
    description: 'Authenticate with the AI service',
    category: 'Authentication',
    aliases: [],
    options: [
      new CommandOption({
        name: 'action',
        description: 'Authentication action to perform',
        type: 'string',
        required: false,
        choices: [
          { name: 'start', value: 'start' },
          { name: 'code', value: 'code' },
          { name: 'status', value: 'status' },
          { name: 'revoke', value: 'revoke' },
          { name: 'cleanup', value: 'cleanup' },
        ],
      }),
      new CommandOption({
        name: 'code',
        description: 'Authorization code (for code action)',
        type: 'string',
        required: false,
      }),
    ],
    examples: [
      { command: 'auth', description: 'Show authentication help' },
      { command: 'auth start', description: 'Begin the authentication process' },
      { command: 'auth code YOUR_CODE', description: 'Submit your authorization code' },
      { command: 'auth status', description: 'Check your authentication status' },
      { command: 'auth revoke', description: 'Revoke your authorization' },
    ],
    execute: createExecutor(dependencies),
  });
}

/**
 * Create the command executor function
 */
function createExecutor(dependencies) {
  return async function execute(context) {
    const { args, options, services, isWebhook } = context;
    const auth = services.auth;
    const webhookUserTracker = services.webhookUserTracker;

    logger.info(`[AuthCommand] Executing for user ${context.userId}`);

    try {
      // Check if this is a webhook message from a proxy system
      if (isWebhook && webhookUserTracker?.isProxySystemWebhook(context.originalMessage)) {
        logger.info('[AuthCommand] Detected proxy system webhook for auth command');
        return await context.respond(
          '**Authentication with Proxy Systems**\n\n' +
            'For security reasons, authentication commands can\'t be used through webhook systems like PluralKit.\n\n' +
            'Please use your regular Discord account (without the proxy) to run authentication commands.'
        );
      }

      // Get action from options or args
      const action = options.action || args[0]?.toLowerCase();

      // If no action specified, show help
      if (!action) {
        return await showHelp(context);
      }

      // Handle the various subcommands
      switch (action) {
        case 'start':
          return await handleStart(context, auth);
        case 'code':
          return await handleCode(context, auth, options.code || args[1]);
        case 'status':
          return await handleStatus(context, auth);
        case 'revoke':
          return await handleRevoke(context, auth);
        case 'cleanup':
          return await handleCleanup(context, auth);
        default:
          return await context.respond(
            `Unknown auth subcommand: \`${action}\`. Use \`${context.commandPrefix}auth\` to see available subcommands.`
          );
      }
    } catch (error) {
      logger.error('[AuthCommand] Unexpected error:', error);
      return await context.respond('❌ An unexpected error occurred. Please try again later.');
    }
  };
}

/**
 * Show authentication help
 */
async function showHelp(context) {
  const { commandPrefix } = context;

  let helpText =
    '**🔐 Authentication Required**\n\n' +
    `To get started, run: \`${commandPrefix}auth start\`\n\n` +
    '**Available Commands:**\n' +
    `- \`${commandPrefix}auth start\` - Begin the authentication process\n` +
    `- \`${commandPrefix}auth code <code>\` - Submit your authorization code (DM only)\n` +
    `- \`${commandPrefix}auth status\` - Check your authentication status\n` +
    `- \`${commandPrefix}auth revoke\` - Revoke your authorization\n\n` +
    '⚠️ For security, authorization codes must be submitted via DM only.';

  // Check if user is admin or bot owner for additional commands
  const isAdmin = await context.hasPermission('Administrator');
  const isBotOwner = context.userId === process.env.BOT_OWNER_ID;

  if (isAdmin || isBotOwner) {
    helpText += '\n\n**Admin Commands:**\n' + `- \`${commandPrefix}auth cleanup\` - Clean up expired tokens`;
  }

  return await context.respond(helpText);
}

/**
 * Handle auth start subcommand
 */
async function handleStart(context, auth) {
  try {
    const authUrl = await auth.getAuthorizationUrl();

    if (!authUrl) {
      return await context.respond('❌ Failed to generate authentication URL. Please try again later.');
    }

    // Check if this is a DM
    const isDM = context.isDM;

    if (isDM) {
      // In DMs, we can safely send the auth URL directly
      return await context.respond(
        '**Authentication Required**\n\n' +
          'Please click the link below to authenticate with the service:\n\n' +
          `${authUrl}\n\n` +
          `After authorizing, you'll receive a code. Use \`${context.commandPrefix}auth code YOUR_CODE\` to complete the process.`
      );
    } else {
      // In public channels, try to send a DM
      try {
        await context.sendDM(
          '**Authentication Required**\n\n' +
            'Please click the link below to authenticate with the service:\n\n' +
            `${authUrl}\n\n` +
            `After authorizing, you'll receive a code. Use \`${context.commandPrefix}auth code YOUR_CODE\` here in DM to complete the process.`
        );

        return await context.respond(
          'I\'ve sent you a DM with authentication instructions. Please check your DMs.'
        );
      } catch (dmError) {
        logger.warn(`[AuthCommand] Failed to send DM to user ${context.userId}: ${dmError.message}`);
        return await context.respond(
          '❌ Unable to send you a DM. Please ensure your DMs are open, then try again. You can open DMs in User Settings > Privacy & Safety.'
        );
      }
    }
  } catch (error) {
    logger.error(`[AuthCommand] Error starting auth process: ${error.message}`);
    return await context.respond(`❌ An error occurred: ${error.message}`);
  }
}

/**
 * Handle auth code subcommand
 */
async function handleCode(context, auth, code) {
  // Check if a code was provided
  if (!code) {
    return await context.respond(
      `Please provide your authorization code. Usage: \`${context.commandPrefix}auth code YOUR_CODE\``
    );
  }

  // For security, only accept auth codes in DMs
  if (!context.isDM) {
    // Try to delete the message to protect the code
    try {
      await context.deleteMessage();
    } catch (deleteError) {
      logger.warn(`[AuthCommand] Failed to delete auth code message: ${deleteError.message}`);
    }

    return await context.respond(
      '❌ For security, please submit your authorization code via DM, not in a public channel.'
    );
  }

  // Check if the code is wrapped in Discord spoiler tags ||code||
  if (code.startsWith('||') && code.endsWith('||')) {
    code = code.substring(2, code.length - 2);
    logger.info('[AuthCommand] Extracted code from spoiler tags');
  }

  // Show typing indicator while processing
  await context.startTyping();

  try {
    // Exchange the code for a token
    logger.info('[AuthCommand] Exchanging code for token...');
    const token = await auth.exchangeCodeForToken(code);

    if (!token) {
      return await context.respond('❌ Authorization failed. The code may be invalid or expired.');
    }

    // Store the token
    logger.info(`[AuthCommand] Storing token for user ${context.userId}`);
    const stored = await auth.storeUserToken(context.userId, token);

    if (!stored) {
      return await context.respond('❌ Failed to store authorization token. Please try again later.');
    }

    return await context.respond(
      '✅ Authorization successful! The bot will now use your account for AI interactions.'
    );
  } catch (error) {
    logger.error(`[AuthCommand] Error during auth code exchange: ${error.message}`);
    return await context.respond('❌ An error occurred during authorization. Please try again later.');
  }
}

/**
 * Handle auth status subcommand
 */
async function handleStatus(context, auth) {
  // Check if the user has a valid token
  const hasToken = auth.hasValidToken(context.userId);

  if (hasToken) {
    // Get token age and expiration info
    const tokenAge = auth.getTokenAge(context.userId);
    const expirationInfo = auth.getTokenExpirationInfo(context.userId);

    let statusMessage =
      '✅ You have a valid authorization token. The bot is using your account for AI interactions.';

    // Add token age and expiration info if available
    if (tokenAge !== null && expirationInfo) {
      statusMessage += '\n\n**Token Details:**\n';
      statusMessage += `- Created: ${tokenAge} day${tokenAge !== 1 ? 's' : ''} ago\n`;
      statusMessage += `- Expires in: ${expirationInfo.daysUntilExpiration} day${
        expirationInfo.daysUntilExpiration !== 1 ? 's' : ''
      }\n`;
      statusMessage += `- Time remaining: ${expirationInfo.percentRemaining}%`;

      // Add warning if token is expiring soon (less than 7 days)
      if (expirationInfo.daysUntilExpiration < 7) {
        statusMessage += `\n\n⚠️ **Your token will expire soon.** When it expires, you'll need to re-authenticate. Use \`${context.commandPrefix}auth revoke\` and then \`${context.commandPrefix}auth start\` to renew your token.`;
      }
    }

    return await context.respond(statusMessage);
  } else {
    return await context.respond(
      `❌ You don't have an authorization token. Use \`${context.commandPrefix}auth start\` to begin the authorization process.`
    );
  }
}

/**
 * Handle auth revoke subcommand
 */
async function handleRevoke(context, auth) {
  // Delete the user's token
  const deleted = await auth.deleteUserToken(context.userId);

  if (deleted) {
    return await context.respond(
      '✅ Your authorization has been revoked. The bot will no longer use your personal account.'
    );
  } else {
    return await context.respond('❌ Failed to revoke authorization. Please try again later.');
  }
}

/**
 * Handle auth cleanup subcommand (admin only)
 */
async function handleCleanup(context, auth) {
  // Check if the user is an admin or bot owner
  const isAdmin = await context.hasPermission('Administrator');
  const isBotOwner = context.userId === process.env.BOT_OWNER_ID;

  if (!isAdmin && !isBotOwner) {
    return await context.respond(
      '❌ This command can only be used by server administrators or the bot owner.'
    );
  }

  try {
    // Run the cleanup
    const removedCount = await auth.cleanupExpiredTokens();

    if (removedCount > 0) {
      return await context.respond(
        `✅ Cleanup complete. Removed ${removedCount} expired token${removedCount === 1 ? '' : 's'}.`
      );
    } else {
      return await context.respond('✅ Cleanup complete. No expired tokens were found.');
    }
  } catch (error) {
    logger.error(`[AuthCommand] Error during manual cleanup: ${error.message}`);
    return await context.respond(`❌ An error occurred during cleanup: ${error.message}`);
  }
}

module.exports = {
  createAuthCommand,
};