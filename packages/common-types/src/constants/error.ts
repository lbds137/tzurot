/**
 * Error Constants
 *
 * Error codes, messages, error classification, and user-friendly messaging.
 *
 * This module provides:
 * - Error classification (transient vs permanent)
 * - HTTP status code mapping
 * - User-friendly error messages
 * - Error reference ID generation
 */

/**
 * Transient network error codes that should trigger retries
 */
export enum TransientErrorCode {
  /** Connection reset by peer */
  ECONNRESET = 'ECONNRESET',
  /** Connection timed out */
  ETIMEDOUT = 'ETIMEDOUT',
  /** DNS lookup failed */
  ENOTFOUND = 'ENOTFOUND',
  /** Connection refused */
  ECONNREFUSED = 'ECONNREFUSED',
}

/**
 * Error names for transient errors
 */
export const ERROR_NAMES = {
  /** DOMException thrown by AbortController when operation times out */
  ABORT_ERROR: 'AbortError',
} as const;

/**
 * Error messages for LLM invocation failures
 */
export const ERROR_MESSAGES = {
  /** Error message when LLM returns empty response */
  EMPTY_RESPONSE: 'LLM returned empty response',
  /** Substring to detect empty response errors */
  EMPTY_RESPONSE_INDICATOR: 'empty response',
  /** Error message when LLM censors response (Gemini models via OpenRouter) */
  CENSORED_RESPONSE: 'LLM censored response (returned "ext") - this may succeed on retry',
  /** Response text that indicates censorship */
  CENSORED_RESPONSE_TEXT: 'ext',
} as const;

/**
 * Maximum length of error messages in logs
 * Prevents log flooding and stays within Railway log size limits
 */
export const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Classification of API errors for retry logic
 */
export enum ApiErrorType {
  /** Transient errors that should be retried (network issues, temporary overload) */
  TRANSIENT = 'transient',
  /** Permanent errors that should NOT be retried (auth, quota, invalid request) */
  PERMANENT = 'permanent',
  /** Unknown errors - treat as transient for safety */
  UNKNOWN = 'unknown',
}

/**
 * Specific error categories for user messaging and logging
 */
export enum ApiErrorCategory {
  /** 401 - Invalid or missing API key */
  AUTHENTICATION = 'authentication',
  /** 402 - Payment required / quota exceeded / daily limit */
  QUOTA_EXCEEDED = 'quota_exceeded',
  /** 403 - Content policy violation or forbidden */
  CONTENT_POLICY = 'content_policy',
  /** 400 - Bad request (context window exceeded, invalid params) */
  BAD_REQUEST = 'bad_request',
  /** 404 - Model not found */
  MODEL_NOT_FOUND = 'model_not_found',
  /** 429 - Rate limit (may be temporary or daily) */
  RATE_LIMIT = 'rate_limit',
  /** 500/502/503/504 - Server errors */
  SERVER_ERROR = 'server_error',
  /** Timeout errors */
  TIMEOUT = 'timeout',
  /** Network errors (connection refused, reset, etc.) */
  NETWORK = 'network',
  /** Empty or invalid response from API */
  EMPTY_RESPONSE = 'empty_response',
  /** Content was censored/filtered by the model */
  CENSORED = 'censored',
  /** Unknown error type */
  UNKNOWN = 'unknown',
}

/**
 * User-friendly error messages for each category
 * These are shown to users when no personality-specific error message is configured
 */
export const USER_ERROR_MESSAGES: Record<ApiErrorCategory, string> = {
  [ApiErrorCategory.AUTHENTICATION]:
    "There's an issue with the API key configuration. Please check your wallet settings or contact support.",
  [ApiErrorCategory.QUOTA_EXCEEDED]:
    "You've reached your API usage limit. Please add credits to your OpenRouter account or wait until your limit resets.",
  [ApiErrorCategory.CONTENT_POLICY]:
    'The AI declined to respond due to content guidelines. Please try rephrasing your message.',
  [ApiErrorCategory.BAD_REQUEST]:
    'The conversation has become too long. Please start a new conversation or try a shorter message.',
  [ApiErrorCategory.MODEL_NOT_FOUND]:
    'The requested AI model is not available. Please try again or use a different personality.',
  [ApiErrorCategory.RATE_LIMIT]:
    "I'm receiving too many requests right now. Please wait a moment and try again.",
  [ApiErrorCategory.SERVER_ERROR]:
    'The AI service is experiencing issues. Please try again in a moment.',
  [ApiErrorCategory.TIMEOUT]:
    'The response took too long to generate. Please try again with a simpler message.',
  [ApiErrorCategory.NETWORK]:
    'There was a network issue connecting to the AI service. Please try again.',
  [ApiErrorCategory.EMPTY_RESPONSE]:
    "I couldn't generate a response. Please try rephrasing your message.",
  [ApiErrorCategory.CENSORED]: 'The AI filtered its response. Please try rephrasing your message.',
  [ApiErrorCategory.UNKNOWN]: 'Something went wrong while generating a response. Please try again.',
};

/**
 * Mapping of HTTP status codes to error categories
 */
export const HTTP_STATUS_TO_CATEGORY: Record<number, ApiErrorCategory> = {
  400: ApiErrorCategory.BAD_REQUEST,
  401: ApiErrorCategory.AUTHENTICATION,
  402: ApiErrorCategory.QUOTA_EXCEEDED,
  403: ApiErrorCategory.CONTENT_POLICY,
  404: ApiErrorCategory.MODEL_NOT_FOUND,
  429: ApiErrorCategory.RATE_LIMIT,
  500: ApiErrorCategory.SERVER_ERROR,
  502: ApiErrorCategory.SERVER_ERROR,
  503: ApiErrorCategory.SERVER_ERROR,
  504: ApiErrorCategory.SERVER_ERROR,
};

/**
 * Categories that should NOT trigger retries (permanent errors)
 */
export const PERMANENT_ERROR_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.AUTHENTICATION,
  ApiErrorCategory.QUOTA_EXCEEDED,
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.BAD_REQUEST,
  ApiErrorCategory.MODEL_NOT_FOUND,
]);

/**
 * Categories that SHOULD trigger retries (transient errors)
 */
export const TRANSIENT_ERROR_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.RATE_LIMIT,
  ApiErrorCategory.SERVER_ERROR,
  ApiErrorCategory.TIMEOUT,
  ApiErrorCategory.NETWORK,
  ApiErrorCategory.EMPTY_RESPONSE,
  ApiErrorCategory.CENSORED,
]);

/**
 * Structured error info for consistent error handling
 */
export interface ApiErrorInfo {
  /** Error type for retry logic */
  type: ApiErrorType;
  /** Specific error category */
  category: ApiErrorCategory;
  /** HTTP status code if available */
  statusCode?: number;
  /** User-friendly message */
  userMessage: string;
  /** Technical details for logging */
  technicalMessage: string;
  /** Unique reference ID for support */
  referenceId: string;
  /** Whether this error should be retried */
  shouldRetry: boolean;
  /** OpenRouter request ID if available (for support) */
  requestId?: string;
}

/**
 * Generate a unique error reference ID
 * Format: base36 timestamp + random suffix (e.g., "m5abc123")
 */
export function generateErrorReferenceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 5);
  return `${timestamp}${random}`;
}

/**
 * Classify an HTTP status code into error type and category
 */
export function classifyHttpStatus(statusCode: number): {
  type: ApiErrorType;
  category: ApiErrorCategory;
} {
  const category = HTTP_STATUS_TO_CATEGORY[statusCode] ?? ApiErrorCategory.UNKNOWN;

  if (PERMANENT_ERROR_CATEGORIES.has(category)) {
    return { type: ApiErrorType.PERMANENT, category };
  }

  if (TRANSIENT_ERROR_CATEGORIES.has(category)) {
    return { type: ApiErrorType.TRANSIENT, category };
  }

  return { type: ApiErrorType.UNKNOWN, category };
}

/**
 * Check if an error category is permanent (should not retry)
 */
export function isPermanentError(category: ApiErrorCategory): boolean {
  return PERMANENT_ERROR_CATEGORIES.has(category);
}

/**
 * Check if an error category is transient (should retry)
 */
export function isTransientError(category: ApiErrorCategory): boolean {
  return TRANSIENT_ERROR_CATEGORIES.has(category);
}

/**
 * Generic spoiler pattern for error details
 * Matches: ||*(some text)*||
 * Note: Character class excludes | and ) to prevent ReDoS on nested ||*( sequences
 * Length limited to 500 chars (matches MAX_ERROR_MESSAGE_LENGTH) for additional safety
 */
export const ERROR_SPOILER_PATTERN = /\|\|\*\(([^)|]{1,500})\)\*\|\|/;

/**
 * Format error details for Discord spoiler tags
 * @param category - Error category for context
 * @param referenceId - Unique reference ID
 * @returns Formatted spoiler text
 */
export function formatErrorSpoiler(category: ApiErrorCategory, referenceId: string): string {
  const categoryLabel = category.replace(/_/g, ' ');
  return `||*(error: ${categoryLabel}; reference: ${referenceId})*||`;
}

/**
 * Format personality error message with error details appended
 *
 * @param personalityMessage - The personality's configured error message
 * @param category - Error category
 * @param referenceId - Unique reference ID
 * @returns Message with error details in spoiler tags
 */
export function formatPersonalityErrorMessage(
  personalityMessage: string,
  category: ApiErrorCategory,
  referenceId: string
): string {
  const spoilerContent = formatErrorSpoiler(category, referenceId);

  // Cap message length to prevent abuse
  const safeMessage = personalityMessage.substring(0, MAX_ERROR_MESSAGE_LENGTH);

  return `${safeMessage} ${spoilerContent}`;
}

/**
 * Strip error spoiler from message for conversation history
 *
 * Removes the error spoiler (||*(error details)*||) from the end of error messages
 * so the character remembers an error occurred but doesn't see technical details.
 *
 * @param message - Error message possibly containing spoiler tags
 * @returns Message with error spoiler removed (trimmed)
 *
 * @example
 * stripErrorSpoiler("Oops! ||*(error: timeout; reference: abc123)*||")
 * // Returns: "Oops!"
 */
export function stripErrorSpoiler(message: string): string {
  // Remove the error spoiler pattern and trim whitespace
  return message.replace(ERROR_SPOILER_PATTERN, '').trim();
}
