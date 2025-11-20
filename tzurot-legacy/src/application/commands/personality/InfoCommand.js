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
            const usageEmbed = {
              title: 'How to Get Personality Info',
              description: 'View detailed information about a personality.',
              color: 0x2196f3, // Blue color
              fields: [
                {
                  name: 'Basic Usage',
                  value: `\`${context.commandPrefix || '!tz'} info <name>\``,
                  inline: false,
                },
                {
                  name: 'Examples',
                  value:
                    `• \`${context.commandPrefix || '!tz'} info Claude\` - View by name\n` +
                    `• \`${context.commandPrefix || '!tz'} info cl\` - View by alias\n` +
                    `• \`${context.commandPrefix || '!tz'} info "My Assistant"\` - View with spaces`,
                  inline: false,
                },
                {
                  name: 'Parameters',
                  value: "• **name**: The personality's name or alias",
                  inline: false,
                },
              ],
              footer: {
                text: 'Shows all details including aliases and owner information',
              },
            };
            return await context.respond({ embeds: [usageEmbed] });
          }

          // Join all arguments to support multi-word aliases
          personalityNameOrAlias = context.args.join(' ').toLowerCase();
        }

        // Validate input
        if (!personalityNameOrAlias || personalityNameOrAlias.length === 0) {
          const errorEmbed = {
            title: '❌ Missing Personality Name',
            description: 'Please provide a personality name or alias.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'What to provide',
                value: '• The personality\'s name (e.g., "Claude")\n• Or an alias (e.g., "cl")',
                inline: false,
              },
            ],
          };
          return await context.respond({ embeds: [errorEmbed] });
        }

        logger.info(
          `[InfoCommand] Getting info for "${personalityNameOrAlias}" for user ${context.getUserId()}`
        );

        try {
          // Get the personality by name or alias first
          const personality = await personalityService.getPersonality(personalityNameOrAlias);

          if (!personality) {
            const notFoundEmbed = {
              title: '❌ Personality Not Found',
              description: `No personality found with the name or alias "${personalityNameOrAlias}".`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'What to check',
                  value:
                    '• Spelling of the personality name\n• Try using the full name instead of alias\n• Use `' +
                    (context.commandPrefix || '!tz') +
                    ' list` command to see available personalities',
                  inline: false,
                },
              ],
              footer: {
                text: 'Personality names are case-insensitive',
              },
            };
            return await context.respond({ embeds: [notFoundEmbed] });
          }

          // Refresh profile data if needed (for external personalities)
          let refreshedPersonality = personality;
          if (personality.profile?.mode === 'external') {
            refreshedPersonality =
              (await personalityService.getPersonalityWithProfile(
                personality.profile.name,
                context.getUserId()
              )) || personality;
          }

          // Create embed fields using the refreshed personality
          const fields = [
            { name: 'Full Name', value: refreshedPersonality.profile.name, inline: true },
            {
              name: 'Display Name',
              value: refreshedPersonality.profile.displayName || 'Not set',
              inline: true,
            },
          ];

          // Add user's aliases (in new system, aliases are global not per-user)
          if (refreshedPersonality.aliases && refreshedPersonality.aliases.length > 0) {
            fields.push({
              name: 'Aliases',
              value: refreshedPersonality.aliases.map(a => a.value || a.alias).join(', '),
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
          if (refreshedPersonality.ownerId) {
            fields.push({
              name: 'Created By',
              value: `<@${refreshedPersonality.ownerId.value || refreshedPersonality.ownerId}>`,
              inline: true,
            });
          }

          // Add status field
          fields.push({
            name: 'Status',
            value: '✅ This personality is working normally.',
            inline: false,
          });


          // Create the response
          const embedData = {
            title: 'Personality Info',
            description: `Information for **${refreshedPersonality.profile.displayName || refreshedPersonality.profile.name}**`,
            color: 0x2196f3,
            fields: fields,
          };

          // Add avatar if available
          if (refreshedPersonality.profile?.avatarUrl) {
            embedData.thumbnail = { url: refreshedPersonality.profile.avatarUrl };
          }

          return await context.respond({ embeds: [embedData] });
        } catch (error) {
          logger.error('[InfoCommand] Error getting personality info:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[InfoCommand] Error:', error);

        const genericErrorEmbed = {
          title: '❌ Something Went Wrong',
          description: 'An error occurred while getting personality info.',
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
                '• Try again in a moment\n• Check the personality name\n• Contact support if the issue persists',
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

module.exports = { createInfoCommand };
