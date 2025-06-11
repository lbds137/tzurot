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
        required: true
      })
    ],
    execute: async (context) => {
      try {
        // Extract dependencies
        const personalityService = context.dependencies.personalityApplicationService;
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
            return await context.respond(
              'You need to provide a personality name. Usage: `!tz remove <name>`'
            );
          }
          
          personalityName = context.args[0].toLowerCase();
        }

        // Validate input
        if (!personalityName || personalityName.length === 0) {
          return await context.respond('Please provide a personality name to remove.');
        }

        // Check if using new system
        const useNewSystem = featureFlags?.isEnabled('ddd.personality.write');
        
        logger.info(
          `[RemoveCommand] Removing personality "${personalityName}" for user ${context.getUserId()} using ${useNewSystem ? 'new' : 'legacy'} system`
        );

        try {
          // Remove the personality
          const result = await personalityService.removePersonality(personalityName, context.getUserId());
          
          if (result.success) {
            logger.info(`[RemoveCommand] Successfully removed personality "${personalityName}"`);
            
            // Create response message
            const displayName = personalityName;
            let response = `✅ **${displayName}** has been removed from your collection.`;
            
            if (useNewSystem) {
              response += '\n*(Using new DDD system)*';
            }
            
            return await context.respond({
              content: response,
              embeds: [{
                title: 'Personality Removed',
                description: `**${displayName}** has been removed from your collection.`,
                color: 0xf44336
              }]
            });
          } else {
            // Handle specific errors from result
            if (result.message.includes('not found')) {
              return await context.respond(
                `Personality "${personalityName}" not found. Please check the name or alias and try again.`
              );
            }
            
            if (result.message.includes('owner') || result.message.includes('permission')) {
              return await context.respond(
                `You cannot remove a personality that you didn't create.`
              );
            }
            
            if (result.message.includes('Authentication failed')) {
              return await context.respond(
                '❌ Authentication failed. Please make sure you have authenticated with the bot first.\n' +
                'Use `!tz auth` to authenticate.'
              );
            }
            
            // Generic error
            return await context.respond(
              `❌ Failed to remove personality: ${result.message || 'Unknown error'}`
            );
          }
        } catch (error) {
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
    }
  });
}

module.exports = { createRemoveCommand };