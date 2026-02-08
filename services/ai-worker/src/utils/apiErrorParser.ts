/**
 * API Error Parser
 *
 * Parses errors from LangChain/OpenRouter API calls and extracts structured
 * error information for retry logic, user messaging, and logging.
 *
 * LangChain wraps OpenRouter API errors in various ways. This module handles:
 * - HTTP status codes from API responses
 * - Error messages containing status info
 * - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 * - OpenRouter-specific error patterns (quota, rate limit, etc.)
 *
 * @see https://openrouter.ai/docs/errors - OpenRouter error codes reference
 */

import {
  ApiErrorType,
  ApiErrorCategory,
  USER_ERROR_MESSAGES,
  TransientErrorCode,
  ERROR_MESSAGES,
  MAX_ERROR_MESSAGE_LENGTH,
  generateErrorReferenceId,
  classifyHttpStatus,
  isPermanentError,
  type ApiErrorInfo,
} from '@tzurot/common-types';

/**
 * Patterns to detect specific error types from error messages
 */
const ERROR_PATTERNS = {
  // OpenRouter quota/payment errors
  QUOTA_EXCEEDED: [
    /quota.*exceeded/i,
    /exceeded.*quota/i,
    /insufficient.*credits/i,
    /payment.*required/i,
    /billing/i,
    /daily.*limit/i,
    /50 requests per day/i,
    /free tier.*limit/i,
  ],
  // Rate limiting
  RATE_LIMIT: [/rate.*limit/i, /too many requests/i, /throttl/i, /slow down/i],
  // Authentication
  AUTHENTICATION: [
    /invalid.*api.*key/i,
    /unauthorized/i,
    /authentication.*failed/i,
    /api.*key.*invalid/i,
  ],
  // Content policy
  CONTENT_POLICY: [
    /content.*policy/i,
    /safety.*filter/i,
    /moderation/i,
    /blocked.*content/i,
    /refused.*generate/i,
  ],
  // Context window
  CONTEXT_WINDOW: [
    /context.*length/i,
    /maximum.*context/i,
    /token.*limit/i,
    /too.*long/i,
    /context.*window/i,
  ],
  // Model availability
  MODEL_NOT_FOUND: [/model.*not.*found/i, /model.*unavailable/i, /invalid.*model/i],
  // Timeout
  TIMEOUT: [/timeout/i, /timed.*out/i, /deadline.*exceeded/i],
  // Server errors
  SERVER_ERROR: [/internal.*server/i, /bad.*gateway/i, /service.*unavailable/i, /server.*error/i],
  // SDK parsing errors - LangChain fails to parse malformed API responses
  // Common with free-tier models that may return unexpected response formats
  SDK_PARSING: [
    /Cannot read properties of undefined/i,
    /Cannot read property.*of undefined/i,
    /is not a function/i,
    /unexpected end of JSON/i,
  ],
};

/**
 * Type guard to check if value is a non-null object
 * Provides proper type narrowing instead of unsafe type assertions
 */
function isErrorObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extract HTTP status code from various error object structures
 * LangChain errors may have status in different places
 */
function extractStatusCode(error: unknown): number | undefined {
  if (!isErrorObject(error)) {
    return undefined;
  }

  // Direct status property
  if (typeof error.status === 'number') {
    return error.status;
  }

  // Response object with status
  // eslint-disable-next-line sonarjs/no-collapsible-if -- Null guard before property access; collapsing reduces readability
  if (isErrorObject(error.response)) {
    if (typeof error.response.status === 'number') {
      return error.response.status;
    }
  }

  // Status in cause
  // eslint-disable-next-line sonarjs/no-collapsible-if -- Null guard before property access; collapsing reduces readability
  if (isErrorObject(error.cause)) {
    if (typeof error.cause.status === 'number') {
      return error.cause.status;
    }
  }

  // Parse status from error message (e.g., "Request failed with status code 429")
  // Cap message length to prevent ReDoS on very long error messages
  if (error instanceof Error) {
    const messageToSearch = error.message.substring(0, MAX_ERROR_MESSAGE_LENGTH);
    const statusPattern = /status(?:\s+code)?\s*[=:]?\s*(\d{3})/i;
    const statusMatch = statusPattern.exec(messageToSearch);
    if (statusMatch !== null) {
      return parseInt(statusMatch[1], 10);
    }
  }

  return undefined;
}

/**
 * Extract OpenRouter request ID from error headers for support
 */
function extractRequestId(error: unknown): string | undefined {
  if (!isErrorObject(error)) {
    return undefined;
  }

  // Check headers in response
  if (isErrorObject(error.response) && isErrorObject(error.response.headers)) {
    const headers = error.response.headers;
    // OpenRouter uses x-request-id header
    const requestId = headers['x-request-id'] ?? headers['X-Request-Id'];
    if (typeof requestId === 'string') {
      return requestId;
    }
  }

  return undefined;
}

/**
 * Detect error category from error message using pattern matching
 */
function detectCategoryFromMessage(message: string): ApiErrorCategory | null {
  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        // Map pattern key to ApiErrorCategory
        switch (category) {
          case 'QUOTA_EXCEEDED':
            return ApiErrorCategory.QUOTA_EXCEEDED;
          case 'RATE_LIMIT':
            return ApiErrorCategory.RATE_LIMIT;
          case 'AUTHENTICATION':
            return ApiErrorCategory.AUTHENTICATION;
          case 'CONTENT_POLICY':
            return ApiErrorCategory.CONTENT_POLICY;
          case 'CONTEXT_WINDOW':
            return ApiErrorCategory.BAD_REQUEST;
          case 'MODEL_NOT_FOUND':
            return ApiErrorCategory.MODEL_NOT_FOUND;
          case 'TIMEOUT':
            return ApiErrorCategory.TIMEOUT;
          case 'SERVER_ERROR':
            return ApiErrorCategory.SERVER_ERROR;
          case 'SDK_PARSING':
            // SDK parsing errors are usually transient - model returned malformed response
            return ApiErrorCategory.SERVER_ERROR;
        }
      }
    }
  }
  return null;
}

/**
 * Check if error is a network error based on error code
 */
function isNetworkError(error: unknown): boolean {
  if (!isErrorObject(error)) {
    return false;
  }

  const code = error.code;

  if (typeof code === 'string') {
    return Object.values(TransientErrorCode).includes(code as TransientErrorCode);
  }

  return false;
}

/**
 * Check if error indicates an empty or censored response
 */
function detectContentError(error: unknown): ApiErrorCategory | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes(ERROR_MESSAGES.EMPTY_RESPONSE.toLowerCase()) ||
    message.includes(ERROR_MESSAGES.EMPTY_RESPONSE_INDICATOR)
  ) {
    return ApiErrorCategory.EMPTY_RESPONSE;
  }

  if (message.includes('censored') || message.includes(ERROR_MESSAGES.CENSORED_RESPONSE_TEXT)) {
    return ApiErrorCategory.CENSORED;
  }

  return null;
}

/**
 * Parse an error from LangChain/OpenRouter and extract structured info
 *
 * @param error - The error to parse
 * @returns Structured error info for retry logic and user messaging
 *
 * @example
 * try {
 *   await model.invoke(messages);
 * } catch (error) {
 *   const errorInfo = parseApiError(error);
 *   if (!errorInfo.shouldRetry) {
 *     // Fast-fail, don't retry
 *   }
 *   // Use errorInfo.userMessage for user feedback
 *   // Use errorInfo.referenceId for support
 * }
 */
export function parseApiError(error: unknown): ApiErrorInfo {
  const referenceId = generateErrorReferenceId();
  const statusCode = extractStatusCode(error);
  const requestId = extractRequestId(error);
  const errorMessage = error instanceof Error ? error.message : String(error);

  let category: ApiErrorCategory = ApiErrorCategory.UNKNOWN;
  let type: ApiErrorType = ApiErrorType.UNKNOWN;

  // First, try to classify by HTTP status code (most reliable)
  if (statusCode !== undefined) {
    const classification = classifyHttpStatus(statusCode);
    category = classification.category;
    type = classification.type;
  }

  // If status didn't give us a specific category, check error message patterns
  if (category === ApiErrorCategory.UNKNOWN) {
    const messageCategory = detectCategoryFromMessage(errorMessage);
    if (messageCategory !== null) {
      category = messageCategory;
      type = isPermanentError(category) ? ApiErrorType.PERMANENT : ApiErrorType.TRANSIENT;
    }
  }

  // Check for content errors (empty/censored response)
  if (category === ApiErrorCategory.UNKNOWN) {
    const contentCategory = detectContentError(error);
    if (contentCategory !== null) {
      category = contentCategory;
      type = ApiErrorType.TRANSIENT; // These are retryable
    }
  }

  // Check for network errors
  if (category === ApiErrorCategory.UNKNOWN && isNetworkError(error)) {
    category = ApiErrorCategory.NETWORK;
    type = ApiErrorType.TRANSIENT;
  }

  // Determine if we should retry
  const shouldRetry = type !== ApiErrorType.PERMANENT;

  // Get user-friendly message
  const userMessage = USER_ERROR_MESSAGES[category];

  return {
    type,
    category,
    statusCode,
    userMessage,
    technicalMessage: errorMessage,
    referenceId,
    shouldRetry,
    requestId,
  };
}

/**
 * Custom error class that carries structured API error info
 */
export class ApiError extends Error {
  public readonly info: ApiErrorInfo;

  constructor(message: string, info: ApiErrorInfo) {
    super(message);
    this.name = 'ApiError';
    this.info = info;
  }

  /**
   * Create an ApiError from a caught error
   */
  static fromError(error: unknown): ApiError {
    const info = parseApiError(error);
    const message = error instanceof Error ? error.message : String(error);
    return new ApiError(message, info);
  }
}

/**
 * Check if an error should be retried based on its classification
 * Convenience function for retry logic
 */
export function shouldRetryError(error: unknown): boolean {
  const info = parseApiError(error);
  return info.shouldRetry;
}

/**
 * Get logging context for an error (safe for production logs)
 */
export function getErrorLogContext(error: unknown): Record<string, unknown> {
  const info = parseApiError(error);
  return {
    errorCategory: info.category,
    errorType: info.type,
    statusCode: info.statusCode,
    shouldRetry: info.shouldRetry,
    referenceId: info.referenceId,
    // Explicit naming to distinguish from internal job requestId
    openRouterRequestId: info.requestId,
    // Truncate technical message for logs (prevents log flooding)
    technicalMessage: info.technicalMessage?.substring(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}
