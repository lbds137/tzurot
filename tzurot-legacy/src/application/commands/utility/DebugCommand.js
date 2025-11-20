/**
 * Debug Command - Advanced debugging tools for administrators
 *
 * Provides various debugging utilities for clearing caches, resetting states,
 * and gathering system statistics. Admin-only command for troubleshooting.
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Creates the executor function for the debug command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      // Check for admin permissions or bot owner
      const { USER_CONFIG } = require('../../../constants');
      const isBotOwner = context.userId === USER_CONFIG.OWNER_ID;

      if (!context.isAdmin && !isBotOwner) {
        const errorEmbed = {
          title: '❌ Access Denied',
          description: 'This command requires administrator permissions or bot owner status.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        await context.respond({ embeds: [errorEmbed] });
        return;
      }

      const {
        webhookUserTracker = require('../../../utils/webhookUserTracker'),
        conversationManager = require('../../../core/conversation'),
        messageTracker = require('../../../messageTracker').messageTracker,
        nsfwVerificationManager,
      } = context.dependencies || dependencies;

      // NSFW verification manager is no longer needed from authManager - DDD system handles this
      const effectiveNsfwManager = nsfwVerificationManager || null;

      // Get subcommand from args or options
      const subcommand = context.options.subcommand || context.args[0]?.toLowerCase();

      if (!subcommand) {
        return await showHelp(context);
      }

      switch (subcommand) {
        case 'clearwebhooks':
          return await clearWebhooks(context, webhookUserTracker);

        case 'unverify':
          return await unverify(context, effectiveNsfwManager);

        case 'clearconversation':
          return await clearConversation(context, conversationManager);

        case 'clearauth':
          return await clearAuth(context);

        case 'clearmessages':
          return await clearMessages(context, messageTracker);

        case 'stats':
          return await showStats(context, {
            webhookUserTracker,
            messageTracker,
          });

        case 'personality':
          return await checkPersonality(context);

        default: {
          const errorEmbed = {
            title: '❌ Unknown Subcommand',
            description: `Unknown debug subcommand: \`${subcommand}\`.`,
            color: 0xf44336,
            fields: [
              {
                name: 'Help',
                value: `Use \`${context.commandPrefix} debug\` to see available subcommands.`,
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          };
          await context.respond({ embeds: [errorEmbed] });
        }
      }
    } catch (error) {
      logger.error('[DebugCommand] Execution failed:', error);
      const errorEmbed = {
        title: '❌ Command Error',
        description: 'An error occurred while executing the debug command.',
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
    }
  };
}

async function showHelp(context) {
  const helpEmbed = {
    title: '🛠️ Debug Command Help',
    description: `Usage: \`${context.commandPrefix} debug <subcommand>\``,
    color: 0x2196f3,
    fields: [
      {
        name: 'Available Subcommands',
        value: [
          '• `clearwebhooks` - Clear cached webhook identifications',
          '• `unverify` - Clear your NSFW verification status',
          '• `clearconversation` - Clear your conversation history',
          '• `clearauth [userId]` - Revoke authentication tokens (yours or specified user)',
          '• `clearmessages` - Clear message tracking history',
          '• `stats` - Show debug statistics',
          '• `personality <name>` - Check personality data and error message',
        ].join('\n'),
        inline: false,
      },
    ],
    footer: {
      text: 'Administrator permissions required',
    },
    timestamp: new Date().toISOString(),
  };

  await context.respond({ embeds: [helpEmbed] });
}

async function clearWebhooks(context, webhookUserTracker) {
  webhookUserTracker.clearAllCachedWebhooks();
  logger.info(`[Debug] Webhook cache cleared by ${context.getAuthorDisplayName()}`);
  const successEmbed = {
    title: '✅ Webhooks Cleared',
    description: 'Cleared all cached webhook identifications.',
    color: 0x4caf50,
    timestamp: new Date().toISOString(),
  };
  await context.respond({ embeds: [successEmbed] });
}

async function unverify(context, nsfwVerificationManager) {
  if (!nsfwVerificationManager) {
    const errorEmbed = {
      title: '❌ Service Unavailable',
      description: 'NSFW verification service is not available.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
    return;
  }

  const cleared = nsfwVerificationManager.clearVerification(context.userId);

  if (cleared) {
    logger.info(`[Debug] NSFW verification cleared for ${context.getAuthorDisplayName()}`);
    const successEmbed = {
      title: '✅ Verification Cleared',
      description: 'Your NSFW verification has been cleared. You are now unverified.',
      color: 0x4caf50,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [successEmbed] });
  } else {
    const infoEmbed = {
      title: 'ℹ️ No Change',
      description: 'You were not verified, so nothing was cleared.',
      color: 0x2196f3,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [infoEmbed] });
  }
}

async function clearConversation(context, conversationManager) {
  try {
    // Clear conversation for all personalities in current channel
    conversationManager.clearConversation(context.userId, context.channelId);
    logger.info(
      `[Debug] Conversation history cleared for ${context.getAuthorDisplayName()} in channel ${context.channelId}`
    );
    const successEmbed = {
      title: '✅ Conversation Cleared',
      description: 'Cleared your conversation history in this channel.',
      color: 0x4caf50,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[Debug] Error clearing conversation: ${error.message}`);
    const errorEmbed = {
      title: '❌ Clear Failed',
      description: 'Failed to clear conversation history.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
  }
}

async function clearAuth(context) {
  try {
    // Get user ID to clear auth for (defaults to command user)
    const targetUserId = context.args?.[1] || context.userId;

    // Get authentication service from DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;

    logger.info(
      `[Debug] Authentication revocation requested by ${context.getAuthorDisplayName()} for user ${targetUserId}`
    );

    // Revoke user's authentication
    await authService.revokeAuthentication(targetUserId);

    // Also cleanup any expired tokens in the system
    const cleanupResult = await authService.cleanupExpiredTokens();

    const successEmbed = {
      title: '✅ Authentication Revoked',
      description:
        targetUserId === context.userId
          ? 'Your authentication has been revoked. You will need to re-authenticate to interact with personalities.'
          : `Authentication revoked for user <@${targetUserId}>. They will need to re-authenticate to interact with personalities.`,
      fields: [
        {
          name: 'Cleanup Results',
          value: `${cleanupResult.length} expired tokens cleaned up`,
          inline: true,
        },
      ],
      color: 0x4caf50,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[Debug] Error clearing auth: ${error.message}`);
    const errorEmbed = {
      title: '❌ Revocation Failed',
      description: `Failed to revoke authentication: ${error.message}`,
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
  }
}

async function clearMessages(context, messageTracker) {
  try {
    messageTracker.clear();
    logger.info(`[Debug] Message tracking history cleared by ${context.getAuthorDisplayName()}`);
    const successEmbed = {
      title: '✅ Messages Cleared',
      description: 'Cleared message tracking history.',
      color: 0x4caf50,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [successEmbed] });
  } catch (error) {
    logger.error(`[Debug] Error clearing message tracker: ${error.message}`);
    const errorEmbed = {
      title: '❌ Clear Failed',
      description: 'Failed to clear message tracking.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
  }
}

async function checkPersonality(context) {
  try {
    // Get personality name from args
    const personalityName = context.args?.[1];
    
    if (!personalityName) {
      const errorEmbed = {
        title: '❌ Missing Personality Name',
        description: `Usage: \`${context.commandPrefix} debug personality <name>\``,
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
      return;
    }

    // Get personality using DDD system
    const {
      getApplicationBootstrap,
    } = require('../../../application/bootstrap/ApplicationBootstrap');
    const bootstrap = getApplicationBootstrap();
    const personalityService = bootstrap.getPersonalityApplicationService();
    
    const personality = await personalityService.getPersonality(personalityName);
    
    if (!personality) {
      const errorEmbed = {
        title: '❌ Personality Not Found',
        description: `No personality found with name: \`${personalityName}\``,
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
      return;
    }

    // Build debug info
    const debugInfo = {
      name: personality.personalityId?.toString() || 'N/A',
      profileMode: personality.profile?.mode || 'N/A',
      hasProfile: !!personality.profile,
      hasErrorMessage: !!(personality.profile && personality.profile.errorMessage),
      errorMessage: personality.profile?.errorMessage || 'Not set',
      profileType: personality.profile ? personality.profile.constructor.name : 'None',
      prompt: personality.profile?.prompt ? 'Set' : 'Not set',
      modelPath: personality.profile?.modelPath || 'Not set',
    };

    const embed = {
      title: '🔍 Personality Debug Info',
      description: `Debug information for **${personalityName}**`,
      fields: [
        { name: 'Full Name', value: debugInfo.name, inline: true },
        { name: 'Profile Mode', value: debugInfo.profileMode, inline: true },
        { name: 'Has Profile', value: debugInfo.hasProfile ? 'Yes' : 'No', inline: true },
        { name: 'Has Error Message', value: debugInfo.hasErrorMessage ? 'Yes' : 'No', inline: true },
        { name: 'Profile Type', value: debugInfo.profileType, inline: true },
        { name: 'Has Prompt', value: debugInfo.prompt, inline: true },
        { name: 'Model Path', value: debugInfo.modelPath, inline: true },
        { name: 'Error Message', value: `\`\`\`${debugInfo.errorMessage}\`\`\``, inline: false },
      ],
      color: 0x4caf50,
      timestamp: new Date().toISOString(),
    };
    
    await context.respond({ embeds: [embed] });
    
  } catch (error) {
    logger.error(`[Debug] Error checking personality: ${error.message}`);
    const errorEmbed = {
      title: '❌ Check Failed',
      description: `Failed to check personality: ${error.message}`,
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
  }
}

async function showStats(context, dependencies) {
  try {
    const { messageTracker } = dependencies;

    // Check if DDD authentication is available
    let authAvailable = false;
    try {
      const {
        getApplicationBootstrap,
      } = require('../../../application/bootstrap/ApplicationBootstrap');
      const bootstrap = getApplicationBootstrap();
      const authService = bootstrap.getApplicationServices().authenticationService;
      authAvailable = !!authService;
    } catch (_error) {
      // DDD auth not available
    }

    // Gather various statistics
    const stats = {
      webhooks: {
        tracked: 'Not available', // webhookUserTracker doesn't expose a count method
      },
      messages: {
        tracked: messageTracker.size || 0,
      },
      auth: {
        dddSystemAvailable: authAvailable,
      },
    };

    const statsEmbed = {
      title: '📊 Debug Statistics',
      description: 'Current system debug information',
      color: 0x2196f3,
      fields: [
        {
          name: 'Webhooks',
          value: `Tracked: ${stats.webhooks.tracked}`,
          inline: true,
        },
        {
          name: 'Messages',
          value: `Tracked: ${stats.messages.tracked}`,
          inline: true,
        },
        {
          name: 'Authentication',
          value: `Manager: ${stats.auth.hasManager ? '✅' : '❌'}`,
          inline: true,
        },
        {
          name: 'Raw Data',
          value: `\`\`\`json\n${JSON.stringify(stats, null, 2)}\n\`\`\``,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [statsEmbed] });
  } catch (error) {
    logger.error(`[Debug] Error gathering stats: ${error.message}`);
    const errorEmbed = {
      title: '❌ Stats Failed',
      description: 'Failed to gather statistics.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Factory function to create the debug command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The debug command instance
 */
function createDebugCommand(dependencies = {}) {
  const command = new Command({
    name: 'debug',
    description: 'Advanced debugging tools (Requires Administrator permission)',
    category: 'Utility',
    aliases: [],
    permissions: ['ADMIN'],
    options: [
      new CommandOption({
        name: 'subcommand',
        description: 'Debug action to perform',
        type: 'string',
        required: false,
        choices: [
          { name: 'Clear cached webhooks', value: 'clearwebhooks' },
          { name: 'Clear NSFW verification', value: 'unverify' },
          { name: 'Clear conversation history', value: 'clearconversation' },
          { name: 'Revoke authentication tokens', value: 'clearauth' },
          { name: 'Clear message tracking', value: 'clearmessages' },
          { name: 'Show debug statistics', value: 'stats' },
        ],
      }),
    ],
    execute: createExecutor(dependencies),
  });

  // Add adminOnly property for backward compatibility
  command.adminOnly = true;

  return command;
}

module.exports = {
  createDebugCommand,
};
