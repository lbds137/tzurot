/**
 * Retry Service Utilities
 *
 * Centralized retry and timeout patterns for ai-worker service.
 * Handles exponential backoff, parallel retries, and timeout management.
 */

import type { Logger } from 'pino';
import { RETRY_CONFIG } from '@tzurot/common-types';

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
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
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
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
 * Execute an async function with exponential backoff retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Result with value, attempts, and timing info
 * @throws RetryError if all attempts fail or global timeout is reached
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
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check global timeout
    if (globalTimeoutMs !== undefined && globalTimeoutMs > 0) {
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

    try {
      const value = await fn();
      const totalTimeMs = Date.now() - startTime;

      if (attempt > 1) {
        logger?.info(
          { attempt, totalTimeMs },
          `[Retry] ${operationName} succeeded after ${attempt} attempts`
        );
      }

      return { value, attempts: attempt, totalTimeMs };
    } catch (error) {
      lastError = error;

      logger?.warn(
        { err: error, attempt, maxAttempts },
        `[Retry] ${operationName} failed (attempt ${attempt}/${maxAttempts})`
      );

      // Don't wait after the last attempt
      if (attempt < maxAttempts) {
        // Calculate delay with exponential backoff
        const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
        const delay = Math.min(baseDelay, maxDelayMs);

        logger?.debug({ delay, attempt }, `[Retry] Waiting before retry`);
        await sleep(delay);
      }
    }
  }

  // All attempts failed
  const totalTimeMs = Date.now() - startTime;
  const error = new RetryError(
    `${operationName} failed after ${maxAttempts} attempts`,
    maxAttempts,
    lastError
  );
  logger?.error(
    { err: error, attempts: maxAttempts, totalTimeMs },
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
    if ((error as Error).name === 'AbortError') {
      throw new Error(`${operationName} timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Options for parallel retry operations
 */
export interface ParallelRetryOptions extends RetryOptions {
  /** Number of items to process in parallel (default: items.length) */
  concurrency?: number;
}

/**
 * Result of a single item in parallel retry
 */
export interface ParallelItemResult<T> {
  /** Index of the item in the original array */
  index: number;
  /** Status of the operation */
  status: 'success' | 'failed';
  /** The successful result (if status is 'success') */
  value?: T;
  /** The error (if status is 'failed') */
  error?: unknown;
  /** Number of attempts made */
  attempts: number;
}

/**
 * Process multiple items in parallel with retry logic
 *
 * Attempts to process all items, retrying failed items in subsequent rounds.
 * Returns results for all items, including both successes and failures.
 *
 * @param items - Array of items to process
 * @param fn - Async function to process each item
 * @param options - Parallel retry configuration
 * @returns Array of results for each item
 *
 * @example
 * const results = await withParallelRetry(
 *   attachments,
 *   (attachment) => describeImage(attachment),
 *   {
 *     maxAttempts: 3,
 *     logger,
 *     operationName: 'Image description'
 *   }
 * );
 */
export async function withParallelRetry<TItem, TResult>(
  items: TItem[],
  fn: (item: TItem, index: number) => Promise<TResult>,
  options: ParallelRetryOptions = {}
): Promise<ParallelItemResult<TResult>[]> {
  const { maxAttempts = 3, logger, operationName = 'operation' } = options;

  // Track results for each item
  const results: ParallelItemResult<TResult>[] = items.map((_, index) => ({
    index,
    status: 'failed' as const,
    attempts: 0,
  }));

  // Track which items still need processing
  let remainingIndices = items.map((_, index) => index);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (remainingIndices.length === 0) {
      break; // All items succeeded
    }

    logger?.info(
      { attempt, remaining: remainingIndices.length, total: items.length },
      `[ParallelRetry] ${operationName} attempt ${attempt}/${maxAttempts}`
    );

    // Process remaining items in parallel
    const promises = remainingIndices.map(async index => {
      try {
        const value = await fn(items[index], index);
        return { index, status: 'success' as const, value };
      } catch (error) {
        return { index, status: 'failed' as const, error };
      }
    });

    const attemptResults = await Promise.allSettled(promises);

    // Update results and identify items that still need retry
    const stillFailing: number[] = [];

    attemptResults.forEach((promiseResult, i) => {
      const index = remainingIndices[i];

      if (promiseResult.status === 'fulfilled') {
        const { status, value, error } = promiseResult.value;

        results[index].attempts = attempt;

        if (status === 'success') {
          results[index].status = 'success';
          results[index].value = value;
        } else {
          results[index].status = 'failed';
          results[index].error = error;
          stillFailing.push(index);
        }
      } else {
        // Promise itself was rejected (shouldn't happen with our setup)
        results[index].attempts = attempt;
        results[index].status = 'failed';
        results[index].error = promiseResult.reason;
        stillFailing.push(index);
      }
    });

    remainingIndices = stillFailing;

    // Log progress
    const successCount = results.filter(r => r.status === 'success').length;
    logger?.info(
      { attempt, successCount, failedCount: remainingIndices.length },
      `[ParallelRetry] ${operationName} attempt ${attempt} complete: ${successCount}/${items.length} succeeded`
    );
  }

  return results;
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
