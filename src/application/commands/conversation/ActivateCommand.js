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
function createExecutor(dependencies) {
  return async function execute(context) {
    const { args, options, services } = context;
    const personalityService = services.personalityApplicationService;
    const conversationManager = services.conversationManager;

    logger.info(`[ActivateCommand] Executing for channel ${context.channelId}`);

    try {
      // Validate this is a guild channel
      if (!context.guildId) {
        return await context.respond(
          '❌ The activate command can only be used in server channels, not DMs.'
        );
      }

      // Check if user has required permissions
      const hasPermission = await context.hasPermission('ManageMessages');
      if (!hasPermission) {
        return await context.respond(
          '❌ You need the "Manage Messages" permission to activate personalities in this channel.'
        );
      }

      // Check if channel is NSFW
      const isNSFW = await context.isChannelNSFW();
      if (!isNSFW) {
        return await context.respond(
          '⚠️ For safety and compliance reasons, personalities can only be activated in channels marked as NSFW.'
        );
      }

      // Get personality name from args or options
      const personalityInput = options.personality || args.join(' ');
      if (!personalityInput) {
        return await context.respond('❌ Please specify a personality to activate.');
      }

      logger.debug(`[ActivateCommand] Looking up personality: "${personalityInput}"`);

      // Look up the personality
      let personality;
      try {
        // First try direct lookup
        personality = await personalityService.getPersonality(personalityInput);

        // If not found, try as alias
        if (!personality) {
          personality = await personalityService.findPersonalityByAlias(personalityInput);
        }
      } catch (error) {
        logger.error('[ActivateCommand] Error looking up personality:', error);
        return await context.respond('❌ Error looking up personality. Please try again.');
      }

      if (!personality) {
        return await context.respond(
          `❌ Personality "${personalityInput}" not found. Use \`${services.botPrefix} list\` to see available personalities.`
        );
      }

      // Activate the personality in this channel
      try {
        await conversationManager.activatePersonality(context.channelId, personality.name);
        logger.info(
          `[ActivateCommand] Successfully activated ${personality.name} in channel ${context.channelId}`
        );
      } catch (error) {
        logger.error('[ActivateCommand] Error activating personality:', error);
        return await context.respond('❌ Failed to activate personality. Please try again.');
      }

      // Send success response with embed
      const embed = {
        title: '✅ Personality Activated',
        description: `**${personality.name}** is now active in this channel and will respond to all messages.`,
        color: 0x00ff00,
        fields: [
          {
            name: 'Personality',
            value: personality.name,
            inline: true,
          },
          {
            name: 'Channel',
            value: `<#${context.channelId}>`,
            inline: true,
          },
          {
            name: 'How to Deactivate',
            value: `Use \`${services.botPrefix} deactivate\` to stop ${personality.name} from responding.`,
            inline: false,
          },
        ],
        thumbnail: personality.profileUrl ? { url: personality.profileUrl } : undefined,
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
