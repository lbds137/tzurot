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
            const botPrefix = context.commandPrefix || '!tz';
            const emptyEmbed = {
              title: '📋 No Personalities Yet',
              description: "You haven't added any personalities.",
              color: 0xff9800, // Orange color
              fields: [
                {
                  name: 'Get Started',
                  value: `Use \`${botPrefix} add <personality-name>\` to create your first personality!`,
                  inline: false,
                },
                {
                  name: 'Example',
                  value: `\`${botPrefix} add Claude "You are Claude, a helpful AI assistant"\``,
                  inline: false,
                },
              ],
              footer: {
                text: 'Personalities allow you to create custom AI assistants',
              },
            };
            return await context.respond({ embeds: [emptyEmbed] });
          }

          // Pagination logic
          const pageSize = 10;
          const totalPages = Math.ceil(personalities.length / pageSize);

          // Validate page number
          if (page < 1 || page > totalPages) {
            const pageErrorEmbed = {
              title: '❌ Invalid Page Number',
              description: 'The page number you specified is out of range.',
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'Valid Range',
                  value: `Pages 1 to ${totalPages}`,
                  inline: true,
                },
                {
                  name: 'You Entered',
                  value: page.toString(),
                  inline: true,
                },
                {
                  name: 'Total Personalities',
                  value: personalities.length.toString(),
                  inline: true,
                },
              ],
            };
            return await context.respond({ embeds: [pageErrorEmbed] });
          }

          // Calculate slice indices
          const startIdx = (page - 1) * pageSize;
          const endIdx = Math.min(startIdx + pageSize, personalities.length);
          const pagePersonalities = personalities.slice(startIdx, endIdx);

          // Build the embed fields
          const fields = pagePersonalities.map((personality, index) => {
            const displayName = personality.profile.displayName || personality.profile.name;
            const aliases =
              personality.aliases && personality.aliases.length > 0
                ? personality.aliases.map(a => a.value || a.alias).join(', ')
                : 'None';

            return {
              name: `${startIdx + index + 1}. ${displayName}`,
              value: `**Name:** \`${personality.profile.name}\`\n**Aliases:** ${aliases}`,
              inline: false,
            };
          });


          // Create the list embed
          const embedData = {
            title: `📋 Your Personalities`,
            description: `Showing ${pagePersonalities.length} of ${personalities.length} personalities`,
            color: 0x2196f3, // Blue color
            fields: fields,
            footer: {
              text: `Page ${page} of ${totalPages}`,
            },
            timestamp: new Date().toISOString(),
          };

          // Add navigation help if multiple pages
          if (totalPages > 1) {
            const botPrefix = context.commandPrefix || '!tz';
            embedData.fields.push({
              name: 'Navigation',
              value: `Use \`${botPrefix} list <page>\` to view other pages`,
              inline: false,
            });
          }

          return await context.respond({ embeds: [embedData] });
        } catch (error) {
          logger.error('[ListCommand] Error listing personalities:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[ListCommand] Error:', error);

        const genericErrorEmbed = {
          title: '❌ Something Went Wrong',
          description: 'An error occurred while listing personalities.',
          color: 0xf44336, // Red color
          fields: [
            {
              name: 'What happened',
              value: error.message || 'Unknown error',
              inline: false,
            },
            {
              name: 'What to do',
              value:
                '• Try again in a moment\n• Use the command without a page number\n• Contact support if the issue persists',
              inline: false,
            },
          ],
          footer: {
            text: `Error ID: ${Date.now()}`,
          },
          timestamp: new Date().toISOString(),
        };

        return await context.respond({ embeds: [genericErrorEmbed] });
      }
    },
  });
}

module.exports = { createListCommand };
