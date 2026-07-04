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
} from '@tzurot/common-types/constants/error';
import { type ApiErrorInfo } from '@tzurot/common-types/types/schemas/generation';

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
    // ReDoS defense: bounded `\s` quantifiers prevent adjacent-group backtracking; real status messages have ≤2 spaces.
    const statusPattern = /status(?:\s{1,8}code)?\s{0,8}[=:]?\s{0,8}(\d{3})/i;
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
 * Pull a header value out of a header bag using a case-insensitive lookup.
 * OpenRouter (and the OpenAI SDK that wraps it) inconsistently lowercases
 * header keys depending on the response path; treat both forms as equivalent.
 */
function lookupHeaderCaseInsensitive(
  headers: Record<string, unknown>,
  name: string
): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract `X-RateLimit-Reset` (Unix milliseconds) from a 429 error.
 *
 * The OpenAI SDK nests headers in two known shapes:
 * - `error.response.headers` — when the SDK populated the response object
 * - `error.error.metadata.headers` — when OpenRouter forwarded the upstream
 *   provider's headers via its standard error envelope (most common path)
 *
 * Returns undefined when no reset header is present (e.g., per-minute rate
 * limits without daily-quota framing) or when the value isn't parseable.
 */
function extractRateLimitResetMs(error: unknown): number | undefined {
  if (!isErrorObject(error)) {
    return undefined;
  }

  let resetRaw: string | undefined;

  // Path precedence: SDK-populated `response.headers` is checked before the
  // OpenRouter envelope, so a value present in both is read from Path 1. The
  // envelope (Path 2) is the more common production path for OpenRouter 429s,
  // but Path 1 winning when both are populated is intentional — the SDK shape
  // is the canonical one when the SDK has parsed the response, and we should
  // prefer what the SDK saw to what OpenRouter forwarded.

  // Path 1: error.response.headers (SDK-populated response object)
  if (isErrorObject(error.response) && isErrorObject(error.response.headers)) {
    resetRaw = lookupHeaderCaseInsensitive(error.response.headers, 'X-RateLimit-Reset');
  }

  // Path 2: error.error.metadata.headers (OpenRouter envelope — most common production path)
  if (
    resetRaw === undefined &&
    isErrorObject(error.error) &&
    isErrorObject(error.error.metadata) &&
    isErrorObject(error.error.metadata.headers)
  ) {
    resetRaw = lookupHeaderCaseInsensitive(error.error.metadata.headers, 'X-RateLimit-Reset');
  }

  if (resetRaw === undefined) {
    return undefined;
  }

  const parsed = parseInt(resetRaw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return undefined;
  }

  // Normalize to milliseconds. The HTTP convention for `X-RateLimit-Reset` is
  // **seconds** (10-digit Unix epoch, e.g., `1745961600`), but OpenRouter's
  // `:free` daily-quota responses ship **milliseconds** (13-digit, e.g.,
  // `1777507200000`). Detect by magnitude: anything below ~1e11 is too small
  // to be a year-2026+ ms timestamp, so treat as seconds and multiply.
  // Threshold of 1e11 = year 5138 if interpreted as seconds, year 1973 if
  // interpreted as ms — well clear of any plausible production timestamp.
  const SECONDS_TO_MS_THRESHOLD = 1e11;
  return parsed < SECONDS_TO_MS_THRESHOLD ? parsed * 1000 : parsed;
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
 * Detect whether a 402 error represents **account-level credit exhaustion**
 * (the BYOK key/account has zero credits) versus **request-level affordability**
 * (the request exceeds what the remaining balance allows). The two are
 * structurally similar (both 402, both QUOTA_EXCEEDED-classifiable) but have
 * different remediations:
 *
 * - **Account-level**: user must top up at the provider. Cacheable — every
 *   subsequent request from the same account will fail the same way until the
 *   account is funded. Pattern: `"Insufficient credits..."` /
 *   `"never purchased credits"` without a "can only afford N" qualifier.
 * - **Request-level**: the same account could succeed with a smaller request
 *   (`max_tokens` reduced). NOT cacheable — different requests have different
 *   token budgets. Pattern: `"requested up to N tokens, but can only afford M"`.
 *
 * Conservative default: when the message is ambiguous (matches neither pattern
 * cleanly), return `false`. Wrong-positive cost (caching a request-level 402 →
 * blocking smaller-request retries for up to 24h) outweighs wrong-negative cost
 * (missing a cache opportunity → ~70-440ms extra OpenRouter ping per request).
 *
 * Used by `parseApiError` to override the default 402 → QUOTA_EXCEEDED routing
 * with `CREDIT_EXHAUSTION` when the account-level signature matches.
 */
export function isAccountCreditExhaustion(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  // Request-level signature: "can only afford" or "requested up to N tokens"
  // appears in the message body. Both indicate the request, not the account,
  // is the issue. Even if "Insufficient credits" also appears, the qualifier
  // wins — the request can succeed with a smaller token budget.
  const requestLevel = /can only afford/i.test(message) || /requested up to.*tokens/i.test(message);
  if (requestLevel) {
    return false;
  }

  // Account-level signature: "never purchased credits" is unambiguous
  // (OpenRouter's verbatim language for accounts that never funded). Falls
  // back to "insufficient credits" when the verbatim phrase isn't present
  // and the request-level qualifier is absent.
  return /never purchased credits/i.test(message) || /insufficient.*credits/i.test(message);
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
    //
    // Bound calibration: the widest observed gap between "received 404" and
    // "fetching" in the four documented prod variants is `" status code when "`
    // (~18 chars). The `{0,40}` bound gives ~2.2× headroom, and `{0,30}`
    // between "fetching" and "url" covers `" image from "` (~12 chars) with
    // ~2.5× headroom. If a future provider variant has wider filler text,
    // tighten the bounds only after confirming the new max-gap; loosening
    // beyond ~50 chars starts to risk false matches on compound error
    // messages that mention both 404s and URLs in unrelated clauses.
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

  const resolved = resolveCategoryAndType(error, statusCode, errorMessage);
  // Sub-classify 402s: account-level credit exhaustion gets its own category
  // (CREDIT_EXHAUSTION) so the user-facing message can be sharper (top-up URL)
  // and `LLMInvoker` can write to a dedicated cache that fast-fails subsequent
  // requests from the same account until TTL expiry. Request-level 402s ("can
  // only afford N tokens") stay as QUOTA_EXCEEDED — they're per-request, not
  // per-account, so caching would block valid smaller-budget retries.
  const category =
    statusCode === 402 &&
    resolved.category === ApiErrorCategory.QUOTA_EXCEEDED &&
    isAccountCreditExhaustion(error)
      ? ApiErrorCategory.CREDIT_EXHAUSTION
      : resolved.category;
  const { type } = resolved;

  // Determine if we should retry
  const shouldRetry = type !== ApiErrorType.PERMANENT;

  // Get user-friendly message
  const userMessage = USER_ERROR_MESSAGES[category];

  // Reset header is only meaningful for rate-limit responses; populating it
  // for other categories would invite consumers to wait for irrelevant
  // timestamps that may have been carried over from upstream noise.
  //
  // **Intentionally excludes QUOTA_EXCEEDED.** OpenRouter routes
  // `daily.*limit/i` and `free tier.*limit/i` patterns to QUOTA_EXCEEDED
  // (classified PERMANENT). A "reset window" timestamp implies a
  // time-bounded transient block; QUOTA_EXCEEDED is a hard limit that
  // doesn't correspond to a wait-and-retry semantics. If OpenRouter ever
  // rephrases the daily-quota response in a way that makes it land in
  // QUOTA_EXCEEDED, the rate-limit cache would correctly NOT cache it —
  // the error is a permanent state for that key+window, not a transient
  // retry opportunity. The test in apiErrorParser.test.ts locks this in.
  const rateLimitResetMs =
    category === ApiErrorCategory.RATE_LIMIT ? extractRateLimitResetMs(error) : undefined;

  return {
    type,
    category,
    statusCode,
    userMessage,
    technicalMessage: errorMessage,
    referenceId,
    shouldRetry,
    requestId,
    rateLimitResetMs,
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
 * Convenience function for retry logic.
 *
 * **Honor explicit `ApiError.info.shouldRetry` overrides**: when the error is
 * an `ApiError` instance, its `.info.shouldRetry` field is the authoritative
 * answer (the constructor encoded a deliberate decision, e.g., the rate-limit
 * cache short-circuit overriding `shouldRetry: false` on what would otherwise
 * classify as transient). Re-parsing via `parseApiError` for an `ApiError`
 * instance would discard the override and re-derive from the message — which,
 * for synthetic errors with rate-limit-shaped messages, would falsely return
 * `true` and re-enter retry loops the override exists to prevent.
 */
export function shouldRetryError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.info.shouldRetry;
  }
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
