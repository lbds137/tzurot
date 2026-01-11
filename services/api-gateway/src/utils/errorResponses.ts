/**
 * Error Response Utilities
 *
 * Centralized error response creation to ensure consistency across all API endpoints.
 * Eliminates duplicate error response code and provides type-safe error handling.
 */

import type { ErrorResponse } from '../types.js';

// Re-export ErrorResponse for use in other utilities
export type { ErrorResponse };

/**
 * Standard error codes used across the API
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  JOB_FAILED = 'JOB_FAILED',
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  SYNC_ERROR = 'SYNC_ERROR',
  METRICS_ERROR = 'METRICS_ERROR',
}

/**
 * HTTP status codes for each error type
 */
const ERROR_STATUS_CODES: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 403,
  [ErrorCode.PAYMENT_REQUIRED]: 402,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.CONFIGURATION_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.JOB_FAILED]: 500,
  [ErrorCode.JOB_NOT_FOUND]: 404,
  [ErrorCode.PROCESSING_ERROR]: 500,
  [ErrorCode.SYNC_ERROR]: 500,
  [ErrorCode.METRICS_ERROR]: 500,
};

/**
 * Create a standardized error response object
 *
 * @param errorCode - The error code (from ErrorCode enum)
 * @param message - Human-readable error message
 * @param requestId - Optional request ID for tracking
 * @returns ErrorResponse object with timestamp
 */
export function createErrorResponse(
  errorCode: ErrorCode,
  message: string,
  requestId?: string
): ErrorResponse {
  return {
    error: errorCode,
    message,
    ...(requestId !== undefined && requestId.length > 0 && { requestId }),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the HTTP status code for an error code
 *
 * @param errorCode - The error code
 * @returns HTTP status code (default 500 if unknown)
 */
export function getStatusCode(errorCode: ErrorCode): number {
  return ERROR_STATUS_CODES[errorCode] ?? 500;
}

/**
 * Create error response from an exception
 *
 * @param error - The caught error
 * @param fallbackMessage - Message to use if error doesn't have one
 * @param requestId - Optional request ID for tracking
 * @returns ErrorResponse object
 */
export function createErrorFromException(
  error: unknown,
  fallbackMessage = 'An unexpected error occurred',
  requestId?: string
): ErrorResponse {
  const message = error instanceof Error ? error.message : fallbackMessage;

  return createErrorResponse(ErrorCode.INTERNAL_ERROR, message, requestId);
}

/**
 * Common error response creators for frequently used errors
 */
export const ErrorResponses = {
  validationError: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.VALIDATION_ERROR, message, requestId),

  unauthorized: (
    message = 'This endpoint is only available to the bot owner',
    requestId?: string
  ) => createErrorResponse(ErrorCode.UNAUTHORIZED, message, requestId),

  forbidden: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.UNAUTHORIZED, message, requestId),

  paymentRequired: (message = 'Insufficient credits or quota', requestId?: string) =>
    createErrorResponse(ErrorCode.PAYMENT_REQUIRED, message, requestId),

  notFound: (resource: string, requestId?: string) =>
    createErrorResponse(ErrorCode.NOT_FOUND, `${resource} not found`, requestId),

  conflict: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.CONFLICT, message, requestId),

  internalError: (message = 'An internal error occurred', requestId?: string) =>
    createErrorResponse(ErrorCode.INTERNAL_ERROR, message, requestId),

  configurationError: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.CONFIGURATION_ERROR, message, requestId),

  serviceUnavailable: (message = 'Service temporarily unavailable', requestId?: string) =>
    createErrorResponse(ErrorCode.SERVICE_UNAVAILABLE, message, requestId),

  jobFailed: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.JOB_FAILED, message, requestId),

  jobNotFound: (jobId: string, requestId?: string) =>
    createErrorResponse(ErrorCode.JOB_NOT_FOUND, `Job ${jobId} not found`, requestId),

  processingError: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.PROCESSING_ERROR, message, requestId),

  syncError: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.SYNC_ERROR, message, requestId),

  metricsError: (message: string, requestId?: string) =>
    createErrorResponse(ErrorCode.METRICS_ERROR, message, requestId),
};
