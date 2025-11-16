import { pino } from 'pino';
import type { Logger, LoggerOptions } from 'pino';

/**
 * Custom error serializer that handles DOMException and other special error types.
 *
 * Pino's standard error serializer includes all enumerable properties, which causes
 * DOMException (AbortError, etc.) to log all static constants (ABORT_ERR, etc.).
 * This custom serializer only picks useful properties.
 *
 * @param err - The error to serialize
 * @returns Serialized error object with only useful properties
 */
function customErrorSerializer(err: Error): object {
  // Start with standard error properties
  const serialized: Record<string, unknown> = {
    type: err.constructor.name,
    message: err.message,
    stack: err.stack,
  };

  // For DOMException (AbortError, etc.), only include specific properties
  if (err.constructor.name === 'DOMException' || err.name === 'AbortError') {
    const domException = err as DOMException;
    serialized.name = domException.name;
    serialized.code = domException.code;
    // Don't include static constants like ABORT_ERR, DATA_CLONE_ERR, etc.
    return serialized;
  }

  // For other errors, include any custom properties but filter out functions
  for (const key in err) {
    if (Object.prototype.hasOwnProperty.call(err, key)) {
      const value = (err as unknown as Record<string, unknown>)[key];
      // Skip functions and standard properties we already included
      if (typeof value !== 'function' && !['message', 'stack', 'name'].includes(key)) {
        serialized[key] = value;
      }
    }
  }

  return serialized;
}

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
 * Special handling for DOMException (AbortError):
 * - Only includes useful properties (name, code, message, stack)
 * - Filters out static constants (ABORT_ERR, DATA_CLONE_ERR, etc.)
 *
 * ESLint Rule: no-restricted-syntax enforces this pattern in eslint.config.js
 */
export function createLogger(name?: string): Logger {
  const usePrettyLogs = process.env.ENABLE_PRETTY_LOGS === 'true';

  const config: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? 'info',
    name,
    // Custom error serializer that handles DOMException properly
    serializers: {
      err: customErrorSerializer,
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
