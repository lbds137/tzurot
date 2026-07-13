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
 * Audio exceeded the maximum supported duration (the self-hosted STT cap).
 *
 * Distinct from {@link TimeoutError}: too-long is a deterministic rejection BEFORE
 * inference (the audio is simply over the cap), whereas a timeout is a slow or stalled
 * inference. bot-client maps this to a "too long" user message; the STT job carries it
 * across the job boundary as `failureReason: 'too_long'` (Error instances don't
 * survive BullMQ/Redis serialization).
 */
export class AudioTooLongError extends Error {
  constructor(detail?: string) {
    super(detail ?? 'Audio exceeds the maximum supported duration');
    this.name = 'AudioTooLongError';
  }
}

/** Check whether an error is an {@link AudioTooLongError} (name-based, survives bundling). */
export function isTooLongError(error: unknown): error is AudioTooLongError {
  return error instanceof Error && error.name === 'AudioTooLongError';
}

/**
 * The STT service was unavailable after the per-provider retries within the
 * cascade all failed. (Job-level retries deliberately do NOT run for this
 * shape — "No STT provider available" fast-fails the job to avoid re-running
 * a guaranteed-identical failure.) Distinct from {@link TimeoutError}: a
 * timeout is one slow/stalled inference, whereas unavailable means retries
 * actually ran and none could connect. The STT job carries it across the job
 * boundary as `failureReason: 'unavailable'` (Error instances don't survive
 * BullMQ/Redis serialization); bot-client maps it to a retry-aware user
 * message instead of the generic "couldn't transcribe".
 */
export class SttUnavailableError extends Error {
  constructor(detail?: string) {
    super(detail ?? 'Speech-to-text service unavailable after retries');
    this.name = 'SttUnavailableError';
  }
}

/** Check whether an error is an {@link SttUnavailableError} (name-based, survives bundling). */
export function isSttUnavailableError(error: unknown): error is SttUnavailableError {
  return error instanceof Error && error.name === 'SttUnavailableError';
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
