/**
 * Shared error classes and error-handling utilities.
 *
 * Lives in common-types because both ai-worker (custom `withTimeout` helper)
 * and bot-client (native `AbortSignal.timeout()`) need to detect timeouts
 * uniformly, and LangChain's habit of throwing plain `{}` instead of Error
 * instances benefits every service that logs errors.
 */

/**
 * Typed sentinel for timeout errors. Replaces fragile message-string matching
 * (`error.message.includes('timed out')`) with `instanceof` / name checks.
 * Preserves the original `AbortError` / `DOMException` as `cause` for
 * debugging when available.
 */
export class TimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly operationName: string,
    cause?: Error
  ) {
    // Error superclass ignores undefined cause, so passing { cause } is safe either way
    super(`${operationName} timed out after ${timeoutMs}ms`, { cause });
    this.name = 'TimeoutError';
  }
}

/**
 * Check whether an error represents a timeout. Handles both:
 * - Our custom {@link TimeoutError} class (thrown by ai-worker's `withTimeout`)
 * - Native DOMException / Error with `name === 'TimeoutError'` (thrown by
 *   `AbortSignal.timeout()` inside `fetch()` on timeout)
 *
 * Prefer this over stringly-typed `error.message.includes('timed out')` or
 * per-file `error instanceof DOMException && error.name === 'TimeoutError'`.
 */
export function isTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'TimeoutError';
}

/**
 * Normalize a caught error for Pino logging.
 *
 * LangChain/OpenAI SDK sometimes throws plain objects (e.g., literal `{}`)
 * instead of Error instances. Pino's error serializer can't extract useful
 * info from these — they serialize as `{ _nonErrorObject: true, raw: "{}" }`.
 *
 * This wraps non-Error values in a real Error with context, so the log
 * includes the operation name and a stringified snapshot of what was thrown.
 */
export function normalizeErrorForLogging(error: unknown, operationName: string): Error {
  if (error instanceof Error) {
    return error;
  }

  let detail: string;
  try {
    const str = JSON.stringify(error);
    detail = str.length > 500 ? str.substring(0, 500) + '...' : str;
  } catch {
    detail = String(error);
  }

  const normalized = new Error(`[${operationName}] Non-Error object thrown: ${detail}`);
  normalized.name = 'NormalizedError';
  return normalized;
}
