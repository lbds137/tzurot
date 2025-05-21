/**
 * Command System - Main entry point
 */
const logger = require('../logger');
const authMiddleware = require('./middleware/auth');
const deduplicationMiddleware = require('./middleware/deduplication');
const permissionsMiddleware = require('./middleware/permissions');
const commandRegistry = require('./utils/commandRegistry');
const { botPrefix } = require('../../config');

/**
 * Process a command
 * @param {Object} message - Discord message object
 * @param {string} command - Command name
 * @param {Array<string>} args - Command arguments
 * @returns {Promise<Object|null>} Command result or null if not processed
 */
async function processCommand(message, command, args) {
  try {
    // Log the command being processed
    logger.info(
      `Processing command: ${command} with args: ${args.join(' ')} from user: ${message.author.tag}`
    );

    // Apply deduplication middleware
    const deduplicationResult = deduplicationMiddleware(message, command, args);
    if (!deduplicationResult.shouldProcess) {
      return null;
    }

    // Apply authentication middleware
    const authResult = await authMiddleware(message, command, args);
    if (!authResult.authenticated) {
      // If authentication failed but it's a special bypass case (like proxy webhook auth commands)
      if (authResult.bypass) {
        // Just send the error message but don't treat as a failure
        if (authResult.error) {
          return await message.channel.send(authResult.error);
        }
        return true;
      }

      // Regular authentication failure
      if (authResult.error) {
        return await message.reply(authResult.error);
      }
      return null;
    }

    // Find the command handler
    const commandModule = commandRegistry.get(command);
    if (!commandModule) {
      return await message.reply(
        `Unknown command: \`${command}\`. Use \`${botPrefix} help\` to see available commands.`
      );
    }

    // Apply permissions middleware
    const permissionsResult = permissionsMiddleware(message, command, commandModule);
    if (!permissionsResult.hasPermission) {
      if (permissionsResult.error) {
        return await message.reply(permissionsResult.error);
      }
      return null;
    }

    // Execute the command
    return await commandModule.execute(message, args);
  } catch (error) {
    logger.error(`Error processing command ${command}:`, error);
    return await message.channel.send(
      `An error occurred while processing the command. Please try again.`
    );
  }
}

/**
 * Dynamically load all command handlers
 * This will be called when the module is first required
 */
function loadCommands() {
  // Use the dynamic command loader
  const commandLoader = require('./utils/commandLoader');
  const results = commandLoader.loadCommands();

  // Log a summary of loaded commands
  if (results.count > 0) {
    logger.info(`[Commands] Successfully loaded ${results.count} command handlers`);

    // Log the names of loaded commands at debug level
    if (results.loaded.length > 0) {
      const commandNames = results.loaded.map(cmd => cmd.name).join(', ');
      logger.debug(`[Commands] Loaded commands: ${commandNames}`);
    }
  }

  // Log failed commands as warnings
  if (results.failed.length > 0) {
    logger.warn(`[Commands] Failed to load ${results.failed.length} command handlers`);
    results.failed.forEach(failure => {
      logger.warn(`[Commands] Failed to load ${failure.file}: ${failure.reason}`);
    });
  }

  return results;
}

// Initialize the command system
loadCommands();

// Export the main command processor and registry
module.exports = {
  processCommand,
  registry: commandRegistry,
  // Re-export message tracker for testing
  messageTracker: require('./utils/messageTracker'),
};
