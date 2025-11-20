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
            const botPrefix = context.commandPrefix || '!tz';
            const usageEmbed = {
              title: '❌ Missing Personality Name',
              description: 'Please provide a personality name or alias to reset.',
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'Usage',
                  value: `\`${botPrefix} reset <personality>\``,
                  inline: false,
                },
                {
                  name: 'Examples',
                  value: `• \`${botPrefix} reset Claude\`\n• \`${botPrefix} reset aria\`\n• \`${botPrefix} reset "bambi prime"\``,
                  inline: false,
                },
                {
                  name: 'What does reset do?',
                  value:
                    'Clears all conversation history with the personality in this channel, starting fresh.',
                  inline: false,
                },
              ],
              footer: {
                text: 'Use the list command to see available personalities',
              },
            };
            return await context.respond({ embeds: [usageEmbed] });
          }

          personalityNameOrAlias = context.args[0].toLowerCase();
        }

        // Validate input
        if (!personalityNameOrAlias || personalityNameOrAlias.length === 0) {
          const validationEmbed = {
            title: '❌ Invalid Input',
            description: 'Please provide a valid personality name or alias.',
            color: 0xf44336, // Red color
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [validationEmbed] });
        }

        logger.info(
          `[ResetCommand] Resetting conversation with "${personalityNameOrAlias}" for user ${context.getUserId()}`
        );

        try {
          // Get the personality using the application service
          const personality = await personalityService.getPersonality(personalityNameOrAlias);

          if (!personality) {
            const notFoundEmbed = {
              title: '❌ Personality Not Found',
              description: `Could not find a personality named **${personalityNameOrAlias}**.`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'Search term',
                  value: personalityNameOrAlias,
                  inline: true,
                },
                {
                  name: 'What to do',
                  value: `• Check the spelling and try again\n• Use \`${context.commandPrefix || '!tz'} list\` to see available personalities\n• Personality names are case-insensitive`,
                  inline: false,
                },
              ],
              timestamp: new Date().toISOString(),
            };
            return await context.respond({ embeds: [notFoundEmbed] });
          }

          // Clear the conversation for this personality in this channel
          // Note: This uses the legacy conversation system for now
          // In the future, this will use ConversationApplicationService
          const personalityName =
            personality.profile?.name || personality.fullName || personality.name;
          const cleared = conversationManager.clearConversation(
            context.getUserId(),
            context.getChannelId(),
            personalityName
          );

          if (!cleared) {
            const noConversationEmbed = {
              title: '❌ No Active Conversation',
              description: `No active conversation found with **${personality.profile?.displayName || personality.profile?.name || personality.displayName || personality.fullName}** in this channel.`,
              color: 0xf44336, // Red color
              fields: [
                {
                  name: 'How to start a conversation',
                  value: `• Mention @${personalityName} to start chatting\n• Reply to a personality message\n• Use activate command for channel-wide responses`,
                  inline: false,
                },
              ],
              timestamp: new Date().toISOString(),
            };
            return await context.respond({ embeds: [noConversationEmbed] });
          }

          // Create success embed
          const displayName =
            personality.profile?.displayName ||
            personality.profile?.name ||
            personality.displayName ||
            personality.fullName;
          const successEmbed = {
            title: '✅ Conversation Reset',
            description: `Your conversation with **${displayName}** has been reset in this channel.`,
            color: 0x4caf50, // Green color
            fields: [
              {
                name: 'Personality',
                value: displayName,
                inline: true,
              },
              {
                name: 'Channel',
                value: `<#${context.getChannelId()}>`,
                inline: true,
              },
              {
                name: 'What happened?',
                value:
                  'All conversation history and context has been cleared. The next message will start a fresh conversation.',
                inline: false,
              },
            ],
            thumbnail: personality.profile?.avatarUrl
              ? { url: personality.profile.avatarUrl }
              : undefined,
            timestamp: new Date().toISOString(),
          };


          return await context.respond({ embeds: [successEmbed] });
        } catch (error) {
          logger.error('[ResetCommand] Error resetting conversation:', error);
          throw error;
        }
      } catch (error) {
        logger.error('[ResetCommand] Error:', error);

        const errorEmbed = {
          title: '❌ Error Resetting Conversation',
          description: 'An error occurred while trying to reset the conversation.',
          color: 0xf44336, // Red color
          fields: [
            {
              name: 'Error details',
              value: error.message || 'Unknown error',
              inline: false,
            },
            {
              name: 'What to do',
              value:
                '• Try again in a moment\n• Check if the personality exists\n• Contact support if the issue persists',
              inline: false,
            },
          ],
          footer: {
            text: `Error ID: ${Date.now()}`,
          },
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }
    },
  });
}

module.exports = { createResetCommand };
