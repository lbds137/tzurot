/**
 * Reset conversation command - Platform-agnostic implementation
 * @module application/commands/conversation/ResetCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the reset conversation command
 */
function createResetCommand() {
  return new Command({
    name: 'reset',
    description: 'Reset your conversation with a personality',
    category: 'conversation',
    aliases: [],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'personality',
        description: 'The name or alias of the personality',
        type: 'string',
        required: true,
      }),
    ],
    execute: async context => {
      try {
        // Extract dependencies
        const personalityService = context.dependencies.personalityApplicationService;
        const conversationManager = context.dependencies.conversationManager;
        const featureFlags = context.dependencies.featureFlags;

        if (!personalityService) {
          throw new Error('PersonalityApplicationService not available');
        }

        if (!conversationManager) {
          throw new Error('ConversationManager not available');
        }

        // Get personality name from arguments
        let personalityNameOrAlias;

        if (context.isSlashCommand) {
          // Slash command - options are named
          personalityNameOrAlias = context.options.personality;
        } else {
          // Text command - parse positional arguments
          if (context.args.length < 1) {
            const botPrefix = context.dependencies.botPrefix || '!tz';
            return await context.respond(
              `You need to provide a personality name or alias. Usage: \`${botPrefix} reset <personality>\``
            );
          }

          personalityNameOrAlias = context.args[0].toLowerCase();
        }

        // Validate input
        if (!personalityNameOrAlias || personalityNameOrAlias.length === 0) {
          return await context.respond('Please provide a personality name or alias.');
        }

        // Check if using new system for personality lookup
        const useNewSystem = featureFlags?.isEnabled('ddd.personality.read');

        logger.info(
          `[ResetCommand] Resetting conversation with "${personalityNameOrAlias}" for user ${context.getUserId()} using ${useNewSystem ? 'new' : 'legacy'} system`
        );

        try {
          // Get the personality using the application service
          const personality = await personalityService.getPersonality(personalityNameOrAlias);

          if (!personality) {
            return await context.respond(
              `Personality "${personalityNameOrAlias}" not found. Please check the name or alias and try again.`
            );
          }

          // Clear the conversation for this personality in this channel
          // Note: This uses the legacy conversation system for now
          // In the future, this will use ConversationApplicationService
          const cleared = conversationManager.clearConversation(
            context.getUserId(),
            context.getChannelId(),
            personality.profile.name
          );

          if (!cleared) {
            return await context.respond(
              `No active conversation found with **${personality.profile.displayName || personality.profile.name}** in this channel.`
            );
          }

          // Create response message
          const displayName = personality.profile.displayName || personality.profile.name;
          let response = `✅ Conversation with **${displayName}** has been reset in this channel.`;

          if (useNewSystem) {
            response += '\n*(Using new DDD system for personality lookup)*';
          }

          return await context.respond(response);
        } catch (error) {
          logger.error('[ResetCommand] Error resetting conversation:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[ResetCommand] Error:', error);

        return await context.respond(
          '❌ An error occurred while resetting the conversation. ' +
            'Please try again later or contact support if the issue persists.'
        );
      }
    },
  });
}

module.exports = { createResetCommand };
