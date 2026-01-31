/**
 * DeactivateCommand - Deactivates the currently active personality in a channel
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/conversation/DeactivateCommand
 */

const { Command } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Factory function to create a DeactivateCommand instance
 * @returns {Command} Configured deactivate command
 */
function createDeactivateCommand(dependencies = {}) {
  return new Command({
    name: 'deactivate',
    description: 'Deactivate the currently active personality in this channel',
    category: 'Conversation',
    aliases: ['deact'],
    options: [], // No options needed
    examples: [{ command: 'deactivate', description: 'Deactivates the active personality' }],
    execute: createExecutor(dependencies),
  });
}

/**
 * Create the command executor function
 */
function createExecutor(_dependencies) {
  return async function execute(context) {
    const conversationManager = context.dependencies.conversationManager;

    logger.info(`[DeactivateCommand] Executing for channel ${context.getChannelId()}`);

    try {
      // Validate this is a guild channel
      if (!context.getGuildId()) {
        return await context.respond(
          '❌ The deactivate command can only be used in server channels, not DMs.'
        );
      }

      // Check if user has required permissions
      const hasPermission = await context.hasPermission('ManageMessages');
      if (!hasPermission) {
        const errorEmbed = {
          title: '❌ Insufficient Permissions',
          description:
            'You need the "Manage Messages" permission to deactivate personalities in this channel.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Check if there's an active personality
      const activePersonality = conversationManager.getActivatedPersonality(context.getChannelId());
      if (!activePersonality) {
        const errorEmbed = {
          title: '❌ No Active Personality',
          description: 'There is no active personality in this channel.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Deactivate the personality
      try {
        conversationManager.deactivatePersonality(context.getChannelId());
        logger.info(
          `[DeactivateCommand] Successfully deactivated ${activePersonality} in channel ${context.getChannelId()}`
        );
      } catch (error) {
        logger.error('[DeactivateCommand] Error deactivating personality:', error);
        const errorEmbed = {
          title: '❌ Deactivation Failed',
          description: 'Failed to deactivate personality. Please try again.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        return await context.respond({ embeds: [errorEmbed] });
      }

      // Send success response with embed
      const embed = {
        title: '✅ Personality Deactivated',
        description: `**${activePersonality}** has been deactivated and will no longer respond to all messages in this channel.`,
        color: 0x00ff00,
        fields: [
          {
            name: 'Deactivated Personality',
            value: activePersonality,
            inline: true,
          },
          {
            name: 'Channel',
            value: `<#${context.getChannelId()}>`,
            inline: true,
          },
          {
            name: 'Note',
            value: 'The personality can still be mentioned directly or respond to replies.',
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      return await context.respond({ embeds: [embed] });
    } catch (error) {
      logger.error('[DeactivateCommand] Unexpected error:', error);
      return await context.respond('❌ An unexpected error occurred. Please try again later.');
    }
  };
}

module.exports = {
  createDeactivateCommand,
};
