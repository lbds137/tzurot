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
            const botPrefix = context.commandPrefix || '!tz';
            const usageEmbed = {
              title: 'How to Add an Alias',
              description: 'Add a nickname or shortcut for an existing personality.',
              color: 0x2196f3, // Blue color
              fields: [
                {
                  name: 'Basic Usage',
                  value: `\`${botPrefix} alias <personality-name> <new-alias>\``,
                  inline: false,
                },
                {
                  name: 'Examples',
                  value:
                    `• \`${botPrefix} alias Claude cl\` - Add "cl" as alias for Claude\n` +
                    `• \`${botPrefix} alias Assistant helper bot\` - Add "helper bot" as alias\n` +
                    `• \`${botPrefix} alias MyAI my favorite ai\` - Add "my favorite ai" as alias`,
                  inline: false,
                },
                {
                  name: 'Parameters',
                  value:
                    '• **personality-name**: Name or existing alias of the personality\n' +
                    '• **new-alias**: The new shortcut to add (can be multiple words)',
                  inline: false,
                },
              ],
              footer: {
                text: 'Aliases make it easier to mention personalities quickly',
              },
            };
            return await context.respond({ embeds: [usageEmbed] });
          }

          // Get personality name from first argument
          personalityNameOrAlias = context.args[0].toLowerCase();
          // Join all remaining arguments to support multi-word aliases
          newAlias = context.args.slice(1).join(' ').toLowerCase();
        }

        // Validate inputs
        if (!personalityNameOrAlias || personalityNameOrAlias.length === 0) {
          const errorEmbed = {
            title: '❌ Missing Personality Name',
            description: 'Please provide a personality name or existing alias.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'What to provide',
                value:
                  '• The personality\'s name (e.g., "Claude")\n• Or an existing alias (e.g., "cl")',
                inline: false,
              },
            ],
          };
          return await context.respond({ embeds: [errorEmbed] });
        }

        if (!newAlias || newAlias.length === 0) {
          const errorEmbed = {
            title: '❌ Missing Alias',
            description: 'Please provide a new alias to add.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'What to provide',
                value:
                  'A short nickname for the personality (e.g., "helper", "ai-bot", "assistant")',
                inline: false,
              },
            ],
          };
          return await context.respond({ embeds: [errorEmbed] });
        }

        // Validate alias format - allow spaces for multi-word aliases
        if (!/^[a-zA-Z0-9_\- ]+$/.test(newAlias)) {
          const aliasErrorEmbed = {
            title: '❌ Invalid Alias Format',
            description:
              'Aliases can only contain letters, numbers, spaces, underscores, and hyphens.',
            color: 0xf44336, // Red color
            fields: [
              {
                name: 'Valid characters',
                value:
                  '• Letters (a-z, A-Z)\n• Numbers (0-9)\n• Spaces\n• Underscores (_)\n• Hyphens (-)',
                inline: false,
              },
              {
                name: 'Examples',
                value:
                  '✅ `claude-ai`\n✅ `helper bot`\n✅ `my favorite AI`\n✅ `AI2024`\n❌ `claude.ai`\n❌ `AI@2024`\n❌ `bot!123`',
                inline: false,
              },
            ],
          };
          return await context.respond({ embeds: [aliasErrorEmbed] });
        }

        logger.info(
          `[AliasCommand] Adding alias "${newAlias}" to personality "${personalityNameOrAlias}"`
        );

        try {
          // Get the user ID from the context
          const userId = context.getUserId();
          if (!userId) {
            return await context.respond('Unable to identify user. Please try again.');
          }

          // Add the alias using the application service
          const personality = await personalityService.addAlias({
            personalityName: personalityNameOrAlias,
            alias: newAlias,
            requesterId: userId,
          });

          const displayName = personality.profile.displayName || personality.profile.name;

          // Create embed fields
          const fields = [
            { name: 'Personality', value: displayName, inline: true },
            { name: 'New Alias', value: newAlias, inline: true },
          ];

          // Add all aliases
          if (personality.aliases && personality.aliases.length > 0) {
            const allAliases = personality.aliases.map(a => a.value || a.alias).join(', ');
            fields.push({
              name: 'All Aliases',
              value: allAliases,
              inline: false,
            });
          }

          // Create the embed response
          const embedData = {
            title: '✅ Alias Added Successfully!',
            description: `The alias **${newAlias}** has been added to **${displayName}**.`,
            color: 0x4caf50, // Green color
            fields: fields,
            footer: {
              text: 'You can now use this alias to mention the personality',
            },
            timestamp: new Date().toISOString(),
          };

          // Add avatar if available
          if (personality.profile.avatarUrl) {
            embedData.thumbnail = { url: personality.profile.avatarUrl };
          }

          return await context.respond({ embeds: [embedData] });
        } catch (error) {
          logger.error('[AliasCommand] Error adding alias:', error);

          // Handle specific errors
          if (error.message.includes('not found')) {
            const errorEmbed = {
              title: '❌ Personality Not Found',
              description: `No personality found with the name or alias "${personalityNameOrAlias}".`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'What to check',
                  value:
                    '• Spelling of the personality name\n• Try using the full name instead of alias\n• Use `list` command to see your personalities',
                  inline: false,
                },
              ],
              footer: {
                text: 'Personality names are case-insensitive',
              },
            };
            return await context.respond({ embeds: [errorEmbed] });
          }

          if (error.message.includes('owner')) {
            const errorEmbed = {
              title: '❌ Permission Denied',
              description: 'You can only add aliases to personalities you own.',
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'Why this happened',
                  value:
                    '• You are not the owner of this personality\n• Only the creator can add aliases',
                  inline: false,
                },
                {
                  name: 'What to do',
                  value:
                    `• Check the personality owner with \`${context.commandPrefix || '!tz'} info ${personalityNameOrAlias}\`\n` +
                    `• Use \`${context.commandPrefix || '!tz'} list\` to see personalities you own`,
                  inline: false,
                },
              ],
            };
            return await context.respond({ embeds: [errorEmbed] });
          }

          throw error;
        }
      } catch (error) {
        logger.error('[AliasCommand] Error:', error);

        const genericErrorEmbed = {
          title: '❌ Something Went Wrong',
          description: 'An error occurred while adding the alias.',
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
                '• Try again in a moment\n• Check your command syntax\n• Verify the personality exists\n• Contact support if the issue persists',
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

module.exports = { createAliasCommand };
