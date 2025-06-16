/**
 * Alias command - Platform-agnostic implementation
 * @module application/commands/personality/AliasCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the alias command
 */
function createAliasCommand() {
  return new Command({
    name: 'alias',
    description: 'Add an alias/nickname for an existing personality',
    category: 'personality',
    aliases: [],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'personality',
        description: 'The name or alias of the personality',
        type: 'string',
        required: true,
      }),
      new CommandOption({
        name: 'alias',
        description: 'The new alias to add',
        type: 'string',
        required: true,
      }),
    ],
    execute: async context => {
      try {
        // Extract dependencies
        const personalityService = context.dependencies.personalityApplicationService;
        const featureFlags = context.dependencies.featureFlags;

        if (!personalityService) {
          throw new Error('PersonalityApplicationService not available');
        }

        // Get arguments
        let personalityNameOrAlias, newAlias;

        if (context.isSlashCommand) {
          // Slash command - options are named
          personalityNameOrAlias = context.options.personality;
          newAlias = context.options.alias;
        } else {
          // Text command - parse positional arguments
          if (context.args.length < 2) {
            const botPrefix = context.dependencies.botPrefix || '!tz';
            return await context.respond(
              `You need to provide a personality name and an alias. Usage: \`${botPrefix} alias <personality-name> <new-alias>\``
            );
          }

          personalityNameOrAlias = context.args[0].toLowerCase();
          newAlias = context.args[1].toLowerCase();
        }

        // Validate inputs
        if (!personalityNameOrAlias || personalityNameOrAlias.length === 0) {
          return await context.respond('Please provide a personality name or alias.');
        }

        if (!newAlias || newAlias.length === 0) {
          return await context.respond('Please provide a new alias.');
        }

        // Validate alias format
        if (!/^[a-zA-Z0-9_-]+$/.test(newAlias)) {
          return await context.respond(
            'Aliases can only contain letters, numbers, underscores, and hyphens.'
          );
        }

        logger.info(
          `[AliasCommand] Adding alias "${newAlias}" to personality "${personalityNameOrAlias}"`
        );

        try {
          // Add the alias using the application service
          const result = await personalityService.addAlias(personalityNameOrAlias, newAlias);

          if (!result.success) {
            return await context.respond(result.error || 'Failed to add alias.');
          }

          const personality = result.personality;
          const displayName = personality.profile.displayName || personality.profile.name;

          // Create response with embed if supported
          if (context.canEmbed()) {
            const embed = {
              title: 'Alias Added',
              description: `An alias has been set for **${displayName}**.`,
              color: 0x4caf50,
              fields: [
                { name: 'Full Name', value: personality.profile.name, inline: true },
                { name: 'New Alias', value: newAlias, inline: true },
              ],
            };

            // Add avatar if available
            if (personality.profile.avatarUrl) {
              embed.thumbnail = { url: personality.profile.avatarUrl };
            }

            return await context.respondWithEmbed(embed);
          } else {
            // Plain text response
            const response = `✅ Alias "${newAlias}" has been added to **${displayName}**.`;
            return await context.respond(response);
          }
        } catch (error) {
          logger.error('[AliasCommand] Error adding alias:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[AliasCommand] Error:', error);

        return await context.respond(
          '❌ An error occurred while adding the alias. ' +
            'Please try again later or contact support if the issue persists.'
        );
      }
    },
  });
}

module.exports = { createAliasCommand };
