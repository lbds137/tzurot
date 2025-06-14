/**
 * VerifyCommand - Verifies age for NSFW access in Direct Messages
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/authentication/VerifyCommand
 */

const { Command } = require('../CommandAbstraction');
const logger = require('../../../logger');

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
    examples: [
      { command: 'verify', description: 'Verify your age for DM access' }
    ],
    execute: createExecutor(dependencies),
  });
}

/**
 * Create the command executor function
 */
function createExecutor(dependencies) {
  return async function execute(context) {
    const { services } = context;
    const auth = services.auth;
    const channelUtils = services.channelUtils;

    logger.info(`[VerifyCommand] Executing for user ${context.userId}`);

    try {
      // Check if verification system is already complete
      const isAlreadyVerified = auth.isNsfwVerified(context.userId);

      // Check if this is a DM channel
      const isDM = context.isDM;

      // If the command is run in a DM, explain it needs to be run in a server
      if (isDM) {
        return await context.respond(
          '⚠️ **Age Verification Required**\n\n' +
            'This command must be run in a server channel marked as NSFW to verify your age.\n\n' +
            `Please join a server, find a channel marked as NSFW, and run \`${context.commandPrefix}verify\` there. This will verify that you meet Discord's age requirements for NSFW content.\n\n` +
            'This verification is required to use AI personalities in Direct Messages.'
        );
      }

      // Check if the current channel is NSFW (platform-agnostic)
      const isCurrentChannelNSFW = await context.isChannelNSFW();

      if (isAlreadyVerified) {
        return await context.respond(
          '✅ **Already Verified**\n\n' +
            'You are already verified to access AI personalities in Direct Messages. No further action is needed.'
        );
      }

      // If the current channel is NSFW, the user is automatically verified
      if (isCurrentChannelNSFW) {
        // Store the verification status
        const success = await auth.storeNsfwVerification(context.userId, true);

        if (success) {
          return await context.respond(
            '✅ **Verification Successful**\n\n' +
              'You have been successfully verified to use AI personalities in Direct Messages.\n\n' +
              "This verification confirms you meet Discord's age requirements for accessing NSFW content."
          );
        } else {
          return await context.respond(
            '❌ **Verification Error**\n\n' +
              'There was an error storing your verification status. Please try again later.'
          );
        }
      }

      // If not in a NSFW channel, check if the user has access to any NSFW channels in this server
      try {
        // Get guild information through context (platform-agnostic)
        if (!context.guildId) {
          return await context.respond(
            '❌ **Verification Error**\n\n' +
              'Unable to verify server information. Please try again in a server channel.'
          );
        }

        // Find NSFW channels that the user has access to
        const nsfwChannels = await findAccessibleNsfwChannels(context, channelUtils);

        // If the user has access to any NSFW channels, they pass verification
        if (nsfwChannels.length > 0) {
          // Store the verification status
          const success = await auth.storeNsfwVerification(context.userId, true);

          if (success) {
            // Format channel list for Discord
            const channelList = nsfwChannels.map(id => `<#${id}>`).join(', ');

            return await context.respond(
              '✅ **Verification Successful**\n\n' +
                'You have been successfully verified to use AI personalities in Direct Messages.\n\n' +
                "This verification confirms you meet Discord's age requirements for accessing NSFW content.\n\n" +
                `**Available NSFW channels**: ${channelList}\nRun the command in one of these channels next time.`
            );
          } else {
            return await context.respond(
              '❌ **Verification Error**\n\n' +
                'There was an error storing your verification status. Please try again later.'
            );
          }
        } else {
          // The user doesn't have access to any NSFW channels
          return await context.respond(
            '⚠️ **Unable to Verify**\n\n' +
              "You need to run this command in a channel marked as NSFW. This channel is not marked as NSFW, and you don't have access to any NSFW channels in this server.\n\n" +
              'Please try again in a different server with NSFW channels that you can access.'
          );
        }
      } catch (error) {
        logger.error('[VerifyCommand] Error checking NSFW channels:', error);
        return await context.respond(
          '❌ **Verification Error**\n\n' + `An error occurred during verification: ${error.message}`
        );
      }
    } catch (error) {
      logger.error('[VerifyCommand] Unexpected error:', error);
      return await context.respond('❌ An unexpected error occurred. Please try again later.');
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
    if (channel.isTextBased() && 
        channelUtils.isChannelNSFW(channel) &&
        channel.permissionsFor(member).has('ViewChannel')) {
      nsfwChannelIds.push(channelId);
    }
  }

  return nsfwChannelIds;
}

module.exports = {
  createVerifyCommand,
};