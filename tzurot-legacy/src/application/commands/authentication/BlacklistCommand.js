/**
 * BlacklistCommand - Manages user blacklisting/unblacklisting
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/authentication/BlacklistCommand
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
 * Factory function to create a BlacklistCommand instance
 * @returns {Command} Configured blacklist command
 */
function createBlacklistCommand(dependencies = {}) {
  return new Command({
    name: 'blacklist',
    description: 'Globally blacklist or unblacklist users from using the bot',
    category: 'Authentication',
    aliases: ['bl'],
    options: [
      new CommandOption({
        name: 'action',
        description: 'Blacklist action to perform',
        type: 'string',
        required: true,
        choices: [
          { name: 'add', value: 'add' },
          { name: 'remove', value: 'remove' },
          { name: 'list', value: 'list' },
          { name: 'check', value: 'check' },
        ],
      }),
      new CommandOption({
        name: 'user',
        description: 'User to blacklist/unblacklist (mention or user ID)',
        type: 'user',
        required: false,
      }),
      new CommandOption({
        name: 'reason',
        description: 'Reason for blacklisting',
        type: 'string',
        required: false,
      }),
    ],
    examples: [
      { command: 'blacklist add @user Spamming', description: 'Blacklist a user with reason' },
      { command: 'blacklist remove @user', description: 'Remove a user from blacklist' },
      { command: 'blacklist list', description: 'List all blacklisted users' },
      { command: 'blacklist check @user', description: 'Check if a user is blacklisted' },
    ],
    execute: createExecutor(dependencies),
  });
}

/**
 * Create the command executor function
 */
function createExecutor(_dependencies) {
  return async function execute(context) {
    const { args, options } = context;

    logger.info(`[BlacklistCommand] Executing for user ${context.userId}`);

    try {
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
              value:
                'Blacklisting affects user authentication and should only be managed by administrators.',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [permissionEmbed] });
      }

      // Get action from options or args
      const action = options.action || args[0]?.toLowerCase();

      // If no action specified, show help
      if (!action) {
        return await showHelp(context);
      }

      // Handle the various subcommands
      switch (action) {
        case 'add':
          return await handleAdd(context, options, args);
        case 'remove':
          return await handleRemove(context, options, args);
        case 'list':
          return await handleList(context);
        case 'check':
          return await handleCheck(context, options, args);
        default: {
          const unknownActionEmbed = {
            title: '❌ Unknown Blacklist Command',
            description: `"${action}" is not a valid blacklist subcommand.`,
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'Available subcommands',
                value: 'add, remove, list, check',
                inline: false,
              },
              {
                name: 'Get help',
                value: `Use \`${getCommandPrefix(context)} blacklist\` to see detailed help`,
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [unknownActionEmbed] });
        }
      }
    } catch (error) {
      logger.error('[BlacklistCommand] Unexpected error:', error);
      const errorEmbed = {
        title: '❌ Blacklist Error',
        description: 'An unexpected error occurred while processing your blacklist request.',
        color: 0xf44336, // Red color
        fields: [
          {
            name: 'Error details',
            value: error.message || 'Unknown error',
            inline: false,
          },
          {
            name: 'What to do',
            value: '• Try again in a moment\n• Contact support if the issue persists',
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
 * Show blacklist help
 */
async function showHelp(context) {
  const commandPrefix = getCommandPrefix(context);

  const helpEmbed = {
    title: '🚫 Global Blacklist Management',
    description: 'Manage global user blacklist - blocks ALL bot interactions',
    color: 0x2196f3, // Blue color
    fields: [
      {
        name: 'Available Commands',
        value:
          `• \`${commandPrefix} blacklist add @user [reason]\` - Blacklist a user\n` +
          `• \`${commandPrefix} blacklist remove @user\` - Remove from blacklist\n` +
          `• \`${commandPrefix} blacklist list\` - Show all blacklisted users\n` +
          `• \`${commandPrefix} blacklist check @user\` - Check blacklist status`,
        inline: false,
      },
      {
        name: '⚠️ Important Notes',
        value:
          '• Blacklisted users cannot use ANY bot commands\n' +
          '• All messages from blacklisted users are ignored\n' +
          '• Only administrators can manage the blacklist',
        inline: false,
      },
      {
        name: 'Examples',
        value:
          `\`${commandPrefix} blacklist add @user Abusing API\`\n` +
          `\`${commandPrefix} blacklist remove 123456789\``,
        inline: false,
      },
    ],
    footer: {
      text: 'Admin/Owner only command',
    },
    timestamp: new Date().toISOString(),
  };

  return await context.respond({ embeds: [helpEmbed] });
}

/**
 * Handle blacklist add subcommand
 */
async function handleAdd(context, options, args) {
  // Extract user from options or args
  let targetUser = options.user;
  let reason = options.reason;

  // If not in options, try to parse from args
  if (!targetUser && args.length > 1) {
    // Try to extract user mention or ID from args[1]
    const userArg = args[1];
    // Extract user ID from mention format <@123456789> or just use as ID
    const userId = userArg.replace(/[<@!>]/g, '');
    if (/^\d+$/.test(userId)) {
      targetUser = userId;
    }

    // Get reason from remaining args
    if (!reason && args.length > 2) {
      reason = args.slice(2).join(' ');
    }
  }

  if (!targetUser) {
    const missingUserEmbed = {
      title: '❌ User Required',
      description: 'Please specify a user to blacklist.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Usage',
          value: `\`${getCommandPrefix(context)} blacklist add @user [reason]\``,
          inline: false,
        },
        {
          name: 'Examples',
          value:
            `\`${getCommandPrefix(context)} blacklist add @john Spamming\`\n` +
            `\`${getCommandPrefix(context)} blacklist add 123456789 API abuse\``,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [missingUserEmbed] });
  }

  // Extract user ID if it's an object
  const userId = typeof targetUser === 'object' ? targetUser.id : targetUser;

  // Default reason if not provided
  if (!reason) {
    reason = 'No reason provided';
  }

  try {
    // Get blacklist service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const blacklistService = bootstrap.getBlacklistService();

    // Check if user is already blacklisted
    const isAlreadyBlacklisted = await blacklistService.isUserBlacklisted(userId);
    if (isAlreadyBlacklisted) {
      const blacklistDetails = await blacklistService.getBlacklistDetails(userId);
      const alreadyBlacklistedEmbed = {
        title: '⚠️ Already Blacklisted',
        description: `User <@${userId}> is already blacklisted.`,
        color: 0xff9800, // Orange color
        fields: [
          {
            name: 'Current Reason',
            value: blacklistDetails?.reason || 'No reason recorded',
            inline: false,
          },
          {
            name: 'What to do',
            value: `To update the reason, remove and re-add the user with:\n\`${getCommandPrefix(context)} blacklist remove @user\`\n\`${getCommandPrefix(context)} blacklist add @user New reason\``,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [alreadyBlacklistedEmbed] });
    }

    // Blacklist the user
    await blacklistService.blacklistUser(userId, reason, context.userId);

    logger.info(
      `[BlacklistCommand] User ${userId} blacklisted by ${context.userId} - Reason: ${reason}`
    );

    const successEmbed = {
      title: '✅ User Blacklisted',
      description: `Successfully blacklisted <@${userId}>`,
      color: 0x4caf50, // Green color
      fields: [
        {
          name: 'User',
          value: `<@${userId}>`,
          inline: true,
        },
        {
          name: 'Reason',
          value: reason,
          inline: true,
        },
        {
          name: 'Effects',
          value:
            '• Cannot use any bot commands\n' +
            '• All messages are ignored silently\n' +
            '• Cannot interact with personalities',
          inline: false,
        },
        {
          name: 'Added by',
          value: `<@${context.userId}>`,
          inline: true,
        },
        {
          name: 'Date',
          value: new Date().toLocaleDateString(),
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[BlacklistCommand] Error blacklisting user ${userId}:`, error);
    const errorEmbed = {
      title: '❌ Blacklist Failed',
      description: 'Unable to blacklist the user.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error occurred',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle blacklist remove subcommand
 */
async function handleRemove(context, options, args) {
  // Extract user from options or args
  let targetUser = options.user;

  // If not in options, try to parse from args
  if (!targetUser && args.length > 1) {
    // Try to extract user mention or ID from args[1]
    const userArg = args[1];
    // Extract user ID from mention format <@123456789> or just use as ID
    const userId = userArg.replace(/[<@!>]/g, '');
    if (/^\d+$/.test(userId)) {
      targetUser = userId;
    }
  }

  if (!targetUser) {
    const missingUserEmbed = {
      title: '❌ User Required',
      description: 'Please specify a user to unblacklist.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Usage',
          value: `\`${getCommandPrefix(context)} blacklist remove @user\``,
          inline: false,
        },
        {
          name: 'Examples',
          value:
            `\`${getCommandPrefix(context)} blacklist remove @john\`\n` +
            `\`${getCommandPrefix(context)} blacklist remove 123456789\``,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [missingUserEmbed] });
  }

  // Extract user ID if it's an object
  const userId = typeof targetUser === 'object' ? targetUser.id : targetUser;

  try {
    // Get blacklist service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const blacklistService = bootstrap.getBlacklistService();

    // Check if user is blacklisted
    const blacklistDetails = await blacklistService.getBlacklistDetails(userId);
    if (!blacklistDetails) {
      const notBlacklistedEmbed = {
        title: '⚠️ Not Blacklisted',
        description: `User <@${userId}> is not currently blacklisted.`,
        color: 0xff9800, // Orange color
        fields: [
          {
            name: 'Current Status',
            value: '✅ Can use bot normally',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [notBlacklistedEmbed] });
    }

    // Unblacklist the user
    await blacklistService.unblacklistUser(userId, context.userId);

    logger.info(`[BlacklistCommand] User ${userId} unblacklisted by ${context.userId}`);

    const successEmbed = {
      title: '✅ User Unblacklisted',
      description: `Successfully removed <@${userId}> from blacklist`,
      color: 0x4caf50, // Green color
      fields: [
        {
          name: 'User',
          value: `<@${userId}>`,
          inline: true,
        },
        {
          name: 'Previous Reason',
          value: blacklistDetails.reason || 'No reason recorded',
          inline: true,
        },
        {
          name: 'Effects',
          value:
            '• Can now use all bot commands\n' +
            '• Can interact with personalities\n' +
            '• Will need to authenticate for NSFW content',
          inline: false,
        },
        {
          name: 'Removed by',
          value: `<@${context.userId}>`,
          inline: true,
        },
        {
          name: 'Date',
          value: new Date().toLocaleDateString(),
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[BlacklistCommand] Error unblacklisting user ${userId}:`, error);
    const errorEmbed = {
      title: '❌ Unblacklist Failed',
      description: 'Unable to remove the user from blacklist.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error occurred',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle blacklist list subcommand
 */
async function handleList(context) {
  try {
    // Get blacklist service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const blacklistService = bootstrap.getBlacklistService();

    // Get all blacklisted users
    const blacklistedUsers = await blacklistService.getBlacklistedUsers();

    if (blacklistedUsers.length === 0) {
      const emptyListEmbed = {
        title: '📋 Blacklist Empty',
        description: 'No users are currently blacklisted.',
        color: 0x2196f3, // Blue color
        fields: [
          {
            name: 'Info',
            value: 'The blacklist is currently empty. All users can authenticate normally.',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [emptyListEmbed] });
    }

    // Format the blacklist
    const userList = blacklistedUsers.map((user, index) => {
      const reason = user.reason || 'No reason provided';
      const userId = user.userId.toString ? user.userId.toString() : user.userId;
      return `**${index + 1}.** <@${userId}>\n   Reason: ${reason}`;
    });

    // Split into multiple embeds if too many users
    const maxPerEmbed = 10;
    const embeds = [];

    for (let i = 0; i < userList.length; i += maxPerEmbed) {
      const chunk = userList.slice(i, i + maxPerEmbed);
      const isFirstEmbed = i === 0;
      const isLastEmbed = i + maxPerEmbed >= userList.length;

      const embed = {
        title: isFirstEmbed ? '🚫 Blacklisted Users' : undefined,
        description: chunk.join('\n\n'),
        color: 0xf44336, // Red color
        footer: isLastEmbed
          ? {
              text: `Total: ${blacklistedUsers.length} blacklisted user${blacklistedUsers.length === 1 ? '' : 's'}`,
            }
          : undefined,
        timestamp: isLastEmbed ? new Date().toISOString() : undefined,
      };

      embeds.push(embed);
    }

    return await context.respond({ embeds });
  } catch (error) {
    logger.error('[BlacklistCommand] Error listing blacklisted users:', error);
    const errorEmbed = {
      title: '❌ List Failed',
      description: 'Unable to retrieve the blacklist.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error occurred',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Handle blacklist check subcommand
 */
async function handleCheck(context, options, args) {
  // Extract user from options or args
  let targetUser = options.user;

  // If not in options, try to parse from args
  if (!targetUser && args.length > 1) {
    // Try to extract user mention or ID from args[1]
    const userArg = args[1];
    // Extract user ID from mention format <@123456789> or just use as ID
    const userId = userArg.replace(/[<@!>]/g, '');
    if (/^\d+$/.test(userId)) {
      targetUser = userId;
    }
  }

  if (!targetUser) {
    const missingUserEmbed = {
      title: '❌ User Required',
      description: 'Please specify a user to check.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Usage',
          value: `\`${getCommandPrefix(context)} blacklist check @user\``,
          inline: false,
        },
        {
          name: 'Examples',
          value:
            `\`${getCommandPrefix(context)} blacklist check @john\`\n` +
            `\`${getCommandPrefix(context)} blacklist check 123456789\``,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [missingUserEmbed] });
  }

  // Extract user ID if it's an object
  const userId = typeof targetUser === 'object' ? targetUser.id : targetUser;

  try {
    // Get blacklist service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const blacklistService = bootstrap.getBlacklistService();

    // Check user blacklist status
    const blacklistDetails = await blacklistService.getBlacklistDetails(userId);

    if (blacklistDetails) {
      const blacklistedEmbed = {
        title: '🚫 User is Blacklisted',
        description: `<@${userId}> is currently blacklisted.`,
        color: 0xf44336, // Red color
        fields: [
          {
            name: 'User',
            value: `<@${userId}>`,
            inline: true,
          },
          {
            name: 'Status',
            value: '🚫 Blacklisted',
            inline: true,
          },
          {
            name: 'Reason',
            value: blacklistDetails.reason || 'No reason provided',
            inline: false,
          },
          {
            name: 'Effects',
            value: 'This user cannot use any bot commands or interact with personalities.',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [blacklistedEmbed] });
    } else {
      const notBlacklistedEmbed = {
        title: '✅ User Not Blacklisted',
        description: `<@${userId}> is not blacklisted.`,
        color: 0x4caf50, // Green color
        fields: [
          {
            name: 'User',
            value: `<@${userId}>`,
            inline: true,
          },
          {
            name: 'Status',
            value: '✅ Not blacklisted',
            inline: true,
          },
          {
            name: 'Bot Access',
            value: '✅ Can use all bot features',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [notBlacklistedEmbed] });
    }
  } catch (error) {
    logger.error(`[BlacklistCommand] Error checking user ${userId}:`, error);
    const errorEmbed = {
      title: '❌ Check Failed',
      description: 'Unable to check blacklist status.',
      color: 0xf44336, // Red color
      fields: [
        {
          name: 'Error details',
          value: error.message || 'Unknown error occurred',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return await context.respond({ embeds: [errorEmbed] });
  }
}

module.exports = {
  createBlacklistCommand,
};
