/**
 * Parallel Retry Utilities
 *
 * Batch processing with per-item retry logic.
 * Extracted from retry.ts to keep modules under the max-lines limit.
 */

import type { Logger } from 'pino';

/**
 * Options for parallel retry operations.
 * Uses a minimal subset of retry options — getErrorContext is excluded
 * because parallel items have per-item error handling, so a single
 * error context callback would be misleading.
 */
interface ParallelRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
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
  const { maxAttempts = 3, logger, operationName = 'operation', shouldRetry } = options;

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
          const canRetry = shouldRetry === undefined || shouldRetry(error);
          if (canRetry) {
            stillFailing.push(index);
          }
        }
      } else {
        // Promise itself was rejected (shouldn't happen with our setup)
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
