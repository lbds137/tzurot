/**
 * Ping Command Handler
 */
const logger = require('../../logger');
const validator = require('../utils/commandValidator');

/**
 * Command metadata
 */
const meta = {
  name: 'ping',
  description: 'Check if the bot is online',
  usage: 'ping',
  aliases: [],
  permissions: [],
};

/**
 * Execute the ping command
 * @param {Object} message - Discord message object
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object>} Command result
 */
async function execute(message, _args) {
  try {
    const directSend = validator.createDirectSend(message);
    return await directSend('Pong! Tzurot is operational.');
  } catch (error) {
    logger.error('Error executing ping command:', error);
    throw error;
  }
}

module.exports = {
  meta,
  execute,
};
