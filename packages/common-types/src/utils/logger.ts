import { pino } from 'pino';
import type { Logger, LoggerOptions } from 'pino';
import { sanitizeLogMessage, sanitizeObject } from './logSanitizer.js';

/**
 * Custom error serializer that handles DOMException and other special error types.
 *
 * Pino's standard error serializer includes all enumerable properties, which causes
 * DOMException (AbortError, etc.) to log all static constants (ABORT_ERR, etc.).
 * This custom serializer only picks useful properties.
 *
 * Also applies log sanitization to redact sensitive data like API keys.
 *
 * @param err - The error to serialize
 * @returns Serialized error object with only useful properties and sanitized content
 */
function customErrorSerializer(err: Error): object {
  // Start with standard error properties (sanitize message for API keys)
  const serialized: Record<string, unknown> = {
    type: err.constructor.name,
    message: sanitizeLogMessage(err.message),
    stack: err.stack !== undefined ? sanitizeLogMessage(err.stack) : undefined,
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
        // Sanitize string values
        serialized[key] = typeof value === 'string' ? sanitizeLogMessage(value) : value;
      }
    }
  }

  return serialized;
}

/**
 * Custom object serializer that sanitizes sensitive data.
 * Used for request/response objects and general bindings.
 */
function sanitizedObjectSerializer(obj: unknown): unknown {
  return sanitizeObject(obj);
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
    // Custom serializers that sanitize sensitive data (API keys, tokens, etc.)
    serializers: {
      err: customErrorSerializer,
      req: sanitizedObjectSerializer,
      res: sanitizedObjectSerializer,
    },
    // Format hook to sanitize the final message string
    formatters: {
      log: (object: Record<string, unknown>) => {
        // Sanitize the entire log object to catch any API keys
        return sanitizeObject(object) as Record<string, unknown>;
      },
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
