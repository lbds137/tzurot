/**
 * AuthCommand - Manages user authentication with the AI service
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/authentication/AuthCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');
const { botPrefix } = require('../../../../config');

/**
 * Get the command prefix from context or use default
 * @param {Object} context - Command context
 * @returns {string} Command prefix
 */
function getCommandPrefix(context) {
  return context.commandPrefix || context.dependencies?.botPrefix || botPrefix;
}

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
function createExecutor(_dependencies) {
  return async function execute(context) {
    const { args, options, dependencies, isWebhook } = context;
    const auth = dependencies.auth;
    const webhookUserTracker = dependencies.webhookUserTracker;

    logger.info(`[AuthCommand] Executing for user ${context.userId}`);

    try {
      // Check if this is a webhook message from a proxy system
      if (isWebhook && webhookUserTracker?.isProxySystemWebhook(context.originalMessage)) {
        logger.info('[AuthCommand] Detected proxy system webhook for auth command');
        const proxyWarningEmbed = {
          title: '❌ Authentication with Proxy Systems',
          description:
            "For security reasons, authentication commands can't be used through webhook systems like PluralKit.",
          color: 0xf44336, // Red color
          fields: [
            {
              name: 'Why is this blocked?',
              value:
                'Authentication requires direct verification of your Discord identity, which proxy systems bypass.',
              inline: false,
            },
            {
              name: 'What to do',
              value:
                'Please use your regular Discord account (without the proxy) to run authentication commands.',
              inline: false,
            },
          ],
          footer: {
            text: 'This is a security measure to protect your account',
          },
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [proxyWarningEmbed] });
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
          return await handleStart(context);
        case 'code':
          return await handleCode(context, auth, options.code || args[1]);
        case 'status':
          return await handleStatus(context);
        case 'revoke':
          return await handleRevoke(context);
        case 'cleanup':
          return await handleCleanup(context);
        default: {
          const unknownActionEmbed = {
            title: '❌ Unknown Auth Command',
            description: `"${action}" is not a valid auth subcommand.`,
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'Available subcommands',
                value: 'start, code, status, revoke',
                inline: false,
              },
              {
                name: 'Get help',
                value: `Use \`${getCommandPrefix(context)} auth\` to see detailed help`,
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [unknownActionEmbed] });
        }
      }
    } catch (error) {
      logger.error('[AuthCommand] Unexpected error:', error);
      const errorEmbed = {
        title: '❌ Authentication Error',
        description: 'An unexpected error occurred while processing your authentication request.',
        color: 0xf44336, // Red color
        fields: [
          {
            name: 'Error details',
            value: error.message || 'Unknown error',
            inline: false,
          },
          {
            name: 'What to do',
            value:
              '• Try again in a moment\n• Check your internet connection\n• Contact support if the issue persists',
            inline: false,
          },
        ],
        footer: {
          text: `Error ID: ${Date.now()}`,
        },
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [errorEmbed] });
    }
  };
}

/**
 * Show authentication help
 */
async function showHelp(context) {
  const commandPrefix = getCommandPrefix(context);

  const fields = [
    {
      name: 'Available Commands',
      value:
        `• \`${commandPrefix} auth start\` - Begin the authentication process\n` +
        `• \`${commandPrefix} auth code <code>\` - Submit your authorization code (DM only)\n` +
        `• \`${commandPrefix} auth status\` - Check your authentication status\n` +
        `• \`${commandPrefix} auth revoke\` - Revoke your authorization`,
      inline: false,
    },
    {
      name: '⚠️ Security Notice',
      value: 'For security, authorization codes must be submitted via DM only.',
      inline: false,
    },
  ];

  // Check if user is admin or bot owner for additional commands
  const isAdmin = await context.hasPermission('Administrator');
  const isBotOwner = context.userId === process.env.BOT_OWNER_ID;

  if (isAdmin || isBotOwner) {
    fields.push({
      name: '👨‍💼 Admin Commands',
      value: `• \`${commandPrefix} auth cleanup\` - Clean up expired tokens`,
      inline: false,
    });
  }

  const helpEmbed = {
    title: '🔐 Authentication Help',
    description: `To get started, run: \`${commandPrefix} auth start\``,
    color: 0x2196f3, // Blue color
    fields: fields,
    footer: {
      text: 'Authentication ensures secure access to your personal AI service',
    },
    timestamp: new Date().toISOString(),
  };

  return await context.respond({ embeds: [helpEmbed] });
}

/**
 * Handle auth start subcommand
 */
async function handleStart(context) {
  try {
    // Get authentication service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    // Generate authorization URL using DDD service
    const authUrl = await authService.getAuthorizationUrl(context.userId);

    if (!authUrl) {
      const errorEmbed = {
        title: '❌ Authentication Failed',
        description: 'Failed to generate authentication URL.',
        color: 0xf44336, // Red color
        fields: [
          {
            name: 'What to do',
            value:
              '• Try again in a moment\n• Check if the bot is properly configured\n• Contact support if the issue persists',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [errorEmbed] });
    }

    // Check if this is a DM
    const isDM = context.isDM();

    if (isDM) {
      // In DMs, we can safely send the auth URL directly
      const authEmbed = {
        title: '🔐 Authentication Required',
        description: 'Please follow these steps to authenticate with the AI service:',
        color: 0x2196f3, // Blue color
        fields: [
          {
            name: '1️⃣ Click the link',
            value: `[Authenticate with AI Service](${authUrl})`,
            inline: false,
          },
          {
            name: '2️⃣ Authorize the application',
            value: 'Follow the prompts to grant permission',
            inline: false,
          },
          {
            name: '3️⃣ Copy your code',
            value: "You'll receive an authorization code after approval",
            inline: false,
          },
          {
            name: '4️⃣ Submit your code',
            value: `Use \`${getCommandPrefix(context)} auth code YOUR_CODE\` to complete`,
            inline: false,
          },
        ],
        footer: {
          text: 'This link is unique to you and will expire',
        },
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [authEmbed] });
    } else {
      // In public channels, try to send a DM
      try {
        const dmAuthEmbed = {
          title: '🔐 Authentication Required',
          description: 'Please follow these steps to authenticate with the AI service:',
          color: 0x2196f3, // Blue color
          fields: [
            {
              name: '1️⃣ Click the link',
              value: `[Authenticate with AI Service](${authUrl})`,
              inline: false,
            },
            {
              name: '2️⃣ Authorize the application',
              value: 'Follow the prompts to grant permission',
              inline: false,
            },
            {
              name: '3️⃣ Copy your code',
              value: "You'll receive an authorization code after approval",
              inline: false,
            },
            {
              name: '4️⃣ Submit your code here',
              value: `Use \`${getCommandPrefix(context)} auth code YOUR_CODE\` in this DM`,
              inline: false,
            },
          ],
          footer: {
            text: 'This link is unique to you and will expire',
          },
          timestamp: new Date().toISOString(),
        };
        await context.sendDM({ embeds: [dmAuthEmbed] });

        const successEmbed = {
          title: '📨 Check Your DMs',
          description: "I've sent you a DM with authentication instructions.",
          color: 0x4caf50, // Green color
          fields: [
            {
              name: "Can't find the DM?",
              value:
                '• Check your Message Requests\n• Make sure DMs are enabled\n• Look for a message from this bot',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [successEmbed] });
      } catch (dmError) {
        logger.warn(
          `[AuthCommand] Failed to send DM to user ${context.userId}: ${dmError.message}`
        );
        const dmFailedEmbed = {
          title: '❌ Unable to Send DM',
          description: "I couldn't send you a direct message with the authentication link.",
          color: 0xf44336, // Red color
          fields: [
            {
              name: 'Common reasons',
              value: '• Your DMs are disabled\n• You blocked the bot\n• Server privacy settings',
              inline: false,
            },
            {
              name: 'How to fix',
              value:
                '1. Go to User Settings > Privacy & Safety\n2. Enable "Allow direct messages from server members"\n3. Try the command again',
              inline: false,
            },
            {
              name: 'Alternative',
              value: 'Run this command in a DM with the bot instead',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [dmFailedEmbed] });
      }
    }
  } catch (error) {
    logger.error(`[AuthCommand] Error starting auth process: ${error.message}`);
    const errorEmbed = {
      title: '❌ Authentication Error',
      description: 'An unexpected error occurred while starting the authentication process.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error',
          inline: false,
        },
        {
          name: 'What to do',
          value:
            '• Try again in a moment\n• Check your internet connection\n• Contact support if the issue persists',
          inline: false,
        },
      ],
      footer: {
        text: `Error ID: ${Date.now()}`,
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle auth code subcommand
 */
async function handleCode(context, auth, code) {
  // Check if a code was provided
  if (!code) {
    const missingCodeEmbed = {
      title: '❌ Code Required',
      description: 'Please provide your authorization code.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Usage',
          value: `\`${getCommandPrefix(context)} auth code YOUR_CODE\``,
          inline: false,
        },
        {
          name: 'Example',
          value: `\`${getCommandPrefix(context)} auth code abc123def456\``,
          inline: false,
        },
      ],
      footer: {
        text: 'The code is provided after authorizing the app',
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [missingCodeEmbed] });
  }

  // For security, only accept auth codes in DMs
  if (!context.isDM()) {
    // Try to delete the message to protect the code
    try {
      await context.deleteMessage();
    } catch (deleteError) {
      logger.warn(`[AuthCommand] Failed to delete auth code message: ${deleteError.message}`);
    }

    const securityWarningEmbed = {
      title: '🔒 Security Warning',
      description: 'For security, authorization codes must be submitted via DM only.',
      color: 0xff9800, // Orange color
      fields: [
        {
          name: 'Why DM only?',
          value: 'Authorization codes are sensitive and should never be shared in public channels.',
          inline: false,
        },
        {
          name: 'What to do',
          value:
            '1. Open a DM with this bot\n2. Run the auth code command there\n3. Your message with the code has been deleted for security',
          inline: false,
        },
      ],
      footer: {
        text: 'Your security is our priority',
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [securityWarningEmbed] });
  }

  // Check if the code is wrapped in Discord spoiler tags ||code||
  if (code.startsWith('||') && code.endsWith('||')) {
    code = code.substring(2, code.length - 2);
    logger.info('[AuthCommand] Extracted code from spoiler tags');
  }

  // Note: startTyping is not available in DDD command context
  // The typing indicator would need to be implemented in the adapter layer

  try {
    // Get authentication service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    // Exchange the code for a token using DDD service
    logger.info('[AuthCommand] Exchanging code for token...');
    let tokenResult;
    try {
      tokenResult = await authService.exchangeCodeForToken(context.userId, code);
    } catch (exchangeError) {
      logger.error(`[AuthCommand] Code exchange failed: ${exchangeError.message}`);
      tokenResult = null;
    }

    if (!tokenResult) {
      const authFailedEmbed = {
        title: '❌ Authorization Failed',
        description: 'Unable to validate your authorization code.',
        color: 0xf44336, // Red color
        fields: [
          {
            name: 'Possible reasons',
            value: '• The code is invalid\n• The code has expired\n• The code was already used',
            inline: false,
          },
          {
            name: 'What to do',
            value: `1. Start the auth process again: \`${getCommandPrefix(context)} auth start\`\n2. Make sure to copy the code exactly\n3. Submit the code promptly (codes expire quickly)`,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [authFailedEmbed] });
    }

    // Token was successfully exchanged and stored by the DDD service
    logger.info(`[AuthCommand] Token successfully stored for user ${context.userId}`);

    const successEmbed = {
      title: '✅ Authorization Successful!',
      description: 'Your account has been successfully linked.',
      color: 0x4caf50, // Green color
      fields: [
        {
          name: 'What happens now?',
          value: 'The bot will use your personal AI account for all your interactions.',
          inline: false,
        },
        {
          name: 'Benefits',
          value:
            '• Personalized AI responses\n• Your own usage limits\n• Private conversation history',
          inline: false,
        },
        {
          name: 'Need help?',
          value: `• Check your status: \`${getCommandPrefix(context)} auth status\`\n• Revoke access: \`${getCommandPrefix(context)} auth revoke\``,
          inline: false,
        },
      ],
      footer: {
        text: 'Thank you for authenticating!',
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[AuthCommand] Error during auth code exchange: ${error.message}`);
    const errorEmbed = {
      title: '❌ Authorization Error',
      description: 'An unexpected error occurred during the authorization process.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error',
          inline: false,
        },
        {
          name: 'What to do',
          value: `• Wait a few minutes and try again\n• Start fresh with \`${getCommandPrefix(context)} auth start\`\n• Contact support if the issue persists`,
          inline: false,
        },
      ],
      footer: {
        text: `Error ID: ${Date.now()}`,
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle auth status subcommand
 */
async function handleStatus(context) {
  try {
    // Get authentication service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    // Check authentication status using DDD service
    const authStatus = await authService.getAuthenticationStatus(context.userId);

    if (authStatus.isAuthenticated) {
      const fields = [
        {
          name: 'Status',
          value: '✅ Authorized',
          inline: true,
        },
        {
          name: 'AI Service',
          value: 'Using your personal account',
          inline: true,
        },
      ];

      const statusEmbed = {
        title: '🔐 Authentication Status',
        description:
          'Your authorization is active. The bot is using your personal AI account for all interactions.',
        color: 0x4caf50, // Green color
        fields: fields,
        footer: {
          text: 'Your authentication is active',
        },
        timestamp: new Date().toISOString(),
      };

      return await context.respond({ embeds: [statusEmbed] });
    } else {
      const notAuthorizedEmbed = {
        title: '❌ Not Authorized',
        description: "You don't have an active authorization token.",
        color: 0xf44336, // Red color
        fields: [
          {
            name: 'What does this mean?',
            value: 'The bot is using the shared AI service instead of your personal account.',
            inline: false,
          },
          {
            name: 'Get started',
            value: `Use \`${getCommandPrefix(context)} auth start\` to begin the authorization process.`,
            inline: false,
          },
          {
            name: 'Benefits of authorizing',
            value:
              '• Personal AI responses\n• Your own usage limits\n• Private conversation history',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      return await context.respond({ embeds: [notAuthorizedEmbed] });
    }
  } catch (error) {
    logger.error(`[AuthCommand] Error checking authentication status: ${error.message}`);

    const errorEmbed = {
      title: '❌ Status Check Failed',
      description: 'Unable to check your authentication status.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error occurred',
          inline: false,
        },
        {
          name: 'What to do',
          value: '• Try again in a moment\n• Contact support if the issue persists',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle auth revoke subcommand
 */
async function handleRevoke(context) {
  try {
    // Get authentication service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    // Revoke user's authentication using DDD service
    await authService.revokeAuthentication(context.userId);

    // Authentication was successfully revoked
    const successEmbed = {
      title: '✅ Authorization Revoked',
      description: 'Your authorization has been successfully revoked.',
      color: 0x4caf50, // Green color
      fields: [
        {
          name: 'What happened?',
          value: 'Your personal AI account has been disconnected from the bot.',
          inline: false,
        },
        {
          name: 'What now?',
          value: 'The bot will use the shared AI service for your interactions.',
          inline: false,
        },
        {
          name: 'Want to re-authorize?',
          value: `Use \`${getCommandPrefix(context)} auth start\` to connect your account again.`,
          inline: false,
        },
      ],
      footer: {
        text: 'Your token has been securely deleted',
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[AuthCommand] Error revoking authentication: ${error.message}`);

    const errorEmbed = {
      title: '❌ Revocation Failed',
      description: 'Unable to revoke your authorization.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error occurred',
          inline: false,
        },
        {
          name: 'What to do',
          value: `• Check your status: \`${getCommandPrefix(context)} auth status\`\n• Try again in a moment\n• Contact support if the issue persists`,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle auth cleanup subcommand (admin only)
 */
async function handleCleanup(context) {
  // Check if the user is an admin or bot owner
  const isAdmin = await context.hasPermission('Administrator');
  const isBotOwner = context.userId === process.env.BOT_OWNER_ID;

  if (!isAdmin && !isBotOwner) {
    const permissionEmbed = {
      title: '❌ Permission Denied',
      description: 'This command requires administrator permissions.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Required permissions',
          value: 'Server Administrator or Bot Owner',
          inline: true,
        },
        {
          name: 'Your role',
          value: 'Regular User',
          inline: true,
        },
        {
          name: 'Why is this restricted?',
          value: 'Token cleanup affects all users and should only be performed by administrators.',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [permissionEmbed] });
  }

  try {
    // Get authentication service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    // Run the cleanup using DDD service
    const removedTokens = await authService.cleanupExpiredTokens();
    const removedCount = removedTokens.length;

    if (removedCount > 0) {
      const successEmbed = {
        title: '✅ Cleanup Complete',
        description: `Successfully removed ${removedCount} expired token${removedCount === 1 ? '' : 's'}.`,
        color: 0x4caf50, // Green color
        fields: [
          {
            name: 'Tokens removed',
            value: removedCount.toString(),
            inline: true,
          },
          {
            name: 'Status',
            value: 'Complete',
            inline: true,
          },
          {
            name: 'What was cleaned?',
            value: 'Expired authentication tokens that were no longer valid.',
            inline: false,
          },
          {
            name: 'Impact',
            value: 'Affected users will need to re-authenticate when they next use the bot.',
            inline: false,
          },
        ],
        footer: {
          text: 'Cleanup performed by administrator',
        },
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [successEmbed] });
    } else {
      const noTokensEmbed = {
        title: '✅ Cleanup Complete',
        description: 'No expired tokens were found.',
        color: 0x2196f3, // Blue color
        fields: [
          {
            name: 'Tokens removed',
            value: '0',
            inline: true,
          },
          {
            name: 'Status',
            value: 'Nothing to clean',
            inline: true,
          },
          {
            name: 'System status',
            value: 'All stored tokens are currently valid.',
            inline: false,
          },
        ],
        footer: {
          text: 'System is clean',
        },
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [noTokensEmbed] });
    }
  } catch (error) {
    logger.error(`[AuthCommand] Error during manual cleanup: ${error.message}`);
    const errorEmbed = {
      title: '❌ Cleanup Failed',
      description: 'An error occurred during the cleanup process.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error',
          inline: false,
        },
        {
          name: 'What to do',
          value:
            '• Check the bot logs for more details\n• Try again in a moment\n• Contact the bot developer if the issue persists',
          inline: false,
        },
      ],
      footer: {
        text: `Error ID: ${Date.now()}`,
      },
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

module.exports = {
  createAuthCommand,
};
