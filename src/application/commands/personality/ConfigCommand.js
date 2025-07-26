/**
 * Config personality command - Platform-agnostic implementation
 * Allows users to configure settings for their personalities
 * @module application/commands/personality/ConfigCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Create the config personality command
 */
function createConfigCommand() {
  return new Command({
    name: 'config',
    description: 'Configure settings for a personality',
    category: 'personality',
    aliases: ['configure', 'settings'],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'name',
        description: 'The name or alias of the personality to configure',
        type: 'string',
        required: true,
      }),
      new CommandOption({
        name: 'setting',
        description: 'The setting to configure',
        type: 'string',
        required: true,
        choices: [
          { name: 'context-metadata', value: 'context-metadata' },
          // Future settings can be added here
        ],
      }),
      new CommandOption({
        name: 'value',
        description: 'The value to set (on/off for toggles)',
        type: 'string',
        required: true,
        choices: [
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ],
      }),
    ],
    execute: async context => {
      try {
        // Extract dependencies
        const personalityService = context.dependencies.personalityApplicationService;

        if (!personalityService) {
          throw new Error('PersonalityApplicationService not available');
        }

        // Get arguments based on command type
        let personalityNameOrAlias, setting, value;

        if (context.isSlashCommand) {
          // Slash command - options are named
          personalityNameOrAlias = context.options.name;
          setting = context.options.setting;
          value = context.options.value;
        } else {
          // Text command - parse positional arguments
          if (context.args.length < 3) {
            const usageEmbed = {
              title: 'How to Configure Personality Settings',
              description: 'Modify settings for your personalities.',
              color: 0x2196f3, // Blue color
              fields: [
                {
                  name: 'Usage',
                  value: `\`${context.commandPrefix || '!tz'} config <personality> <setting> <value>\``,
                  inline: false,
                },
                {
                  name: 'Available Settings',
                  value: [
                    '• `context-metadata` - Include server/channel info in messages (on/off)',
                  ].join('\n'),
                  inline: false,
                },
                {
                  name: 'Examples',
                  value: [
                    `\`${context.commandPrefix || '!tz'} config alice context-metadata off\``,
                    `\`${context.commandPrefix || '!tz'} config "My Bot" context-metadata on\``,
                  ].join('\n'),
                  inline: false,
                },
              ],
              footer: {
                text: 'Tip: You can only configure personalities you own.',
              },
            };

            await context.reply({ embeds: [usageEmbed] });
            return;
          }

          personalityNameOrAlias = context.args[0];
          setting = context.args[1];
          value = context.args[2];
        }

        // Validate setting name
        const validSettings = ['context-metadata'];
        if (!validSettings.includes(setting)) {
          const errorEmbed = {
            title: 'Invalid Setting',
            description: `"${setting}" is not a valid setting.`,
            color: 0xff5722, // Red color
            fields: [
              {
                name: 'Available Settings',
                value: validSettings.map(s => `• \`${s}\``).join('\n'),
                inline: false,
              },
            ],
          };

          await context.reply({ embeds: [errorEmbed] });
          return;
        }

        // Validate value for boolean settings
        const validValues = ['on', 'off', 'true', 'false', 'enable', 'disable'];
        if (!validValues.includes(value.toLowerCase())) {
          const errorEmbed = {
            title: 'Invalid Value',
            description: `"${value}" is not a valid value. Use "on" or "off".`,
            color: 0xff5722, // Red color
          };

          await context.reply({ embeds: [errorEmbed] });
          return;
        }

        // Convert value to boolean
        const booleanValue = ['off', 'false', 'disable'].includes(value.toLowerCase());

        try {
          // Get the personality to verify existence
          const personality = await personalityService.getPersonality(personalityNameOrAlias);

          if (!personality) {
            const errorEmbed = {
              title: 'Personality Not Found',
              description: `Could not find a personality named "${personalityNameOrAlias}".`,
              color: 0xff5722, // Red color
              footer: {
                text: `Use "${context.commandPrefix || '!tz'} list" to see available personalities.`,
              },
            };

            await context.reply({ embeds: [errorEmbed] });
            return;
          }

          // Check if user has permission to modify this personality
          const hasPermission = await personalityService.checkPermission({
            userId: context.userId,
            personalityName: personalityNameOrAlias,
          });

          if (!hasPermission) {
            const errorEmbed = {
              title: 'Permission Denied',
              description: `You don't have permission to configure "${personalityNameOrAlias}".`,
              color: 0xff5722, // Red color
              footer: {
                text: 'You can only configure personalities you own.',
              },
            };

            await context.reply({ embeds: [errorEmbed] });
            return;
          }

          // Apply the setting based on the setting name
          const updateData = {};
          let settingDescription = '';

          switch (setting) {
            case 'context-metadata':
              updateData.disableContextMetadata = booleanValue;
              settingDescription = booleanValue
                ? 'Context metadata (server/channel info) has been **disabled**'
                : 'Context metadata (server/channel info) has been **enabled**';
              break;
          }

          // Update the personality
          await personalityService.updatePersonality(personality.id, updateData);

          const successEmbed = {
            title: 'Setting Updated',
            description: `Updated setting for **${personality.profile?.displayName || personality.name}**.`,
            color: 0x4caf50, // Green color
            fields: [
              {
                name: 'Setting',
                value: `\`${setting}\``,
                inline: true,
              },
              {
                name: 'Value',
                value: `\`${value}\``,
                inline: true,
              },
              {
                name: 'Effect',
                value: settingDescription,
                inline: false,
              },
            ],
          };

          await context.reply({ embeds: [successEmbed] });

          logger.info(
            `[ConfigCommand] User ${context.userId} updated ${setting} to ${value} for personality ${personality.name}`
          );
        } catch (personalityError) {
          logger.error(
            '[ConfigCommand] Error updating personality configuration:',
            personalityError
          );

          const errorEmbed = {
            title: 'Configuration Error',
            description: 'Failed to update the personality configuration. Please try again.',
            color: 0xff5722, // Red color
          };

          await context.reply({ embeds: [errorEmbed] });
        }
      } catch (error) {
        logger.error('[ConfigCommand] Error:', error);

        const errorEmbed = {
          title: 'Command Error',
          description: 'An error occurred while processing the configuration command.',
          color: 0xff5722, // Red color
        };

        await context.reply({ embeds: [errorEmbed] });
      }
    },
  });
}

module.exports = {
  createConfigCommand,
};
