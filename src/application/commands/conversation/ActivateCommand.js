/**
 * ActivateCommand - Activates a personality in a channel to respond to all messages
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/conversation/ActivateCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Factory function to create an ActivateCommand instance
 * @returns {Command} Configured activate command
 */
function createActivateCommand(dependencies = {}) {
  return new Command({
    name: 'activate',
    description: 'Activate a personality to respond to all messages in this channel',
    category: 'Conversation',
    aliases: ['act'],
    options: [
      new CommandOption({
        name: 'personality',
        description: 'The name or alias of the personality to activate',
        type: 'string',
        required: true,
      }),
    ],
    examples: [
      { command: 'activate Aria', description: 'Activates Aria in the current channel' },
      { command: 'activate "bambi prime"', description: 'Activates a multi-word personality' },
    ],
    execute: createExecutor(dependencies),
  });
}

/**
 * Create the command executor function
 */
function createExecutor(_dependencies) {
  return async function execute(context) {
    const { args, options } = context;
    const personalityService = context.dependencies.personalityApplicationService;
    const conversationManager = context.dependencies.conversationManager;

    logger.info(`[ActivateCommand] Executing for channel ${context.getChannelId()}`);

    try {
      // Validate this is a guild channel
      if (!context.getGuildId()) {
        const errorEmbed = {
          title: '❌ Server Channels Only',
          description: 'The activate command can only be used in server channels, not DMs.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Check if user has required permissions
      const hasPermission = await context.hasPermission('ManageMessages');
      if (!hasPermission) {
        const errorEmbed = {
          title: '❌ Insufficient Permissions',
          description:
            'You need the "Manage Messages" permission to activate personalities in this channel.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Check if channel is NSFW
      const isNSFW = await context.isChannelNSFW();
      if (!isNSFW) {
        const errorEmbed = {
          title: '⚠️ NSFW Channel Required',
          description:
            'For safety and compliance reasons, personalities can only be activated in channels marked as NSFW.',
          color: 0xff9800,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Get personality name from args or options
      const personalityInput = options.personality || args.join(' ');
      if (!personalityInput) {
        const errorEmbed = {
          title: '❌ Missing Personality',
          description: 'Please specify a personality to activate.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      logger.debug(`[ActivateCommand] Looking up personality: "${personalityInput}"`);

      // Look up the personality
      let personality;
      try {
        // The getPersonality method handles both name and alias lookup internally
        personality = await personalityService.getPersonality(personalityInput);
      } catch (error) {
        logger.error('[ActivateCommand] Error looking up personality:', error);
        const errorEmbed = {
          title: '❌ Lookup Error',
          description: 'Error looking up personality. Please try again.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      if (!personality) {
        const errorEmbed = {
          title: '❌ Personality Not Found',
          description: `Personality "${personalityInput}" not found.`,
          color: 0xf44336,
          fields: [
            {
              name: 'Need help?',
              value: `Use \`${context.dependencies.botPrefix} list\` to see available personalities.`,
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Activate the personality in this channel
      try {
        // Use the correct property based on the format (DDD uses profile.name, legacy uses fullName)
        const personalityName =
          personality.profile?.name || personality.fullName || personality.name;
        const userId = context.getUserId();
        await conversationManager.activatePersonality(
          context.getChannelId(),
          personalityName,
          userId
        );
        logger.info(
          `[ActivateCommand] Successfully activated ${personalityName} in channel ${context.getChannelId()} by user ${userId}`
        );
      } catch (error) {
        logger.error('[ActivateCommand] Error activating personality:', error);
        return await context.respond('❌ Failed to activate personality. Please try again.');
      }

      // Send success response with embed
      const embed = {
        title: '✅ Personality Activated',
        description: `**${personality.profile?.displayName || personality.profile?.name || personality.displayName || personality.fullName}** is now active in this channel and will respond to all messages.`,
        color: 0x00ff00,
        fields: [
          {
            name: 'Personality',
            value:
              personality.profile?.displayName ||
              personality.profile?.name ||
              personality.displayName ||
              personality.fullName,
            inline: true,
          },
          {
            name: 'Channel',
            value: `<#${context.getChannelId()}>`,
            inline: true,
          },
          {
            name: 'How to Deactivate',
            value: `Use \`${context.dependencies.botPrefix} deactivate\` to stop ${personality.profile?.displayName || personality.profile?.name || personality.displayName || personality.fullName} from responding.`,
            inline: false,
          },
        ],
        thumbnail: personality.profile?.avatarUrl
          ? { url: personality.profile.avatarUrl }
          : undefined,
        timestamp: new Date().toISOString(),
      };

      return await context.respond({ embeds: [embed] });
    } catch (error) {
      logger.error('[ActivateCommand] Unexpected error:', error);
      return await context.respond('❌ An unexpected error occurred. Please try again later.');
    }
  };
}

module.exports = {
  createActivateCommand,
};
