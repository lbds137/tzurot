import { pino } from 'pino';
import type { Logger, LoggerOptions } from 'pino';
import { sanitizeLogMessage, sanitizeObject } from './logSanitizer.js';

/**
 * Custom error serializer that handles various error types:
 * - Standard Error instances
 * - DOMException (AbortError, etc.)
 * - Plain objects with error-like properties (ioredis errors, BullMQ serialized errors)
 * - Non-object values
 *
 * Key features:
 * - Extracts stack traces from plain objects (important for BullMQ/Redis serialized errors)
 * - Recursively serializes error.cause chains
 * - Flags non-Error objects for debugging (grep for "_nonErrorObject")
 * - Applies log sanitization to redact sensitive data like API keys
 *
 * @param err - The error to serialize (may not be an Error instance)
 * @returns Serialized error object with useful properties and sanitized content
 */
function customErrorSerializer(err: unknown): object {
  // Handle null/undefined
  if (err === null || err === undefined) {
    return { type: 'null', value: err };
  }

  // Handle non-objects (strings, numbers, etc.)
  if (typeof err !== 'object') {
    return {
      type: typeof err,
      value: typeof err === 'string' ? sanitizeLogMessage(err) : err,
    };
  }

  // At this point, err is an object (could be Error, plain object, or other)
  const errObj = err as Record<string, unknown>;
  const serialized: Record<string, unknown> = {};

  // Determine the type - use constructor name if available and meaningful
  const constructorName = errObj.constructor?.name;
  if (constructorName && constructorName !== 'Object') {
    serialized.type = constructorName;
  } else if (typeof errObj.name === 'string' && errObj.name !== '') {
    // Use 'name' property if it exists (common for error-like objects)
    serialized.type = errObj.name;
  } else {
    serialized.type = 'Object';
    // Flag plain objects for debugging (helps identify serialization issues)
    // Legitimate: BullMQ job failures, external library errors
    // Code smell: manually serializing errors before logging
    serialized._nonErrorObject = true;
  }

  // For DOMException (AbortError, etc.), only include specific properties
  // Return early to avoid including all the static constants
  if (constructorName === 'DOMException' || errObj.name === 'AbortError') {
    const domException = err as DOMException;
    serialized.name = domException.name;
    serialized.code = domException.code;
    if (typeof errObj.message === 'string') {
      serialized.message = sanitizeLogMessage(errObj.message);
    }
    return serialized;
  }

  // Extract message (works for both Error instances and plain objects)
  if (typeof errObj.message === 'string') {
    serialized.message = sanitizeLogMessage(errObj.message);
  }

  // Extract stack - IMPORTANT: include for plain objects too!
  // BullMQ/Redis serialized errors often have stack as a string property
  if (typeof errObj.stack === 'string') {
    serialized.stack = sanitizeLogMessage(errObj.stack);
  }

  // Handle cause recursively (modern error chaining)
  // Protect against circular references where cause === err
  if ('cause' in errObj && errObj.cause !== undefined) {
    serialized.cause = errObj.cause === err ? '[Circular]' : customErrorSerializer(errObj.cause);
  }

  // Properties we've already handled or will handle specially
  const handledProps = new Set(['type', 'message', 'stack', 'cause', 'name', '_nonErrorObject']);

  // Include all enumerable properties
  const keys = Object.keys(errObj);
  for (const key of keys) {
    if (handledProps.has(key)) {
      continue;
    }

    const value = errObj[key];

    // Skip functions
    if (typeof value === 'function') {
      continue;
    }

    // Sanitize strings, pass others through
    serialized[key] = typeof value === 'string' ? sanitizeLogMessage(value) : value;
  }

  // Handle non-enumerable properties common on Node.js errors
  // These are sometimes non-enumerable and missed by Object.keys
  if (err instanceof Error) {
    const commonNonEnumerable = ['code', 'errno', 'syscall', 'statusCode'];
    for (const key of commonNonEnumerable) {
      if (!(key in serialized) && key in errObj) {
        const value = errObj[key];
        if (value !== undefined && typeof value !== 'function') {
          serialized[key] = value;
        }
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
