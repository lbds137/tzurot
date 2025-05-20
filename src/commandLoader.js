/**
 * Command Loader - Bridge to the new modular command system
 */
const logger = require('./logger');
const newCommandSystem = require('./commands/index');

/**
 * Process a command using the command system
 * @param {Object} message - Discord message object
 * @param {string} command - Command name
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object|null>} Command result or null
 */
async function processCommand(message, command, args) {
  // Log the command being processed
  logger.info(`[CommandLoader] Processing command: ${command} with args: ${args.join(' ')} from user: ${message.author.tag}`);

  try {
    // Process the command using the command system
    const result = await newCommandSystem.processCommand(message, command, args);
    
    // If the command wasn't found or there was an error, log it
    if (!result) {
      logger.info(`[CommandLoader] Command not found or failed to execute: ${command}`);
    }
    
    return result;
  } catch (error) {
    logger.error(`[CommandLoader] Error processing command ${command}:`, error);
    return await message.channel.send(
      `An error occurred while processing the command. Please try again.`
    );
  }
}

module.exports = {
  processCommand
};