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
 * Detect classifier special cases that must run before HTTP status extraction.
 *
 * AbortError: thrown by the OpenAI SDK when LangChain's internal `timeout`
 * option fires. Has no HTTP status, and "Request was aborted" doesn't match
 * the generic TIMEOUT regex patterns, so it would otherwise fall through to
 * UNKNOWN (shouldRetry=true) and amplify into retry storms at the caller's
 * maxAttempts × timeout budget.
 */
function detectSpecialCases(error: unknown): ApiErrorCategory | null {
  // AbortError is always an Error subclass at the runtime level. If a future
  // LangChain version ever wraps the abort in a plain object, this check falls
  // through to UNKNOWN — acceptable safety behavior, but update this guard.
  if (error instanceof Error) {
    // Cap the scanned message length to match `extractStatusCode`'s ReDoS
    // prevention convention. The bounded quantifiers below make catastrophic
    // backtracking essentially impossible on their own, but keeping this
    // function consistent with the rest of the file prevents a future pattern
    // addition (e.g., one with unbounded `.*`) from accidentally regressing
    // that safety.
    const messageToSearch = error.message.substring(0, MAX_ERROR_MESSAGE_LENGTH);
    if (error.name === 'AbortError' || /request was aborted/i.test(messageToSearch)) {
      return ApiErrorCategory.TIMEOUT;
    }
    // OpenRouter/vision API wrap media-fetch 404s inside a 400 response body.
    // Must catch before status extraction so the wrapping 400 doesn't classify
    // this as retryable BAD_REQUEST.
    //
    // Observed prod variants (verified from Railway logs 2026-04-14+):
    //   "400 Received 404 when fetching URL"                        ← minimal
    //   "400 Received 404 status code when fetching URL"            ← OpenRouter variant
    //   "400 Received 404 status code when fetching image from URL" ← Google AI Studio variant
    //   "400 Received 404 when fetching image from URL"             ← plausible variant
    //
    // The regex allows up to ~40 chars between "received 404" and "fetching",
    // and up to ~30 chars between "fetching" and "url", using non-greedy
    // matching to restrict to a single error-message span. This covers every
    // observed variant without matching loosely-related content across
    // different parts of a longer error message.
    if (/received 404.{0,40}?fetching.{0,30}?url/i.test(messageToSearch)) {
      return ApiErrorCategory.MEDIA_NOT_FOUND;
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
 * Resolve category + type from error, running detection layers in priority order:
 * 1. Special cases (AbortError, media-URL 404s) — must win over HTTP status
 * 2. HTTP status classification (most reliable when no special case)
 * 3. Message pattern matching (fallback for errors without status)
 * 4. Content-specific detection (empty/censored response text)
 * 5. Network error codes (ECONNRESET, etc.)
 */
function resolveCategoryAndType(
  error: unknown,
  statusCode: number | undefined,
  errorMessage: string
): { category: ApiErrorCategory; type: ApiErrorType } {
  const specialCase = detectSpecialCases(error);
  if (specialCase !== null) {
    return {
      category: specialCase,
      type: isPermanentError(specialCase) ? ApiErrorType.PERMANENT : ApiErrorType.TRANSIENT,
    };
  }

  if (statusCode !== undefined) {
    const classification = classifyHttpStatus(statusCode);
    if (classification.category !== ApiErrorCategory.UNKNOWN) {
      return classification;
    }
  }

  const messageCategory = detectCategoryFromMessage(errorMessage);
  if (messageCategory !== null) {
    return {
      category: messageCategory,
      type: isPermanentError(messageCategory) ? ApiErrorType.PERMANENT : ApiErrorType.TRANSIENT,
    };
  }

  const contentCategory = detectContentError(error);
  if (contentCategory !== null) {
    return { category: contentCategory, type: ApiErrorType.TRANSIENT };
  }

  if (isNetworkError(error)) {
    return { category: ApiErrorCategory.NETWORK, type: ApiErrorType.TRANSIENT };
  }

  return { category: ApiErrorCategory.UNKNOWN, type: ApiErrorType.UNKNOWN };
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

  const { category, type } = resolveCategoryAndType(error, statusCode, errorMessage);

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
