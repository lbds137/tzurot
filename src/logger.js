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

const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, colorize } = format;

/**
 * Create logs directory if it doesn't exist
 * @type {string}
 */
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

/**
 * Define log message format
 * @type {import('winston').Format}
 * @description
 * Creates a custom log format with timestamp, log level, and message
 */
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`;
});

/**
 * Winston logger instance
 * @type {import('winston').Logger}
 * @description
 * Configured with multiple transports:
 * - Console output with colorization
 * - File output for all logs (tzurot.log)
 * - Separate file output for error logs only (error.log)
 * 
 * Both file outputs include automatic rotation when files reach 5MB
 */
const logger = createLogger({
  level: 'info',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
  transports: [
    // Console output
    new transports.Console({
      format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    }),
    // File output - general log
    new transports.File({
      filename: path.join(logsDir, 'tzurot.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // File output - error log
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
