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

/**
 * Winston logger instance
 * @type {import('winston').Logger}
 * @description
 * Configured with appropriate transports based on environment:
 * - Test environment: Only console output
 * - Production environment: Console and file outputs
 *
 * File outputs include automatic rotation when files reach 5MB
 */
// Determine log level based on environment
const getLogLevel = () => {
  if (isTest) return 'error';
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (botConfig.isDevelopment) return 'debug';
  return 'info';
};

const logger = createLogger({
  level: getLogLevel(),
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports: [
    // Console output
    new transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    }),
  ],
});

// Only add file transports in non-test environments
if (!isTest) {
  // Create logs directory if it doesn't exist (only in production)
  try {
    // Use synchronous version since this only runs once at startup
    if (!require('fs').existsSync(path.join(__dirname, '..', 'logs'))) {
      require('fs').mkdirSync(path.join(__dirname, '..', 'logs'));
    }

    // Add file transports
    logger.add(
      new transports.File({
        filename: path.join(__dirname, '..', 'logs', 'tzurot.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    );

    logger.add(
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
logger.info(
  `Logger initialized with level: ${logger.level} (${botConfig.isDevelopment ? 'development' : 'production'} mode)`
);

module.exports = logger;
