/**
 * Command Loader - Dynamically loads command modules from the handlers directory
 */
const fs = require('fs');
const path = require('path');
const logger = require('../../logger');
const commandRegistry = require('./commandRegistry');

/**
 * Dynamically loads all command modules from the handlers directory
 * @returns {Object} An object containing the results of the loading process
 */
function loadCommands() {
  const results = {
    loaded: [],
    failed: [],
    count: 0,
  };

  try {
    // Get the handlers directory path
    const handlersPath = path.join(__dirname, '../handlers');

    // Read the files in the handlers directory
    const files = fs.readdirSync(handlersPath).filter(file => file.endsWith('.js'));

    // Load each command module
    for (const file of files) {
      try {
        const filePath = path.join(handlersPath, file);

        // Clear the require cache if the module was previously loaded
        if (require.cache[filePath]) {
          delete require.cache[filePath];
        }

        // Import the command module
        const commandModule = require(filePath);

        // Validate that it's a proper command module
        if (!commandModule.meta || !commandModule.execute) {
          logger.warn(`[CommandLoader] File ${file} is not a valid command module`);
          results.failed.push({
            file,
            reason: 'Not a valid command module (missing meta or execute)',
          });
          continue;
        }

        // Register the command
        commandRegistry.register(commandModule);

        // Add to results
        results.loaded.push({
          name: commandModule.meta.name,
          file,
        });

        logger.debug(
          `[CommandLoader] Loaded command module: ${commandModule.meta.name} from ${file}`
        );
      } catch (error) {
        logger.error(`[CommandLoader] Error loading command module from file ${file}:`, error);
        results.failed.push({
          file,
          reason: error.message,
        });
      }
    }

    // Update count
    results.count = results.loaded.length;

    logger.info(
      `[CommandLoader] Loaded ${results.count} command modules successfully (${results.failed.length} failed)`
    );
  } catch (error) {
    logger.error('[CommandLoader] Error loading command modules:', error);
  }

  return results;
}

module.exports = {
  loadCommands,
};
