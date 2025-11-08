import { pino } from 'pino';
import type { Logger, LoggerOptions } from 'pino';

/**
 * Creates a logger instance with environment-aware configuration.
 * Uses pino-pretty transport ONLY when explicitly enabled via ENABLE_PRETTY_LOGS=true.
 * Defaults to plain JSON logging for production compatibility.
 *
 * ⚠️ IMPORTANT: Error Logging Format
 *
 * When logging errors, you MUST use this format:
 *
 * ✅ CORRECT:
 *   logger.error({ err: error }, 'Description of what failed');
 *   logger.warn({ err: error }, 'Warning message');
 *
 * ❌ WRONG (will not serialize error properly):
 *   logger.error('Description:', error);
 *   logger.error('Description', error);
 *
 * The { err: error } format enables pino's error serialization, which includes:
 * - error.message
 * - error.stack
 * - error.type
 * - Any custom properties on the error object
 *
 * ESLint Rule: no-restricted-syntax enforces this pattern in eslint.config.js
 */
export function createLogger(name?: string): Logger {
  const usePrettyLogs = process.env.ENABLE_PRETTY_LOGS === 'true';

  const config: LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    name,
    // Enable error serialization - pino will automatically serialize Error objects
    // when passed with the 'err' key: logger.error({ err: error }, 'message')
    serializers: {
      // @ts-expect-error - stdSerializers exists at runtime in Pino 10 but types are incomplete
      err: pino.stdSerializers.err,
    },
  };

  // Only use pino-pretty when explicitly enabled (requires pino-pretty to be installed)
  if (usePrettyLogs) {
    config.transport = {
      target: 'pino-pretty',
      options: { colorize: true },
    };
  }

  return pino(config);
}
