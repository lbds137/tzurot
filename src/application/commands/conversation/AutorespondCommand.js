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
function createExecutor(_dependencies) {
  return async function execute(context) {
    const { args, options } = context;
    const conversationManager = context.dependencies.conversationManager;

    logger.info(`[AutorespondCommand] Executing for user ${context.getUserId()}`);

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
        default: {
          const invalidEmbed = {
            title: '❌ Invalid Action',
            description: `Invalid action "${action}". Use \`on\`, \`off\`, or \`status\`.`,
            color: 0xf44336,
            timestamp: new Date().toISOString(),
          };
          return await context.respond({ embeds: [invalidEmbed] });
        }
      }
    } catch (error) {
      logger.error('[AutorespondCommand] Unexpected error:', error);

      const errorEmbed = {
        title: '❌ Error',
        description: 'An unexpected error occurred. Please try again later.',
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };

      return await context.respond({ embeds: [errorEmbed] });
    }
  };
}

/**
 * Show current auto-response status
 */
async function showStatus(context, conversationManager) {
  const isEnabled = conversationManager.isAutoResponseEnabled(context.getUserId());

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
        value: `<@${context.getUserId()}>`,
        inline: true,
      },
    ],
    footer: {
      text: `Use "${context.commandPrefix || '!tz'} autorespond on/off" to change this setting`,
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
    conversationManager.enableAutoResponse(context.getUserId());
    logger.info(`[AutorespondCommand] Enabled auto-response for user ${context.getUserId()}`);

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

    const errorEmbed = {
      title: '❌ Error',
      description: 'Failed to enable auto-response. Please try again.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };

    return await context.respond({ embeds: [errorEmbed] });
  }
}

/**
 * Disable auto-response for the user
 */
async function disableAutoResponse(context, conversationManager) {
  try {
    conversationManager.disableAutoResponse(context.getUserId());
    logger.info(`[AutorespondCommand] Disabled auto-response for user ${context.getUserId()}`);

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

    const errorEmbed = {
      title: '❌ Error',
      description: 'Failed to disable auto-response. Please try again.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };

    return await context.respond({ embeds: [errorEmbed] });
  }
}

module.exports = {
  createAutorespondCommand,
};
