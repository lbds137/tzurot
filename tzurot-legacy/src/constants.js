/**
 * Constants used throughout the Tzurot Discord bot
 *
 * @module constants
 * @description
 * This module centralizes constant values used across multiple files
 * to improve maintainability and consistency. It defines timeouts,
 * durations, limits, and error patterns in one place.
 */

/**
 * Timeouts and Durations
 * @typedef {Object} TimeConstants
 * @property {number} ONE_MINUTE - 60 seconds in milliseconds
 * @property {number} FIVE_MINUTES - 5 minutes in milliseconds
 * @property {number} TEN_MINUTES - 10 minutes in milliseconds
 * @property {number} ONE_HOUR - 1 hour in milliseconds
 * @property {number} ONE_DAY - 24 hours in milliseconds
 * @property {number} ERROR_BLACKOUT_DURATION - Duration to block requests after an error
 * @property {number} CACHE_DURATION - Duration to cache profile information
 * @property {number} CONVERSATION_TIMEOUT - Duration before a conversation is considered stale
 * @property {number} MESSAGE_CACHE_TIMEOUT - Duration to cache message information
 * @property {number} MIN_MESSAGE_DELAY - Minimum delay between messages
 * @property {number} MAX_ERROR_WAIT_TIME - Maximum time to wait for error response
 * @property {number} EMBED_DEDUPLICATION_WINDOW - Time window for embed deduplication
 * @type {TimeConstants}
 */
exports.TIME = {
  // General timeouts
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,

  // Specific durations
  ERROR_BLACKOUT_DURATION: 30 * 1000, // 30 seconds
  CACHE_DURATION: 24 * 60 * 60 * 1000, // 24 hours
  CONVERSATION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  MESSAGE_CACHE_TIMEOUT: 10 * 60 * 1000, // 10 minutes
  MIN_MESSAGE_DELAY: 3000, // 3 seconds
  MAX_ERROR_WAIT_TIME: 15000, // 15 seconds
  EMBED_DEDUPLICATION_WINDOW: 5000, // 5 seconds
};

/**
 * Discord platform limits
 * @typedef {Object} DiscordLimits
 * @property {number} MESSAGE_CHAR_LIMIT - Maximum characters allowed in a message
 * @property {number} USERNAME_CHAR_LIMIT - Maximum characters allowed in a username
 * @property {number} MAX_EMBED_FIELDS - Maximum number of fields in an embed
 * @type {DiscordLimits}
 */
exports.DISCORD = {
  MESSAGE_CHAR_LIMIT: 2000,
  USERNAME_CHAR_LIMIT: 32,
  MAX_EMBED_FIELDS: 25,
};

/**
 * Special markers and flags used throughout the application
 * @typedef {Object} Markers
 * @property {string} BOT_ERROR_MESSAGE - Prefix for error messages that should come from the bot, not the personality
 * @type {Markers}
 */
exports.MARKERS = {
  BOT_ERROR_MESSAGE: 'BOT_ERROR_MESSAGE:',
};

/**
 * Fallback and default values used when required data is missing
 * @typedef {Object} DefaultValues
 * @property {string} ANONYMOUS_USER - Default user ID when none is provided
 * @property {string} NO_CHANNEL - Default channel ID when none is provided
 * @property {string} DEFAULT_PROMPT - Default message when none is provided
 * @property {string} DEFAULT_LOG_LEVEL - Default logging level
 * @type {DefaultValues}
 */
exports.DEFAULTS = {
  ANONYMOUS_USER: 'anon',
  NO_CHANNEL: 'nochannel',
  DEFAULT_PROMPT: 'Hello',
  DEFAULT_LOG_LEVEL: 'info',
};

/**
 * Predefined user configurations for personalities and settings
 * @typedef {Object} UserConfig
 * @property {string} OWNER_ID - Discord user ID of the bot owner (from environment variable BOT_OWNER_ID)
 * @property {string} OWNER_PERSONALITIES_LIST - Comma-separated list of personality names to add for the owner (from environment variable BOT_OWNER_PERSONALITIES)
 * @type {UserConfig}
 */
exports.USER_CONFIG = {
  // Bot owner user ID - loaded from environment variables
  // Set BOT_OWNER_ID in your .env file
  OWNER_ID: process.env.BOT_OWNER_ID || '123456789012345678', // Fallback ID for development

  // Pre-seeded personalities for the owner - loaded from environment variables
  // Set BOT_OWNER_PERSONALITIES in your .env file as a comma-separated list
  // Example: "albert-einstein,sigmund-freud,carl-jung,marie-curie"
  // The bot will automatically detect each personality's display name and set up proper aliases
  OWNER_PERSONALITIES_LIST:
    process.env.BOT_OWNER_PERSONALITIES || 'albert-einstein,sigmund-freud,carl-jung,marie-curie', // Default personalities for development
};
