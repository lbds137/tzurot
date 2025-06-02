/**
 * Utility functions for Tzurot
 * These functions are extracted from or inspired by functions in commands.js
 */

const logger = require('./logger');

// Injectable timer functions for testability
let timerFunctions = {
  setTimeout: (callback, delay, ...args) => setTimeout(callback, delay, ...args),
  clearTimeout: id => clearTimeout(id),
};

/**
 * Configure timer functions (for testing)
 * @param {Object} customTimers - Custom timer implementations
 */
function configureTimers(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

/**
 * Validates an alias to ensure it meets requirements
 * @param {string} alias - The alias to validate
 * @returns {boolean} True if the alias is valid, false otherwise
 */
function validateAlias(alias) {
  if (!alias) return false;

  // Minimum length check
  if (alias.length < 2) return false;

  // Check for invalid characters (only allow alphanumeric, dash, and underscore)
  const validPattern = /^[a-zA-Z0-9-_]+$/;
  if (!validPattern.test(alias)) return false;

  return true;
}

/**
 * Creates a timeout for cleaning up an entry with logging
 * @param {Set|Map} collection - The collection to remove the entry from
 * @param {string} key - The key to remove
 * @param {number} timeout - The timeout in milliseconds
 * @param {string} logPrefix - Logging prefix for identification
 * @returns {NodeJS.Timeout} Timeout object
 */
function cleanupTimeout(collection, key, timeout, logPrefix) {
  return timerFunctions.setTimeout(() => {
    if (collection.has(key)) {
      collection.delete(key);
      logger.info(`[${logPrefix}] Removing ${key} from collection after timeout`);
    }
  }, timeout);
}

/**
 * Helper function to safely convert a string to lowercase
 * @param {string} str - String to convert
 * @returns {string} Lowercase string or empty string if input is falsy
 */
function safeToLowerCase(str) {
  if (!str) return '';
  return String(str).toLowerCase();
}

/**
 * Creates a direct send function to avoid Discord.js bugs
 * @param {Object} message - Discord message object
 * @returns {Function} A function that safely sends messages
 */
function createDirectSend(message) {
  return async content => {
    try {
      if (typeof content === 'string') {
        return await message.channel.send(content);
      } else {
        return await message.channel.send(content);
      }
    } catch (err) {
      logger.error('Error sending message:', err);
      return null;
    }
  };
}

/**
 * Gets all aliases for a specific personality
 * @param {string} profileName - The full name of the personality
 * @param {Map} aliasMap - The map of aliases to personality names
 * @returns {Array<string>} Array of aliases for the personality
 */
function getAllAliasesForPersonality(profileName, aliasMap) {
  const aliases = [];

  if (!profileName || !aliasMap) return aliases;

  // Look through all aliases for those pointing to this personality
  for (const [alias, target] of aliasMap.entries()) {
    if (target === profileName) {
      aliases.push(alias);
    }
  }

  return aliases;
}

module.exports = {
  validateAlias,
  cleanupTimeout,
  safeToLowerCase,
  createDirectSend,
  getAllAliasesForPersonality,
  configureTimers,
};
