/**
 * Error Handling Utilities
 *
 * Centralized error logging and handling patterns for ai-worker service.
 * Reduces duplicate error handling code across services.
 */

import type { Logger } from 'pino';

/**
 * Additional context to include in error logs
 */
type ErrorContext = Record<string, unknown>;

/**
 * Structured error details extracted from an error object
 */
interface ErrorDetails {
  errorType: string;
  errorMessage: string;
  [key: string]: unknown;
}

/**
 * Extract structured error details from an error object
 *
 * @param error - The error to extract details from
 * @param additionalContext - Optional additional context to include
 * @returns Structured error details
 */
export function createErrorDetails(error: unknown, additionalContext?: ErrorContext): ErrorDetails {
  const details: ErrorDetails = {
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
  };

  if (additionalContext) {
    Object.assign(details, additionalContext);
  }

  return details;
}

/**
 * Log an error and re-throw it
 *
 * Common pattern for logging errors before propagating them up the call stack.
 * Uses Pino's 'err' key for proper error serialization.
 *
 * @param logger - Pino logger instance
 * @param message - Log message describing the error context
 * @param error - The error to log and throw
 * @param context - Optional additional context to include in logs
 * @throws The original error
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logAndThrow(logger, '[Service] Operation failed', error, { userId: 123 });
 * }
 */
export function logAndThrow(
  logger: Logger,
  message: string,
  error: unknown,
  context?: ErrorContext
): never {
  logger.error({ err: error, ...context }, message);
  throw error;
}

/**
 * Log an error and return a fallback value
 *
 * Common pattern for graceful degradation when an operation fails.
 * Logs the error but returns a fallback value instead of throwing.
 *
 * @param logger - Pino logger instance
 * @param message - Log message describing the error context
 * @param error - The error to log
 * @param fallback - Value to return instead of throwing
 * @param context - Optional additional context to include in logs
 * @returns The fallback value
 *
 * @example
 * try {
 *   return await fetchData();
 * } catch (error) {
 *   return logAndReturnFallback(
 *     logger,
 *     '[Service] Fetch failed, using empty array',
 *     error,
 *     [],
 *     { queryId: 'abc123' }
 *   );
 * }
 */
export function logAndReturnFallback<T>(
  logger: Logger,
  message: string,
  error: unknown,
  fallback: T,
  context?: ErrorContext
): T {
  logger.error({ err: error, ...context }, message);
  return fallback;
}

/**
 * Log an error with detailed context and re-throw
 *
 * Enhanced version of logAndThrow that automatically extracts error details
 * and merges them with provided context.
 *
 * @param logger - Pino logger instance
 * @param message - Log message describing the error context
 * @param error - The error to log and throw
 * @param context - Additional context to include in logs
 * @throws The original error
 *
 * @example
 * try {
 *   await model.invoke(messages);
 * } catch (error) {
 *   logErrorWithDetails(
 *     logger,
 *     'Vision model invocation failed',
 *     error,
 *     { modelName: 'gpt-4-vision', imageCount: 3 }
 *   );
 * }
 */
export function logErrorWithDetails(
  logger: Logger,
  message: string,
  error: unknown,
  context?: ErrorContext
): never {
  const errorDetails = createErrorDetails(error, context);
  logger.error({ err: error, ...errorDetails }, message);
  throw error;
}

/**
 * Log an error with detailed context and return fallback
 *
 * Enhanced version of logAndReturnFallback that automatically extracts error details.
 *
 * @param logger - Pino logger instance
 * @param message - Log message describing the error context
 * @param error - The error to log
 * @param fallback - Value to return instead of throwing
 * @param context - Additional context to include in logs
 * @returns The fallback value
 *
 * @example
 * try {
 *   return await queryMemories(personaId);
 * } catch (error) {
 *   return logErrorWithDetailsAndFallback(
 *     logger,
 *     'Failed to query memories',
 *     error,
 *     [],
 *     { personaId, queryLength: query.length }
 *   );
 * }
 */
export function logErrorWithDetailsAndFallback<T>(
  logger: Logger,
  message: string,
  error: unknown,
  fallback: T,
  context?: ErrorContext
): T {
  const errorDetails = createErrorDetails(error, context);
  logger.error({ err: error, ...errorDetails }, message);
  return fallback;
}
