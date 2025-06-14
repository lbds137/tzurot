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

      // Simply respond with pong and bot name
      await context.respond(`Pong! ${botConfig.name} is operational.`);
    } catch (error) {
      logger.error('[PingCommand] Execution failed:', error);
      await context.respond('An error occurred while checking bot status.');
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
