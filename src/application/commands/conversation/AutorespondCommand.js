/**
 * AutorespondCommand - Manages user auto-response preferences
 * DDD implementation following platform-agnostic command pattern
 * @module application/commands/conversation/AutorespondCommand
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Factory function to create an AutorespondCommand instance
 * @returns {Command} Configured autorespond command
 */
function createAutorespondCommand(dependencies = {}) {
  return new Command({
    name: 'autorespond',
    description: 'Manage your auto-response preference for conversations',
    category: 'Conversation',
    aliases: ['ar', 'auto'],
    options: [
      new CommandOption({
        name: 'action',
        description: 'Enable, disable, or check status',
        type: 'string',
        required: false,
        choices: [
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
          { name: 'status', value: 'status' },
        ],
      }),
    ],
    examples: [
      { command: 'autorespond', description: 'Check your current auto-response status' },
      { command: 'autorespond on', description: 'Enable auto-response' },
      { command: 'autorespond off', description: 'Disable auto-response' },
      { command: 'autorespond status', description: 'Check your current status' },
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
    const conversationManager = services.conversationManager;

    logger.info(`[AutorespondCommand] Executing for user ${context.userId}`);

    try {
      // Get action from options or args
      const action = options.action || args[0]?.toLowerCase();

      // If no action specified, show current status
      if (!action || action === 'status') {
        return await showStatus(context, conversationManager);
      }

      // Handle on/off actions
      switch (action) {
        case 'on':
          return await enableAutoResponse(context, conversationManager);
        case 'off':
          return await disableAutoResponse(context, conversationManager);
        default:
          return await context.respond(
            `❌ Invalid action "${action}". Use \`on\`, \`off\`, or \`status\`.`
          );
      }
    } catch (error) {
      logger.error('[AutorespondCommand] Unexpected error:', error);
      return await context.respond('❌ An unexpected error occurred. Please try again later.');
    }
  };
}

/**
 * Show current auto-response status
 */
async function showStatus(context, conversationManager) {
  const isEnabled = conversationManager.isAutoResponseEnabled(context.userId);

  const embed = {
    title: '🔄 Auto-Response Status',
    description: `Your auto-response preference is currently **${isEnabled ? 'enabled' : 'disabled'}**.`,
    color: isEnabled ? 0x00ff00 : 0xff0000,
    fields: [
      {
        name: 'What is Auto-Response?',
        value:
          'When enabled, personalities will continue responding to your messages after being mentioned or replied to. When disabled, you need to mention or reply each time.',
        inline: false,
      },
      {
        name: 'Current Setting',
        value: isEnabled ? '✅ Enabled' : '❌ Disabled',
        inline: true,
      },
      {
        name: 'User',
        value: `<@${context.userId}>`,
        inline: true,
      },
    ],
    footer: {
      text: `Use "${context.commandPrefix}autorespond on/off" to change this setting`,
    },
    timestamp: new Date().toISOString(),
  };

  return await context.respond({ embeds: [embed] });
}

/**
 * Enable auto-response for the user
 */
async function enableAutoResponse(context, conversationManager) {
  try {
    conversationManager.setAutoResponse(context.userId, true);
    logger.info(`[AutorespondCommand] Enabled auto-response for user ${context.userId}`);

    const embed = {
      title: '✅ Auto-Response Enabled',
      description:
        'Personalities will now continue responding to your messages after being mentioned or replied to.',
      color: 0x00ff00,
      fields: [
        {
          name: 'What changed?',
          value:
            'You no longer need to mention or reply to personalities in every message. They will continue the conversation automatically.',
          inline: false,
        },
        {
          name: 'How to stop a conversation',
          value: 'Use the reset command or start talking to a different personality.',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    return await context.respond({ embeds: [embed] });
  } catch (error) {
    logger.error('[AutorespondCommand] Error enabling auto-response:', error);
    return await context.respond('❌ Failed to enable auto-response. Please try again.');
  }
}

/**
 * Disable auto-response for the user
 */
async function disableAutoResponse(context, conversationManager) {
  try {
    conversationManager.setAutoResponse(context.userId, false);
    logger.info(`[AutorespondCommand] Disabled auto-response for user ${context.userId}`);

    const embed = {
      title: '❌ Auto-Response Disabled',
      description: 'Personalities will no longer automatically respond to your messages.',
      color: 0xff0000,
      fields: [
        {
          name: 'What changed?',
          value:
            'You now need to mention (@personality) or reply to personality messages for them to respond.',
          inline: false,
        },
        {
          name: 'Why disable?',
          value:
            'This gives you more control over when personalities respond, preventing unwanted interactions.',
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    return await context.respond({ embeds: [embed] });
  } catch (error) {
    logger.error('[AutorespondCommand] Error disabling auto-response:', error);
    return await context.respond('❌ Failed to disable auto-response. Please try again.');
  }
}

module.exports = {
  createAutorespondCommand,
};
