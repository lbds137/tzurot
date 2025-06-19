/**
 * Info personality command - Platform-agnostic implementation
 * @module application/commands/personality/InfoCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the info personality command
 */
function createInfoCommand() {
  return new Command({
    name: 'info',
    description: 'Display detailed information about a personality',
    category: 'personality',
    aliases: [],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'name',
        description: 'The name or alias of the personality',
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

        // Get personality name from arguments
        let personalityNameOrAlias;

        if (context.isSlashCommand) {
          // Slash command - options are named
          personalityNameOrAlias = context.options.name;
        } else {
          // Text command - parse positional arguments
          if (context.args.length < 1) {
            return await context.respond(
              'You need to provide a personality name or alias. Usage: `!tz info <name>`'
            );
          }

          personalityNameOrAlias = context.args[0].toLowerCase();
        }

        // Validate input
        if (!personalityNameOrAlias || personalityNameOrAlias.length === 0) {
          return await context.respond('Please provide a personality name or alias.');
        }

        // Check if using new system
        const useNewSystem = featureFlags?.isEnabled('ddd.personality.read');

        logger.info(
          `[InfoCommand] Getting info for "${personalityNameOrAlias}" for user ${context.getUserId()} using ${useNewSystem ? 'new' : 'legacy'} system`
        );

        try {
          // Get the personality
          const personality = await personalityService.getPersonality(personalityNameOrAlias);

          if (!personality) {
            return await context.respond(
              `Personality "${personalityNameOrAlias}" not found. Please check the name or alias and try again.`
            );
          }

          // Create embed fields
          const fields = [
            { name: 'Full Name', value: personality.profile.name, inline: true },
            {
              name: 'Display Name',
              value: personality.profile.displayName || 'Not set',
              inline: true,
            },
          ];

          // Add user's aliases (in new system, aliases are global not per-user)
          if (personality.aliases && personality.aliases.length > 0) {
            fields.push({
              name: 'Aliases',
              value: personality.aliases.map(a => a.value || a.alias).join(', '),
              inline: true,
            });
          } else {
            fields.push({
              name: 'Aliases',
              value: 'None set',
              inline: true,
            });
          }

          // Add owner information if available
          if (personality.profile.owner) {
            fields.push({
              name: 'Created By',
              value: `<@${personality.profile.owner.value || personality.profile.owner}>`,
              inline: true,
            });
          }

          // Add status field
          fields.push({
            name: 'Status',
            value: '✅ This personality is working normally.',
            inline: false,
          });

          // Add system indicator if using new system
          if (useNewSystem) {
            fields.push({
              name: 'System',
              value: '🆕 Using new DDD system',
              inline: false,
            });
          }

          // Create the response
          const embedData = {
            title: 'Personality Info',
            description: `Information for **${personality.profile.displayName || personality.profile.name}**`,
            color: 0x2196f3,
            fields: fields,
          };

          // Add avatar if available
          if (personality.avatarUrl) {
            embedData.thumbnail = { url: personality.avatarUrl };
          }

          return await context.respond({ embeds: [embedData] });
        } catch (error) {
          logger.error('[InfoCommand] Error getting personality info:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[InfoCommand] Error:', error);

        return await context.respond(
          '❌ An error occurred while getting personality info. ' +
            'Please try again later or contact support if the issue persists.'
        );
      }
    },
  });
}

module.exports = { createInfoCommand };
