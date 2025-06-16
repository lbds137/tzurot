/**
 * Remove personality command - Platform-agnostic implementation
 * @module application/commands/personality/RemoveCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the remove personality command
 */
function createRemoveCommand() {
  return new Command({
    name: 'remove',
    description: 'Remove a personality from your collection',
    category: 'personality',
    aliases: ['delete'],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'name',
        description: 'The name or alias of the personality to remove',
        type: 'string',
        required: true,
      }),
    ],
    execute: async context => {
      try {
        // Extract dependencies
        const personalityService = context.dependencies.personalityApplicationService;
        const profileInfoCache = context.dependencies.profileInfoCache;
        const messageTracker = context.dependencies.messageTracker;
        const featureFlags = context.dependencies.featureFlags;

        if (!personalityService) {
          throw new Error('PersonalityApplicationService not available');
        }

        // Get personality name from arguments
        let personalityName;

        if (context.isSlashCommand) {
          // Slash command - options are named
          personalityName = context.options.name;
        } else {
          // Text command - parse positional arguments
          if (context.args.length < 1) {
            const botPrefix = context.dependencies.botPrefix || '!tz';
            return await context.respond(
              `You need to provide a personality name. Usage: \`${botPrefix} remove <name>\``
            );
          }

          personalityName = context.args[0];
        }

        // Normalize the name
        personalityName = personalityName.toLowerCase();

        // Validate input
        if (!personalityName || personalityName.length === 0) {
          return await context.respond('Please provide a personality name to remove.');
        }

        logger.info(
          `[RemoveCommand] Removing personality "${personalityName}" for user ${context.getUserId()}`
        );

        try {
          // First, find the personality to get its details
          const personality = await personalityService.getPersonality(personalityName);

          if (!personality) {
            return await context.respond(
              `Personality "${personalityName}" not found. Please check the name or alias and try again.`
            );
          }

          // Remove the personality
          const command = {
            personalityName: personality.profile.name, // Use the actual name, not alias
            requesterId: context.getUserId(),
          };

          await personalityService.removePersonality(command);

          logger.info(
            `[RemoveCommand] Successfully removed personality "${personality.profile.displayName}"`
          );

          // Clear caches if they're available
          if (profileInfoCache && personality.profile.name) {
            profileInfoCache.deleteFromCache(personality.profile.name);
            logger.info(`[RemoveCommand] Cleared profile cache for: ${personality.profile.name}`);
          }

          // Clear message tracking to allow immediate re-adding
          if (messageTracker && typeof messageTracker.removeCompletedAddCommand === 'function') {
            messageTracker.removeCompletedAddCommand(context.getUserId(), personalityName);
            logger.info(
              `[RemoveCommand] Cleared add command tracking for ${context.getUserId()}-${personalityName}`
            );

            // Also clear with the full name if different
            if (personality.profile.name !== personalityName) {
              messageTracker.removeCompletedAddCommand(
                context.getUserId(),
                personality.profile.name
              );
            }
          }

          // Create response message
          const displayName = personality.profile.displayName || personality.profile.name;
          const response = `✅ **${displayName}** has been removed from your collection.`;

          return await context.respond({
            content: response,
            embeds: [
              {
                title: 'Personality Removed',
                description: `**${displayName}** has been removed from your collection.`,
                color: 0xf44336,
              },
            ],
          });
        } catch (error) {
          // Handle specific errors
          if (error.message.includes('not found')) {
            return await context.respond(
              `Personality "${personalityName}" not found. Please check the name or alias and try again.`
            );
          }

          if (error.message.includes('owner') || error.message.includes('permission')) {
            return await context.respond(`You cannot remove a personality that you didn't create.`);
          }

          if (error.message.includes('Authentication failed')) {
            const botPrefix = context.dependencies.botPrefix || '!tz';
            return await context.respond(
              '❌ Authentication failed. Please make sure you have authenticated with the bot first.\n' +
                `Use \`${botPrefix} auth\` to authenticate.`
            );
          }

          // Handle exceptions
          logger.error('[RemoveCommand] Exception during removal:', error);
          throw error; // Re-throw to be handled by outer catch
        }
      } catch (error) {
        logger.error('[RemoveCommand] Error:', error);

        return await context.respond(
          '❌ An error occurred while removing the personality. ' +
            'Please try again later or contact support if the issue persists.'
        );
      }
    },
  });
}

module.exports = { createRemoveCommand };
