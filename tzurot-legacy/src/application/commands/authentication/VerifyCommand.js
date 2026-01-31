/**
 * VerifyCommand - Verifies age for NSFW access in Direct Messages
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/authentication/VerifyCommand
 */

const { Command } = require('../CommandAbstraction');
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
 * Factory function to create a VerifyCommand instance
 * @returns {Command} Configured verify command
 */
function createVerifyCommand(dependencies = {}) {
  return new Command({
    name: 'verify',
    description: 'Verify your age to use AI personalities in Direct Messages',
    category: 'Authentication',
    aliases: ['nsfw'],
    options: [], // No options needed
    examples: [{ command: 'verify', description: 'Verify your age for DM access' }],
    execute: createExecutor(dependencies),
  });
}

/**
 * Create the command executor function
 */
function createExecutor(_dependencies) {
  return async function execute(context) {
    const { dependencies } = context;
    const channelUtils = dependencies.channelUtils;

    logger.info(`[VerifyCommand] Executing for user ${context.userId}`);

    try {
      // Check if verification system is already complete using DDD authentication
      const authStatus = await dependencies.authenticationService.getAuthenticationStatus(
        context.userId
      );
      const isAlreadyVerified = authStatus.isAuthenticated && authStatus.user?.nsfwStatus?.verified;

      // Check if this is a DM channel
      const isDM = context.isDM();

      // If the command is run in a DM, explain it needs to be run in a server
      if (isDM) {
        const dmErrorEmbed = {
          title: '⚠️ Age Verification Required',
          description:
            'This command must be run in a server channel marked as NSFW to verify your age.',
          color: 0xff9800, // Orange color
          fields: [
            {
              name: 'Why NSFW channel?',
              value:
                "Discord's age verification system uses NSFW channel access to confirm age requirements.",
              inline: false,
            },
            {
              name: 'How to verify',
              value: `1. Join a Discord server\n2. Find an NSFW-marked channel\n3. Run \`${getCommandPrefix(context)} verify\` there`,
              inline: false,
            },
            {
              name: 'What happens after?',
              value: 'Once verified, you can use AI personalities in Direct Messages.',
              inline: false,
            },
          ],
          footer: {
            text: 'This is a one-time verification process',
          },
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [dmErrorEmbed] });
      }

      // Check if the current channel is NSFW (platform-agnostic)
      const isCurrentChannelNSFW = await context.isChannelNSFW();

      if (isAlreadyVerified) {
        const alreadyVerifiedEmbed = {
          title: '✅ Already Verified',
          description: 'You are already verified to access AI personalities in Direct Messages.',
          color: 0x4caf50, // Green color
          fields: [
            {
              name: 'Status',
              value: 'Age verification complete',
              inline: true,
            },
            {
              name: 'DM Access',
              value: 'Enabled',
              inline: true,
            },
            {
              name: 'What now?',
              value: 'You can use any AI personality in Direct Messages without restrictions.',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [alreadyVerifiedEmbed] });
      }

      // If the current channel is NSFW, the user is automatically verified
      if (isCurrentChannelNSFW) {
        // Store the verification status using DDD authentication service
        try {
          await dependencies.authenticationService.verifyNsfwAccess(context.userId);

          const successEmbed = {
            title: '✅ Verification Successful',
            description:
              'You have been successfully verified to use AI personalities in Direct Messages.',
            color: 0x4caf50, // Green color
            fields: [
              {
                name: 'What does this mean?',
                value: "You've confirmed you meet Discord's age requirements for NSFW content.",
                inline: false,
              },
              {
                name: 'DM Access',
                value: 'You can now use all AI personalities in Direct Messages.',
                inline: false,
              },
              {
                name: 'Verification method',
                value: 'NSFW channel access confirmed',
                inline: false,
              },
            ],
            footer: {
              text: 'This verification is permanent',
            },
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [successEmbed] });
        } catch (verifyError) {
          logger.error('[VerifyCommand] Error storing NSFW verification:', verifyError);
          const errorEmbed = {
            title: '❌ Verification Error',
            description: 'There was an error storing your verification status.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'What happened?',
                value: "The verification check passed, but we couldn't save your status.",
                inline: false,
              },
              {
                name: 'What to do',
                value: '• Try the command again\n• Contact support if the issue persists',
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [errorEmbed] });
        }
      }

      // If not in a NSFW channel, check if the user has access to any NSFW channels in this server
      try {
        // Get guild information through context (platform-agnostic)
        if (!context.getGuildId()) {
          const serverErrorEmbed = {
            title: '❌ Verification Error',
            description: 'Unable to verify server information.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'Issue',
                value: 'Cannot access server data from this context.',
                inline: false,
              },
              {
                name: 'Solution',
                value: 'Please try again in a regular server channel (not a thread or forum).',
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [serverErrorEmbed] });
        }

        // Find NSFW channels that the user has access to
        const nsfwChannels = await findAccessibleNsfwChannels(context, channelUtils);

        // If the user has access to any NSFW channels, they pass verification
        if (nsfwChannels.length > 0) {
          // Store the verification status using DDD authentication service
          try {
            await dependencies.authenticationService.verifyNsfwAccess(context.userId);

            // Format channel list for Discord
            const channelList = nsfwChannels
              .slice(0, 5)
              .map(id => `<#${id}>`)
              .join(', ');
            const moreChannels =
              nsfwChannels.length > 5 ? `\n...and ${nsfwChannels.length - 5} more` : '';

            const verifiedEmbed = {
              title: '✅ Verification Successful',
              description:
                'You have been successfully verified to use AI personalities in Direct Messages.',
              color: 0x4caf50, // Green color
              fields: [
                {
                  name: 'Verification confirmed',
                  value: "You meet Discord's age requirements for NSFW content.",
                  inline: false,
                },
                {
                  name: 'NSFW channels you can access',
                  value: channelList + moreChannels,
                  inline: false,
                },
                {
                  name: 'Pro tip',
                  value:
                    'Next time, run this command in one of these NSFW channels for instant verification.',
                  inline: false,
                },
              ],
              footer: {
                text: 'Verification complete',
              },
              timestamp: new Date().toISOString(),
            };
            return await context.respond({ embeds: [verifiedEmbed] });
          } catch (verifyError) {
            logger.error('[VerifyCommand] Error storing NSFW verification:', verifyError);
            const storeErrorEmbed = {
              title: '❌ Verification Error',
              description: 'There was an error storing your verification status.',
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'What happened?',
                  value: "The verification check passed, but we couldn't save your status.",
                  inline: false,
                },
                {
                  name: 'What to do',
                  value: '• Try the command again\n• Contact support if the issue persists',
                  inline: false,
                },
              ],
              timestamp: new Date().toISOString(),
            };
            return await context.respond({ embeds: [storeErrorEmbed] });
          }
        } else {
          // The user doesn't have access to any NSFW channels
          const noAccessEmbed = {
            title: '⚠️ Unable to Verify',
            description: 'Age verification requires access to NSFW channels.',
            color: 0xff9800, // Orange color
            fields: [
              {
                name: 'Current situation',
                value:
                  "• This channel is not marked as NSFW\n• You don't have access to any NSFW channels in this server",
                inline: false,
              },
              {
                name: 'What you need',
                value: 'Access to at least one NSFW-marked channel to verify your age.',
                inline: false,
              },
              {
                name: 'Solutions',
                value:
                  '• Ask a server admin for NSFW channel access\n• Try in a different server where you have NSFW access\n• Join a server with public NSFW channels',
                inline: false,
              },
            ],
            footer: {
              text: 'NSFW access confirms age requirements',
            },
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [noAccessEmbed] });
        }
      } catch (error) {
        logger.error('[VerifyCommand] Error checking NSFW channels:', error);
        const channelErrorEmbed = {
          title: '❌ Verification Error',
          description: 'An error occurred while checking NSFW channel access.',
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
                "• Try again in a moment\n• Make sure you're in a regular server channel\n• Contact support if the issue persists",
              inline: false,
            },
          ],
          footer: {
            text: `Error ID: ${Date.now()}`,
          },
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [channelErrorEmbed] });
      }
    } catch (error) {
      logger.error('[VerifyCommand] Unexpected error:', error);
      const unexpectedErrorEmbed = {
        title: '❌ Unexpected Error',
        description: 'An unexpected error occurred during the verification process.',
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
              '• Try again in a few moments\n• Check your internet connection\n• Contact support if the issue persists',
            inline: false,
          },
        ],
        footer: {
          text: `Error ID: ${Date.now()}`,
        },
        timestamp: new Date().toISOString(),
      };
      return await context.respond({ embeds: [unexpectedErrorEmbed] });
    }
  };
}

/**
 * Find NSFW channels accessible to the user
 * This is a platform-agnostic helper that can be adapted for different platforms
 */
async function findAccessibleNsfwChannels(context, channelUtils) {
  // For Discord, we need to access the guild and check channel permissions
  // This would be different for other platforms
  if (!context.originalMessage?.guild) {
    return [];
  }

  const guild = context.originalMessage.guild;
  const member = context.originalMessage.member;
  const nsfwChannelIds = [];

  // Iterate through guild channels
  for (const [channelId, channel] of guild.channels.cache) {
    if (
      channel.isTextBased() &&
      channelUtils.isChannelNSFW(channel) &&
      channel.permissionsFor(member).has('ViewChannel')
    ) {
      nsfwChannelIds.push(channelId);
    }
  }

  return nsfwChannelIds;
}

module.exports = {
  createVerifyCommand,
};
