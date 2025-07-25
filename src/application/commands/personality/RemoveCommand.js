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
            const botPrefix = context.commandPrefix || '!tz';
            const usageEmbed = {
              title: 'How to Remove a Personality',
              description: 'Remove a personality from your collection.',
              color: 0x2196f3, // Blue color
              fields: [
                {
                  name: 'Basic Usage',
                  value: `\`${botPrefix} remove <name>\``,
                  inline: false,
                },
                {
                  name: 'Examples',
                  value:
                    `• \`${botPrefix} remove Claude\` - Remove by name\n` +
                    `• \`${botPrefix} remove cl\` - Remove by alias\n` +
                    `• \`${botPrefix} remove "My Assistant"\` - Remove with spaces`,
                  inline: false,
                },
                {
                  name: 'Important',
                  value:
                    '⚠️ You can only remove personalities you created\n' +
                    '⚠️ This action cannot be undone',
                  inline: false,
                },
              ],
              footer: {
                text: 'Removed personalities can be recreated with the same name',
              },
            };
            return await context.respond({ embeds: [usageEmbed] });
          }

          personalityName = context.args[0];
        }

        // Normalize the name
        personalityName = personalityName.toLowerCase();

        // Validate input
        if (!personalityName || personalityName.length === 0) {
          const errorEmbed = {
            title: '❌ Missing Personality Name',
            description: 'Please provide a personality name to remove.',
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
          `[RemoveCommand] Removing personality "${personalityName}" for user ${context.getUserId()}`
        );

        try {
          // First, find the personality to get its details
          const personality = await personalityService.getPersonality(personalityName);

          if (!personality) {
            const notFoundEmbed = {
              title: '❌ Personality Not Found',
              description: `No personality found with the name or alias "${personalityName}".`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'What to check',
                  value:
                    '• Spelling of the personality name\n• Try using the full name instead of alias\n• Use `' +
                    (context.commandPrefix || '!tz') +
                    ' list` command to see your personalities',
                  inline: false,
                },
              ],
              footer: {
                text: 'Personality names are case-insensitive',
              },
            };
            return await context.respond({ embeds: [notFoundEmbed] });
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

          // Build fields for the embed
          const fields = [
            {
              name: 'Removed Personality',
              value: displayName,
              inline: true,
            },
          ];

          // Add alias info if any existed
          if (personality.aliases && personality.aliases.length > 0) {
            const aliases = personality.aliases.map(a => a.value || a.alias).join(', ');
            fields.push({
              name: 'Aliases Removed',
              value: aliases,
              inline: true,
            });
          }

          // Add bot owner indicator if removing someone else's personality
          const { USER_CONFIG } = require('../../../constants');
          if (
            personality.ownerId &&
            personality.ownerId.toString() !== context.getUserId() &&
            context.getUserId() === USER_CONFIG.OWNER_ID
          ) {
            fields.push({
              name: 'Admin Action',
              value: '👑 Removed as bot owner (originally owned by another user)',
              inline: false,
            });
          }

          // Add next steps
          const botPrefix = context.commandPrefix || '!tz';
          fields.push({
            name: 'What Now?',
            value:
              '• You can recreate this personality with the same name\n' +
              `• Use \`${botPrefix} list\` to see your remaining personalities\n` +
              "• The personality's conversation history has been preserved",
            inline: false,
          });

          const successEmbed = {
            title: '✅ Personality Removed Successfully',
            description: `**${displayName}** has been removed from your collection.`,
            color: 0xf44336, // Red color for removal
            fields: fields,
            footer: {
              text: 'This action cannot be undone',
            },
            timestamp: new Date().toISOString(),
          };

          // Add avatar thumbnail if available
          if (personality.profile?.avatarUrl) {
            successEmbed.thumbnail = { url: personality.profile.avatarUrl };
          }

          return await context.respond({ embeds: [successEmbed] });
        } catch (error) {
          // Handle specific errors
          if (error.message.includes('not found')) {
            const notFoundEmbed = {
              title: '❌ Personality Not Found',
              description: `No personality found with the name or alias "${personalityName}".`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'What to check',
                  value:
                    '• Spelling of the personality name\n• Try using the full name instead of alias\n• Use `' +
                    (context.commandPrefix || '!tz') +
                    ' list` command to see your personalities',
                  inline: false,
                },
              ],
              footer: {
                text: 'Personality names are case-insensitive',
              },
            };
            return await context.respond({ embeds: [notFoundEmbed] });
          }

          if (error.message.includes('owner') || error.message.includes('permission')) {
            const permissionEmbed = {
              title: '❌ Permission Denied',
              description: "You cannot remove a personality that you didn't create.",
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'Why this happened',
                  value:
                    '• You are not the owner of this personality\n• Only the creator can remove a personality',
                  inline: false,
                },
                {
                  name: 'What you can do',
                  value:
                    '• Use `' +
                    (context.commandPrefix || '!tz') +
                    ' list` to see personalities you own\n• Ask the owner to remove it\n• Create your own version with a different name',
                  inline: false,
                },
              ],
            };
            return await context.respond({ embeds: [permissionEmbed] });
          }

          if (error.message.includes('Authentication failed')) {
            const botPrefix = context.commandPrefix || '!tz';
            const authEmbed = {
              title: '❌ Authentication Required',
              description: 'You need to authenticate before removing personalities.',
              color: 0xff9800, // Orange color
              fields: [
                {
                  name: 'How to authenticate',
                  value:
                    `1. Use \`${botPrefix} auth\` to start authentication\n` +
                    '2. Follow the instructions in the DM\n' +
                    '3. Try removing the personality again',
                  inline: false,
                },
              ],
              footer: {
                text: 'Authentication ensures secure personality management',
              },
            };
            return await context.respond({ embeds: [authEmbed] });
          }

          // Handle exceptions
          logger.error('[RemoveCommand] Exception during removal:', error);
          throw error; // Re-throw to be handled by outer catch
        }
      } catch (error) {
        logger.error('[RemoveCommand] Error:', error);

        const genericErrorEmbed = {
          title: '❌ Something Went Wrong',
          description: 'An error occurred while removing the personality.',
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
                '• Try again in a moment\n• Check the personality name\n• Verify you own the personality\n• Contact support if the issue persists',
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

module.exports = { createRemoveCommand };
