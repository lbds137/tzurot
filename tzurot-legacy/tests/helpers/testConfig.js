/**
 * Test Configuration Helper
 *
 * Provides environment-aware configuration for tests to avoid hardcoding values.
 * This ensures tests work correctly in both development and production modes.
 */

const { botConfig } = require('../../config');

/**
 * Get the bot prefix for the current environment
 * @returns {string} The bot prefix (!tz for prod, !rtz for dev)
 */
function getBotPrefix() {
  return botConfig.prefix;
}

/**
 * Get the bot name for the current environment
 * @returns {string} The bot name (Tzurot for prod, Rotzot for dev)
 */
function getBotName() {
  return botConfig.name;
}

/**
 * Create a test message content with the correct prefix
 * @param {string} command - The command without prefix (e.g., 'help', 'add')
 * @param {string} args - Additional arguments (optional)
 * @returns {string} Full command with correct prefix
 */
function createTestCommand(command, args = '') {
  const prefix = getBotPrefix();
  return args ? `${prefix} ${command} ${args}` : `${prefix} ${command}`;
}

/**
 * Check if we're running in development mode
 * @returns {boolean} True if NODE_ENV === 'development'
 */
function isDevelopmentMode() {
  return botConfig.isDevelopment;
}

module.exports = {
  getBotPrefix,
  getBotName,
  createTestCommand,
  isDevelopmentMode,
  // Export config for backward compatibility
  botPrefix: getBotPrefix(),
  botName: getBotName(),
};
