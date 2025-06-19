/**
 * Ping Command - Check bot responsiveness
 *
 * A simple utility command that responds with "Pong!" to verify
 * the bot is online and responsive.
 */

const { Command } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Creates the executor function for the ping command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      const { botConfig = require('../../../../config').botConfig } = dependencies;
      const startTime = Date.now();

      // Create ping response embed
      const pingEmbed = {
        title: '🏓 Pong!',
        description: `${botConfig.name} is operational.`,
        color: 0x4caf50,
        fields: [
          {
            name: 'Status',
            value: '✅ Online',
            inline: true,
          },
          {
            name: 'Response Time',
            value: `${Date.now() - startTime}ms`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      await context.respond({ embeds: [pingEmbed] });
    } catch (error) {
      logger.error('[PingCommand] Execution failed:', error);
      const errorEmbed = {
        title: '❌ Ping Failed',
        description: 'An error occurred while checking bot status.',
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
    }
  };
}

/**
 * Factory function to create the ping command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The ping command instance
 */
function createPingCommand(dependencies = {}) {
  return new Command({
    name: 'ping',
    description: 'Check if the bot is online',
    category: 'Utility',
    aliases: [],
    options: [], // No options needed for ping
    execute: createExecutor(dependencies),
  });
}

module.exports = {
  createPingCommand,
};
