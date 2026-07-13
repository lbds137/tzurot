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

import { INTERVALS } from './timing.js';

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
 * POSIX and undici error codes that indicate transient network failures.
 * Superset of {@link TransientErrorCode} — includes all its members plus
 * undici-specific codes like `UND_ERR_CONNECT_TIMEOUT`.
 * Used by {@link isTransientNetworkError} for runtime error classification.
 */
const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  TransientErrorCode.ECONNREFUSED,
  TransientErrorCode.ECONNRESET,
  TransientErrorCode.ETIMEDOUT,
  TransientErrorCode.ENOTFOUND,
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Check if an error is a transient network failure from Node's fetch/undici.
 *
 * Node undici throws TypeError("fetch failed") with a cause carrying a POSIX
 * error code (ECONNREFUSED, ECONNRESET, ETIMEDOUT). This helper checks both
 * the known message string and the cause chain for robustness across Node
 * versions — the "fetch failed" message is an undici implementation detail.
 *
 * Use this in retry classifiers instead of duplicating the TypeError check.
 */
export function isTransientNetworkError(error: unknown): boolean {
  return checkTransientNetwork(error, 0);
}

function checkTransientNetwork(error: unknown, depth: number): boolean {
  if (depth > 5) {
    return false;
  }

  if (!(error instanceof Error)) {
    // Handle plain objects with a `code` property in the cause chain
    // (Node undici sometimes wraps POSIX errors as plain objects)
    if (error !== null && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      return typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code);
    }
    return false;
  }

  // Direct POSIX code on the error (e.g., Node.js net/socket errors)
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }

  // undici throws TypeError("fetch failed") for network failures. Accept any
  // Error subclass with this exact message for robustness (not just TypeError).
  if (error.message === 'fetch failed') {
    return true;
  }

  // Recurse into cause chain for wrapped POSIX errors (e.g., fetch wrapping ECONNREFUSED)
  if (error.cause !== undefined) {
    return checkTransientNetwork(error.cause, depth + 1);
  }

  return false;
}

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
  /**
   * Error message when the upstream provider failed mid-generation
   * (finish_reason 'error' inside an HTTP 200). Deliberately STABLE — no
   * provider detail is appended, because parseApiError classifies via regex
   * over message text and upstream wording (e.g. "rate limit") could flip
   * the classification to non-retryable. The detail rides the structured
   * warn log + response_metadata.openrouter.providerError instead.
   */
  PROVIDER_ERROR_FINISH: 'LLM provider failed mid-generation (finish_reason: error)',
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
  /**
   * 402 - Account-level credit exhaustion (BYOK key has zero credits or
   * organisation hasn't purchased credits). Distinct from QUOTA_EXCEEDED
   * because the remediation is account-level (top up at the provider) rather
   * than waiting for a daily-limit reset. Routed by message-pattern in
   * `parseApiError` when the 402 response identifies the account as out of
   * credits, not the request as exceeding a per-request budget.
   */
  CREDIT_EXHAUSTION = 'credit_exhaustion',
  /**
   * The user has used their fair share of the SHARED system free-tier key for
   * now (rolling-window quota — see ai-worker/FreeTierRequestQuota). Distinct
   * from QUOTA_EXCEEDED (a provider-side per-request/daily limit) and
   * CREDIT_EXHAUSTION (a paid account out of credits): the remediation is
   * "bring your own key" so the user stops depending on the shared pool. NOT a
   * retargetable provider failure — deliberately absent from
   * QUOTA_FALLBACK_CATEGORIES.
   */
  FREE_TIER_QUOTA = 'free_tier_quota',
  /** 403 - Content policy violation or forbidden */
  CONTENT_POLICY = 'content_policy',
  /** 400 - Bad request (context window exceeded, invalid params) */
  BAD_REQUEST = 'bad_request',
  /** 404 - Model not found */
  MODEL_NOT_FOUND = 'model_not_found',
  /** Media URL unavailable (e.g., Discord CDN link expired, upstream 404 fetching image). Permanent per-URL. */
  MEDIA_NOT_FOUND = 'media_not_found',
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
  /**
   * TTS-specific: voice-id not found on the provider side. May happen if a
   * cached voiceId was deleted externally, or if the personality's voice
   * reference clip was never registered. Provider-internal cache should
   * invalidate and retry once before surfacing this.
   */
  VOICE_NOT_FOUND = 'voice_not_found',
  /**
   * TTS-specific: voice cloning failed (malformed reference audio, provider
   * rejected the clip, account-level cloning quota exceeded). Distinct from
   * VOICE_NOT_FOUND — this is a CREATE failure, not a lookup miss.
   */
  CLONING_FAILED = 'cloning_failed',
  /** Unknown error type */
  UNKNOWN = 'unknown',
}

/**
 * The failure categories the tier-aware quota fallback can retarget on — the
 * wire values carried in `quotaFallback` result metadata (a subset of
 * `ApiErrorCategory` values). Single source of truth: the Zod enum in
 * `generation.ts` and every hand-typed `category` field derive from this
 * tuple, so adding a retargetable category is a one-line change here.
 * (ai-worker's `QuotaFallbackCategory` enum-member union stays separate for
 * its `ApiErrorCategory` narrowing; enum members are assignable to these
 * literals, so producers type-check against this without casts.)
 */
export const QUOTA_FALLBACK_CATEGORIES = [
  'quota_exceeded',
  'credit_exhaustion',
  'rate_limit',
  // Availability-class + provider-side censorship (D12 runtime text descent).
  'model_not_found',
  'server_error',
  'timeout',
  'network',
  'empty_response',
  'censored',
  'content_policy',
] as const;

export type QuotaFallbackCategoryValue = (typeof QUOTA_FALLBACK_CATEGORIES)[number];

/**
 * User-friendly error messages for each category
 * These are shown to users when no personality-specific error message is configured
 */
export const USER_ERROR_MESSAGES: Record<ApiErrorCategory, string> = {
  [ApiErrorCategory.AUTHENTICATION]:
    "There's an issue with the API key configuration. Please check your wallet settings or contact support.",
  [ApiErrorCategory.QUOTA_EXCEEDED]:
    "You've reached your API usage limit. Please add credits to your OpenRouter account or wait until your limit resets.",
  [ApiErrorCategory.CREDIT_EXHAUSTION]:
    'Your OpenRouter account has no credits. Top up at https://openrouter.ai/settings/credits to continue.',
  [ApiErrorCategory.FREE_TIER_QUOTA]:
    "You've used your share of the shared free tier for now. To keep chatting, add your own OpenRouter API key with `/settings apikey set` — grab a free one at https://openrouter.ai/keys.",
  [ApiErrorCategory.CONTENT_POLICY]:
    'The AI declined to respond due to content guidelines. Please try rephrasing your message.',
  [ApiErrorCategory.BAD_REQUEST]:
    'The conversation has become too long. Please start a new conversation or try a shorter message.',
  [ApiErrorCategory.MODEL_NOT_FOUND]:
    'The requested AI model is not available. Please try again or use a different personality.',
  [ApiErrorCategory.MEDIA_NOT_FOUND]:
    'The media attachment could not be fetched — the link may have expired.',
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
  [ApiErrorCategory.VOICE_NOT_FOUND]:
    'The voice for this personality is no longer available. Try again — the bot will re-register it automatically.',
  [ApiErrorCategory.CLONING_FAILED]:
    "Voice cloning failed for this personality's reference audio. The text response was delivered without voice; please contact support if this persists.",
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
 *
 * Note: BAD_REQUEST (400) is intentionally NOT in this set. Some AI model APIs
 * incorrectly return 400 for transient errors that succeed on retry.
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set
export const PERMANENT_ERROR_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.AUTHENTICATION,
  ApiErrorCategory.QUOTA_EXCEEDED,
  ApiErrorCategory.CREDIT_EXHAUSTION,
  ApiErrorCategory.FREE_TIER_QUOTA,
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.MODEL_NOT_FOUND,
  ApiErrorCategory.MEDIA_NOT_FOUND,
]);

/**
 * Categories that SHOULD trigger retries (transient errors)
 *
 * Note: BAD_REQUEST is included here because some AI model APIs incorrectly
 * return 400 for transient issues (e.g., temporary model unavailability)
 * that succeed on retry.
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set
export const TRANSIENT_ERROR_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.RATE_LIMIT,
  ApiErrorCategory.SERVER_ERROR,
  ApiErrorCategory.TIMEOUT,
  ApiErrorCategory.NETWORK,
  ApiErrorCategory.EMPTY_RESPONSE,
  ApiErrorCategory.CENSORED,
  ApiErrorCategory.BAD_REQUEST,
]);

/**
 * Per-category vision negative-cache policy (L1 Redis TTL only — no L2 persistence).
 *
 * Decoupled from retry policy: AUTHENTICATION and QUOTA_EXCEEDED stay in
 * `PERMANENT_ERROR_CATEGORIES` so `withRetry` fails fast (correct for genuinely
 * bad keys), but the cache must NOT remember those failures forever — OpenRouter
 * intermittently returns 401 on transient edge issues, and quota state changes
 * when users add credits or daily limits reset. Long-cooldown caching of
 * transient-misclassified-as-permanent errors poisons the cache for the
 * attachment lifetime, with no recovery path.
 *
 * TTL tiers:
 * - SHORT (5min): auth/quota — short cooldown so transient state recovers
 * - LONG (60min): content-policy, dead URL, missing model — attachment-bound
 * - DEFAULT (10min): generic retryable-transient cooldown
 */
export const VISION_FAILURE_CACHE_POLICY: Record<ApiErrorCategory, { l1TtlSeconds: number }> = {
  // Possibly-transient mis-classified-as-permanent — keep cache cooldown short
  [ApiErrorCategory.AUTHENTICATION]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_SHORT },
  [ApiErrorCategory.QUOTA_EXCEEDED]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_SHORT },
  // CREDIT_EXHAUSTION: same SHORT cooldown as QUOTA_EXCEEDED — credit state
  // recovers when the user tops up; long cooldown would block legitimate
  // recovery for hours.
  [ApiErrorCategory.CREDIT_EXHAUSTION]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_SHORT },
  // FREE_TIER_QUOTA: same SHORT cooldown — the rolling-window share recovers
  // quickly, and it's a generation-path error that shouldn't linger in the
  // vision negative cache (present here only for Record exhaustiveness).
  [ApiErrorCategory.FREE_TIER_QUOTA]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_SHORT },

  // Genuinely attachment-property failures — longer cooldown.
  // CENSORED belongs here too: when the vision model returns the "ext"-sentinel
  // refusal, it's the IMAGE content that triggered the filter. Retrying 6×/hour
  // (the previous default-TTL behavior) for an image the model will consistently
  // reject is wasted compute. System-prompt-driven sensitivity *could* vary by
  // persona in theory, but in observed practice the model decision is image-bound.
  // BAD_REQUEST is also bucketed here for the vision-cache path — most 400s from
  // vision endpoints are attachment-bound (unsupported format, malformed Discord
  // CDN URL) rather than truly transient. (Note: this only affects the vision
  // negative cache; `withRetry` still treats BAD_REQUEST as TRANSIENT for the
  // retry-or-fail-fast decision per `TRANSIENT_ERROR_CATEGORIES`.)
  [ApiErrorCategory.CONTENT_POLICY]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },
  [ApiErrorCategory.MEDIA_NOT_FOUND]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },
  [ApiErrorCategory.MODEL_NOT_FOUND]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },
  [ApiErrorCategory.CENSORED]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },
  [ApiErrorCategory.BAD_REQUEST]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },

  // Retryable-transient categories — generic cooldown
  [ApiErrorCategory.RATE_LIMIT]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL },
  [ApiErrorCategory.SERVER_ERROR]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL },
  [ApiErrorCategory.TIMEOUT]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL },
  [ApiErrorCategory.NETWORK]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL },
  [ApiErrorCategory.EMPTY_RESPONSE]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL },
  // TTS-specific categories — VISION cache won't see these in practice (TTS
  // failures don't go through the vision negative-cache path), but the
  // Record<ApiErrorCategory, ...> type contract requires every enum value.
  // Default to LONG cooldown matching attachment-bound failures.
  [ApiErrorCategory.VOICE_NOT_FOUND]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },
  [ApiErrorCategory.CLONING_FAILED]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL_LONG },
  [ApiErrorCategory.UNKNOWN]: { l1TtlSeconds: INTERVALS.VISION_FAILURE_TTL },
};

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
const ERROR_SPOILER_PATTERN = /\|\|\*\(([^)|]{1,500})\)\*\|\|/;

/**
 * Wrap bare http(s) URLs in `<…>` to suppress Discord's auto-embed previews.
 *
 * Discord renders an embed/preview card for any bare URL it finds in a message,
 * even when the URL sits inside a spoiler block (`||…||`). For technical-error
 * messages (e.g., a LangChain troubleshooting link), the embed is noisy and
 * defeats the spoiler's purpose. Wrapping the URL with `<…>` is Discord's
 * documented opt-out from preview rendering.
 *
 * Skips URLs that are already wrapped (`<https://…>`) or already inside a
 * markdown link (`[text](https://…)`) — the lookbehind excludes `<` and `(`
 * preceding the scheme. Trailing sentence punctuation (`.,;:!?`) stays
 * outside the wrap so the visible text reads naturally.
 *
 * Internal balanced brackets are preserved per RFC 3986 — `(`/`)` and `[`/`]`
 * pairs are tracked independently. So `https://en.wikipedia.org/wiki/Foo_(bar)`
 * and `https://[::1]/path` and `https://api.example.com/items[0]/value` all
 * wrap correctly without truncation. Unmatched closing brackets cut the URL,
 * which is what surrounding-prose contexts like `(see https://…)` need.
 * The match is intentionally permissive (`\S+`); the callback walks the
 * candidate, balancing brackets and stripping trailing punctuation.
 */
export function wrapUrlsForNoEmbed(text: string): string {
  return text.replace(/(?<![<(])\bhttps?:\/\/\S+/g, candidate => {
    let parenDepth = 0;
    let bracketDepth = 0;
    let cutAt = candidate.length;
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        if (parenDepth === 0) {
          cutAt = i;
          break;
        }
        parenDepth--;
      } else if (ch === '[') {
        bracketDepth++;
      } else if (ch === ']') {
        if (bracketDepth === 0) {
          cutAt = i;
          break;
        }
        bracketDepth--;
      } else if (ch === '>') {
        cutAt = i;
        break;
      }
    }
    let url = candidate.slice(0, cutAt);
    const rest = candidate.slice(cutAt);
    // url is guaranteed non-empty here: the candidate starts with `https://`
    // (regex), and the walker can't cut at index 0 because `h` matches no
    // cut marker — so cutAt > 0 always, and url.slice(-1) is always 1 char.
    let trailingPunct = '';
    const lastChar = url.slice(-1);
    if ('.,;:!?'.includes(lastChar)) {
      trailingPunct = lastChar;
      url = url.slice(0, -1);
    }
    return `<${url}>${trailingPunct}${rest}`;
  });
}

/**
 * Format error details for Discord spoiler tags
 * @param category - Error category for context
 * @param referenceId - Unique reference ID
 * @param technicalMessage - Optional technical detail (e.g., "402 Payment Required")
 * @returns Formatted spoiler text
 */
export function formatErrorSpoiler(
  category: ApiErrorCategory,
  referenceId: string,
  technicalMessage?: string
): string {
  const categoryLabel = category.replace(/_/g, ' ');
  // technicalMessage frequently carries provider URLs (e.g., the LangChain
  // troubleshooting link); wrap them so the spoiler doesn't trigger
  // Discord embeds. Provider messages also often end with a trailing newline,
  // which would put the closing quote on its own line in the rendered
  // spoiler — trim before quoting.
  const trimmedTech = technicalMessage?.trim();
  const techPart =
    trimmedTech !== undefined && trimmedTech.length > 0
      ? ` — "${wrapUrlsForNoEmbed(trimmedTech)}"`
      : '';
  return `||*(error: ${categoryLabel}${techPart}; ref: ${referenceId})*||`;
}

/**
 * Format personality error message with error details appended
 *
 * @param personalityMessage - The personality's configured error message
 * @param category - Error category
 * @param referenceId - Unique reference ID
 * @param technicalMessage - Optional technical detail for the spoiler
 * @returns Message with error details in spoiler tags
 */
export function formatPersonalityErrorMessage(
  personalityMessage: string,
  category: ApiErrorCategory,
  referenceId: string,
  technicalMessage?: string
): string {
  const spoilerContent = formatErrorSpoiler(category, referenceId, technicalMessage);

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

/**
 * Machine-readable sub-codes for api-gateway error responses.
 *
 * Set on `ErrorResponse.code` by purpose-built helpers in
 * `services/api-gateway/src/utils/errorResponses.ts` (e.g. `nameCollision`),
 * and consumed by bot-client when it needs to branch on a specific error
 * kind without regex-matching the natural-language message text.
 *
 * The primary `error` field still carries the top-level `ErrorCode`
 * (e.g. `VALIDATION_ERROR`); sub-codes are finer-grained classifiers
 * layered on top of it. Add entries here as new branching needs arise;
 * keep each value stable — these are part of the inter-service contract.
 */
export const API_ERROR_SUBCODE = {
  /** User/admin tried to create a resource whose name is already taken. */
  NAME_COLLISION: 'NAME_COLLISION',
} as const;

/** Union of all defined sub-code values, for typing `ErrorResponse.code`. */
export type ApiErrorSubcode = (typeof API_ERROR_SUBCODE)[keyof typeof API_ERROR_SUBCODE];
