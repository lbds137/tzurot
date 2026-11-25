/**
 * Parallel Retry Utilities
 *
 * Batch processing with per-item retry logic.
 * Extracted from retry.ts to keep modules under the max-lines limit.
 */

import type { Logger } from 'pino';
import { mapWithConcurrency } from './mapWithConcurrency.js';

/**
 * Options for parallel retry operations.
 * Uses a minimal subset of retry options — getErrorContext is excluded
 * because parallel items have per-item error handling, so a single
 * error context callback would be misleading.
 */
interface ParallelRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Max items in flight per attempt; omitted = all at once. Must be >= 1: a value below 1 or NaN rejects the call */
  concurrency?: number;
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

/** Per-item outcome of one attempt, before it is folded into `results`. */
interface AttemptOutcome<TResult> {
  index: number;
  status: 'success' | 'failed';
  value?: TResult;
  error?: unknown;
}

/**
 * Process multiple items in parallel with retry logic
 *
 * Attempts to process all items, retrying failed items in subsequent rounds.
 * Returns results for all items, including both successes and failures.
 *
 * Note: unlike {@link withRetry}, this function does not add delays between
 * retry rounds. Use `shouldRetry` to fast-fail non-retryable errors (e.g., 429s)
 * rather than relying on backoff.
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
 *     concurrency: 4,
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
  const {
    maxAttempts = 3,
    concurrency,
    logger,
    operationName = 'operation',
    shouldRetry,
  } = options;

  // Validate up front so an empty `items` array rejects too; the attempt loop below
  // breaks before mapWithConcurrency runs when there is nothing to process.
  if (concurrency !== undefined && !(concurrency >= 1)) {
    throw new RangeError(`withParallelRetry: concurrency must be at least 1 (got ${concurrency})`);
  }

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

    // Process remaining items in parallel. The per-item wrapper never rejects, so the
    // bounded path (mapWithConcurrency) settles exactly like Promise.allSettled.
    const runItem = async (index: number): Promise<AttemptOutcome<TResult>> => {
      try {
        const value = await fn(items[index], index);
        return { index, status: 'success', value };
      } catch (error) {
        return { index, status: 'failed', error };
      }
    };

    const attemptResults: PromiseSettledResult<AttemptOutcome<TResult>>[] =
      concurrency === undefined
        ? await Promise.allSettled(remainingIndices.map(runItem))
        : (await mapWithConcurrency(remainingIndices, concurrency, runItem)).map(value => ({
            status: 'fulfilled' as const,
            value,
          }));

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
          const canRetry = shouldRetry === undefined || shouldRetry(error);
          if (canRetry) {
            stillFailing.push(index);
          }
        }
      } else {
        // Deliberate defensive guard: runItem never rejects, so neither the bounded path
        // nor the allSettled path reaches this arm today. Kept so a future change to runItem
        // cannot silently drop a failure.
        results[index].attempts = attempt;
        results[index].status = 'failed';
        results[index].error = promiseResult.reason;
        const canRetry = shouldRetry === undefined || shouldRetry(promiseResult.reason);
        if (canRetry) {
          stillFailing.push(index);
        }
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
