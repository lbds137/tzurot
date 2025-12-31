import { pino } from 'pino';
import type { Logger, LoggerOptions } from 'pino';
import { sanitizeLogMessage, sanitizeObject } from './logSanitizer.js';

/**
 * Error Serialization Pipeline
 * ============================
 *
 * The customErrorSerializer handles various error types through a pipeline of helpers:
 *
 *   customErrorSerializer(err)
 *          │
 *          ├─► serializeNonObject(err)     → Returns early for null/undefined/primitives
 *          │
 *          ├─► determineErrorType(errObj)  → Identifies type from constructor/name property
 *          │
 *          ├─► [if DOMException]
 *          │       └─► serializeDOMException() → Returns early with minimal props
 *          │
 *          └─► [else standard object]
 *                  ├─► extractStandardProps()  → message, stack, cause (recursive)
 *                  └─► extractExtraProps()     → enumerable + Node.js non-enumerable props
 *
 * All string values are sanitized via sanitizeLogMessage() to redact API keys.
 */

/**
 * Serialize non-object values (null, undefined, primitives)
 */
function serializeNonObject(err: unknown): object | null {
  if (err === null || err === undefined) {
    return { type: 'null', value: err };
  }
  if (typeof err !== 'object') {
    return {
      type: typeof err,
      value: typeof err === 'string' ? sanitizeLogMessage(err) : err,
    };
  }
  return null;
}

/**
 * Determine the error type from constructor name or name property
 */
function determineErrorType(errObj: Record<string, unknown>): {
  type: string;
  isPlainObject: boolean;
} {
  const constructorName = errObj.constructor?.name;
  if (constructorName !== undefined && constructorName !== 'Object') {
    return { type: constructorName, isPlainObject: false };
  }
  if (typeof errObj.name === 'string' && errObj.name !== '') {
    return { type: errObj.name, isPlainObject: false };
  }
  return { type: 'Object', isPlainObject: true };
}

/**
 * Serialize DOMException (AbortError, etc.) with only useful properties
 */
function serializeDOMException(
  err: unknown,
  errObj: Record<string, unknown>,
  baseProps: Record<string, unknown>
): object {
  const domException = err as DOMException;
  const serialized = { ...baseProps, name: domException.name, code: domException.code };
  if (typeof errObj.message === 'string') {
    (serialized as Record<string, unknown>).message = sanitizeLogMessage(errObj.message);
  }
  return serialized;
}

/** Properties already handled by standard extraction */
const HANDLED_PROPS = new Set(['type', 'message', 'stack', 'cause', 'name', '_nonErrorObject']);

/** Non-enumerable properties common on Node.js errors */
const NODE_ERROR_PROPS = ['code', 'errno', 'syscall', 'statusCode'];

/**
 * Extract standard error properties (message, stack, cause)
 */
function extractStandardProps(
  err: unknown,
  errObj: Record<string, unknown>,
  serialized: Record<string, unknown>
): void {
  if (typeof errObj.message === 'string') {
    serialized.message = sanitizeLogMessage(errObj.message);
  }
  if (typeof errObj.stack === 'string') {
    serialized.stack = sanitizeLogMessage(errObj.stack);
  }
  if ('cause' in errObj && errObj.cause !== undefined) {
    serialized.cause = errObj.cause === err ? '[Circular]' : customErrorSerializer(errObj.cause);
  }
}

/**
 * Extract enumerable and non-enumerable properties
 */
function extractExtraProps(
  err: unknown,
  errObj: Record<string, unknown>,
  serialized: Record<string, unknown>
): void {
  // Enumerable properties
  for (const key of Object.keys(errObj)) {
    if (HANDLED_PROPS.has(key)) {
      continue;
    }
    const value = errObj[key];
    if (typeof value === 'function') {
      continue;
    }
    serialized[key] = typeof value === 'string' ? sanitizeLogMessage(value) : value;
  }

  // Non-enumerable properties on Error instances
  if (err instanceof Error) {
    for (const key of NODE_ERROR_PROPS) {
      if (!(key in serialized) && key in errObj) {
        const value = errObj[key];
        if (value !== undefined && typeof value !== 'function') {
          serialized[key] = value;
        }
      }
    }
  }
}

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
  // Handle non-objects (null, undefined, primitives)
  const nonObjectResult = serializeNonObject(err);
  if (nonObjectResult !== null) {
    return nonObjectResult;
  }

  const errObj = err as Record<string, unknown>;
  const { type, isPlainObject } = determineErrorType(errObj);
  const serialized: Record<string, unknown> = { type };

  if (isPlainObject) {
    serialized._nonErrorObject = true;
  }

  // DOMException special handling - return early
  const constructorName = errObj.constructor?.name;
  if (constructorName === 'DOMException' || errObj.name === 'AbortError') {
    return serializeDOMException(err, errObj, serialized);
  }

  extractStandardProps(err, errObj, serialized);
  extractExtraProps(err, errObj, serialized);

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
