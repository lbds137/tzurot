/**
 * Error Constants
 *
 * Error codes, messages, and error-related enums.
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
  /** Request aborted */
  ABORTED = 'ABORTED',
}

/**
 * Error messages for LLM invocation failures
 */
export const ERROR_MESSAGES = {
  /** Error message when LLM returns empty response */
  EMPTY_RESPONSE: 'LLM returned empty response',
  /** Substring to detect empty response errors */
  EMPTY_RESPONSE_INDICATOR: 'empty response',
} as const;
