/**
 * Logger module for the Tzurot Discord bot
 *
 * @module logger
 * @description
 * This module provides a centralized logging system using Winston.
 * It handles log formatting, rotation, and outputs logs to both the console
 * and files. Error logs are stored separately from general logs.
 *
 * Usage:
 * ```javascript
 * const logger = require('./logger');
 * logger.info('Server started');
 * logger.error('Failed to connect to database', error);
 * ```
 */

const path = require('path');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize } = format;
const { botConfig } = require('../config');

/**
 * Define log message format
 * @type {import('winston').Format}
 * @description
 * Creates a custom log format with timestamp, log level, and message
 */
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

// Check if we're running in a test environment
// Use JEST_WORKER_ID to detect test environment without checking NODE_ENV
const isTest = process.env.JEST_WORKER_ID !== undefined;

// Determine log level based on environment
const getLogLevel = () => {
  if (isTest) return 'error';
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (botConfig.isDevelopment) return 'debug';
  return 'info';
};

/**
 * Factory function to create a logger instance
 * @param {Object} options - Logger configuration options
 * @returns {import('winston').Logger} Winston logger instance
 */
function createLoggerInstance(options = {}) {
  const logLevel = options.level || getLogLevel();
  const enableFileLogging =
    options.enableFileLogging !== undefined ? options.enableFileLogging : !isTest;

  const loggerInstance = createLogger({
    level: logLevel,
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    transports: [
      // Console output
      new transports.Console({
        format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
      }),
    ],
  });

  // Only add file transports if enabled
  if (enableFileLogging) {
    // Create logs directory if it doesn't exist
    try {
      // Use synchronous version since this only runs once at startup
      if (!require('fs').existsSync(path.join(__dirname, '..', 'logs'))) {
        require('fs').mkdirSync(path.join(__dirname, '..', 'logs'));
      }

      // Add file transports
      loggerInstance.add(
        new transports.File({
          filename: path.join(__dirname, '..', 'logs', 'tzurot.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );

      loggerInstance.add(
        new transports.File({
          filename: path.join(__dirname, '..', 'logs', 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        })
      );
    } catch (error) {
      console.error('Error setting up file logging:', error);
    }
  }

  // Log the active log level on startup
  loggerInstance.info(
    `Logger initialized with level: ${loggerInstance.level} (${botConfig.isDevelopment ? 'development' : 'production'} mode)`
  );

  return loggerInstance;
}

// Lazy singleton getter for backward compatibility
const getInstance = (() => {
  let instance = null;
  return () => {
    if (!instance) {
      instance = createLoggerInstance();
    }
    return instance;
  };
})();

// Export factory and backward-compatible default logger
module.exports = getInstance();
module.exports.create = createLoggerInstance;
module.exports.getInstance = getInstance;
