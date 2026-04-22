/**
 * Retry Utilities
 *
 * Centralized retry and timeout patterns for ai-worker.
 *
 * Features:
 * - Exponential backoff between retries
 * - Global timeout for all attempts
 * - Optional error classification for fast-fail on permanent errors
 *
 * See also: parallelRetry.ts for batch operations with per-item retries.
 */

import type { Logger } from 'pino';
import { RETRY_CONFIG, TimeoutError, normalizeErrorForLogging } from '@tzurot/common-types';

// Re-export for existing ai-worker callers that imported from this module
export { TimeoutError, normalizeErrorForLogging };

/**
 * Configuration options for retry behavior
 */
interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds before first retry */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs?: number;
  /** Backoff multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Global timeout in milliseconds for all attempts (default: none) */
  globalTimeoutMs?: number;
  /** Logger instance for logging retry attempts */
  logger?: Logger;
  /** Operation name for logging */
  operationName?: string;
  /**
   * Optional function to determine if an error should be retried.
   * Return false to fast-fail without retrying (e.g., for permanent errors).
   * Default: all errors are retried.
   */
  shouldRetry?: (error: unknown) => boolean;
  /**
   * Optional function to extract additional log context from errors.
   * Must not throw — exceptions propagate through the retry machinery and
   * suppress the original error. Keys `err`, `attempt`, `maxAttempts`,
   * `attempts`, and `totalTimeMs` are overridden by the retry infrastructure.
   */
  getErrorContext?: (error: unknown) => Record<string, unknown>;
}

/**
 * Result of a retry operation
 */
interface RetryResult<T> {
  /** The successful result */
  value: T;
  /** Number of attempts made */
  attempts: number;
  /** Total time taken in milliseconds */
  totalTimeMs: number;
}

/**
 * Retry error with details about failed attempts
 */
export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: unknown
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Safely invoke getErrorContext, swallowing exceptions to avoid
 * suppressing the original error that triggered the retry.
 */
function safeGetErrorContext(
  getErrorContext: ((error: unknown) => Record<string, unknown>) | undefined,
  error: unknown,
  logger?: Logger
): Record<string, unknown> {
  if (!getErrorContext) {
    return {};
  }
  try {
    return getErrorContext(error);
  } catch (ctxErr) {
    logger?.warn({ err: ctxErr }, '[Retry] getErrorContext threw, ignoring');
    return {};
  }
}

interface TimeoutCheckContext {
  globalTimeoutMs: number | undefined;
  startTime: number;
  attempt: number;
  operationName: string;
  lastError: unknown;
  logger?: Logger;
}

/**
 * Check if global timeout has been exceeded
 */
function checkGlobalTimeout(ctx: TimeoutCheckContext): void {
  const { globalTimeoutMs, startTime, attempt, operationName, lastError, logger } = ctx;

  if (globalTimeoutMs === undefined || globalTimeoutMs <= 0) {
    return;
  }

  const elapsed = Date.now() - startTime;
  if (elapsed >= globalTimeoutMs) {
    const error = new RetryError(
      `${operationName} exceeded global timeout of ${globalTimeoutMs}ms after ${attempt - 1} attempts`,
      attempt - 1,
      lastError
    );
    logger?.error(
      { err: error, elapsed, attempts: attempt - 1 },
      `[Retry] Global timeout exceeded`
    );
    throw error;
  }
}

/**
 * Calculate delay for exponential backoff
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(baseDelay, maxDelayMs);
}

interface RetryContext {
  attempt: number;
  startTime: number;
  operationName: string;
  logger?: Logger;
}

interface NonRetryableErrorContext extends RetryContext {
  error: unknown;
  getErrorContext?: (error: unknown) => Record<string, unknown>;
}

/**
 * Handle a non-retryable error by throwing a RetryError
 */
function handleNonRetryableError(ctx: NonRetryableErrorContext): never {
  const { error, attempt, startTime, operationName, logger, getErrorContext } = ctx;
  const totalTimeMs = Date.now() - startTime;
  const errorContext = safeGetErrorContext(getErrorContext, error, logger);
  logger?.warn(
    { ...errorContext, err: normalizeErrorForLogging(error, operationName), attempt, totalTimeMs },
    `[Retry] ${operationName} failed with non-retryable error, fast-failing`
  );
  throw new RetryError(`${operationName} failed with non-retryable error`, attempt, error);
}

interface ErrorCheckContext extends RetryContext {
  error: unknown;
  shouldRetry?: (error: unknown) => boolean;
  /** Forwarded to handleNonRetryableError for error log enrichment */
  getErrorContext?: (error: unknown) => Record<string, unknown>;
}

/**
 * Check if error should be retried and handle accordingly
 */
function checkRetryableError(ctx: ErrorCheckContext): void {
  const { error, shouldRetry, getErrorContext, attempt, startTime, operationName, logger } = ctx;
  const errorShouldRetry = shouldRetry === undefined || shouldRetry(error);
  if (!errorShouldRetry) {
    handleNonRetryableError({ error, getErrorContext, attempt, startTime, operationName, logger });
  }
}

interface DelayContext extends RetryContext {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Wait before next retry attempt if not the last attempt
 */
async function waitBeforeRetry(ctx: DelayContext): Promise<void> {
  const { attempt, maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, logger } = ctx;
  if (attempt >= maxAttempts) {
    return;
  }
  const delay = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs, backoffMultiplier);
  logger?.debug({ delay, attempt }, `[Retry] Waiting before retry`);
  await sleep(delay);
}

/**
 * Execute an async function with exponential backoff retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result with value, attempts, and timing info
 * @throws RetryError if all attempts fail or global timeout is reached
 *
 * Log prefix convention: `[Retry]` prefixes every lifecycle log — success,
 * per-attempt failure, and exhaustion — regardless of whether retries
 * actually occurred. A `[Retry] ... succeeded on attempt 1` line is normal
 * first-try success, not a retry event. Filter on `attempt > 1` to isolate
 * actual retry recovery events.
 *
 * @example
 * const result = await withRetry(
 *   () => model.invoke(messages),
 *   {
 *     maxAttempts: 3,
 *     initialDelayMs: 1000,
 *     logger,
 *     operationName: 'LLM invocation'
 *   }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts = RETRY_CONFIG.MAX_ATTEMPTS,
    initialDelayMs = RETRY_CONFIG.INITIAL_DELAY_MS,
    maxDelayMs = RETRY_CONFIG.MAX_DELAY_MS,
    backoffMultiplier = RETRY_CONFIG.BACKOFF_MULTIPLIER,
    globalTimeoutMs,
    logger,
    operationName = 'operation',
    shouldRetry,
    getErrorContext,
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    checkGlobalTimeout({ globalTimeoutMs, startTime, attempt, operationName, lastError, logger });
    const attemptStartTime = Date.now();

    try {
      const value = await fn();
      const now = Date.now();
      const durationMs = now - attemptStartTime;
      const totalTimeMs = now - startTime;

      // Log every successful attempt with per-attempt duration so post-deploy
      // analysis can answer: attempt-1 success rate, p95 response time per
      // attempt index, retry success rate.
      logger?.info(
        { operationName, attempt, durationMs, totalTimeMs },
        `[Retry] ${operationName} succeeded on attempt ${attempt}`
      );

      return { value, attempts: attempt, totalTimeMs };
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - attemptStartTime;
      checkRetryableError({
        error,
        shouldRetry,
        getErrorContext,
        attempt,
        startTime,
        operationName,
        logger,
      });
      const errorContext = safeGetErrorContext(getErrorContext, error, logger);
      logger?.warn(
        {
          ...errorContext,
          err: normalizeErrorForLogging(error, operationName),
          operationName,
          attempt,
          maxAttempts,
          durationMs,
        },
        `[Retry] ${operationName} failed (attempt ${attempt}/${maxAttempts})`
      );
      await waitBeforeRetry({
        attempt,
        maxAttempts,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        logger,
        startTime,
        operationName,
      });
    }
  }

  const totalTimeMs = Date.now() - startTime;
  const error = new RetryError(
    `${operationName} failed after ${maxAttempts} attempts`,
    maxAttempts,
    lastError
  );
  const exhaustionContext = safeGetErrorContext(getErrorContext, lastError, logger);
  logger?.error(
    { ...exhaustionContext, err: error, operationName, attempts: maxAttempts, totalTimeMs },
    `[Retry] ${operationName} exhausted all retry attempts`
  );
  throw error;
}

/**
 * Execute a function with a timeout using AbortController
 *
 * @param fn - Async function that accepts an AbortSignal
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Operation name for error messages
 * @returns The function result
 * @throws Error if timeout is reached
 *
 * @example
 * const response = await withTimeout(
 *   (signal) => fetch(url, { signal }),
 *   5000,
 *   'API fetch'
 * );
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName = 'operation'
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await fn(controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(timeoutMs, operationName, error);
    }
    throw error;
  }
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
