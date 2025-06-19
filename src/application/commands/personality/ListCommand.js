/**
 * List command - Platform-agnostic implementation
 * @module application/commands/personality/ListCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the list command
 */
function createListCommand() {
  return new Command({
    name: 'list',
    description: "List all AI personalities you've added",
    category: 'personality',
    aliases: [],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'page',
        description: 'The page number to display',
        type: 'integer',
        required: false,
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

        // Get page number from arguments
        let page = 1;

        if (context.isSlashCommand) {
          // Slash command - options are named
          page = context.options.page || 1;
        } else {
          // Text command - parse positional argument
          if (context.args.length > 0 && !isNaN(context.args[0])) {
            page = parseInt(context.args[0], 10);
          }
        }

        logger.info(
          `[ListCommand] Listing personalities for user ${context.getUserId()} (page ${page})`
        );

        try {
          // Get the user's personalities using the application service
          const personalities = await personalityService.listPersonalitiesByOwner(
            context.getUserId()
          );

          if (!personalities || personalities.length === 0) {
            const botPrefix = context.dependencies.botPrefix || '!tz';
            return await context.respond(
              `You haven't added any personalities yet. Use \`${botPrefix} add <personality-name>\` to add one.`
            );
          }

          // Pagination logic
          const pageSize = 10;
          const totalPages = Math.ceil(personalities.length / pageSize);

          // Validate page number
          if (page < 1 || page > totalPages) {
            return await context.respond(
              `Invalid page number. Please specify a page between 1 and ${totalPages}.`
            );
          }

          // Calculate slice indices
          const startIdx = (page - 1) * pageSize;
          const endIdx = Math.min(startIdx + pageSize, personalities.length);
          const pagePersonalities = personalities.slice(startIdx, endIdx);

          // Create response with embed if supported
          if (context.canEmbed()) {
            // Build the embed
            const fields = pagePersonalities.map((personality, index) => {
              const displayName = personality.profile.displayName || personality.profile.name;
              const aliases =
                personality.aliases && personality.aliases.length > 0
                  ? personality.aliases.map(a => a.value || a.alias).join(', ')
                  : 'None';

              return {
                name: `${startIdx + index + 1}. ${displayName}`,
                value: `Name: \`${personality.profile.name}\`\nAliases: ${aliases}`,
                inline: false,
              };
            });

            const embed = {
              title: `Your Personalities (Page ${page}/${totalPages})`,
              description: `You have added ${personalities.length} ${
                personalities.length === 1 ? 'personality' : 'personalities'
              }.`,
              color: 0x00bcd4,
              fields: fields,
              footer: {
                text: `Page ${page} of ${totalPages}`,
                icon_url: context.getAuthorAvatarUrl(),
              },
              author: {
                name: context.getAuthorDisplayName(),
                icon_url: context.getAuthorAvatarUrl(),
              },
            };

            if (totalPages > 1) {
              const botPrefix = context.dependencies.botPrefix || '!tz';
              embed.description += `\n\nUse \`${botPrefix} list <page>\` to view other pages.`;
            }

            return await context.respondWithEmbed(embed);
          } else {
            // Plain text response
            let response = `**Your Personalities (Page ${page}/${totalPages})**\n`;
            response += `You have added ${personalities.length} ${
              personalities.length === 1 ? 'personality' : 'personalities'
            }.\n\n`;

            pagePersonalities.forEach((personality, index) => {
              const displayName = personality.profile.displayName || personality.profile.name;
              const aliases =
                personality.aliases && personality.aliases.length > 0
                  ? personality.aliases.map(a => a.value || a.alias).join(', ')
                  : 'None';

              response += `**${startIdx + index + 1}. ${displayName}**\n`;
              response += `   Name: \`${personality.profile.name}\`\n`;
              response += `   Aliases: ${aliases}\n\n`;
            });

            if (totalPages > 1) {
              const botPrefix = context.dependencies.botPrefix || '!tz';
              response += `\nUse \`${botPrefix} list <page>\` to view other pages.`;
            }

            return await context.respond(response);
          }
        } catch (error) {
          logger.error('[ListCommand] Error listing personalities:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[ListCommand] Error:', error);

        return await context.respond(
          '❌ An error occurred while listing personalities. ' +
            'Please try again later or contact support if the issue persists.'
        );
      }
    },
  });
}

module.exports = { createListCommand };
