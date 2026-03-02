/**
 * Parallel Retry Tests
 *
 * Tests for batch processing with per-item retry logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { withParallelRetry } from './parallelRetry.js';

describe('withParallelRetry', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should process all items successfully on first attempt', async () => {
    const items = [1, 2, 3];
    const fn = vi.fn((item: number) => Promise.resolve(item * 2));

    const promise = withParallelRetry(items, fn, {
      maxAttempts: 3,
      logger: mockLogger,
    });

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ index: 0, status: 'success', value: 2, attempts: 1 });
    expect(results[1]).toEqual({ index: 1, status: 'success', value: 4, attempts: 1 });
    expect(results[2]).toEqual({ index: 2, status: 'success', value: 6, attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should retry failed items', async () => {
    const items = ['a', 'b', 'c'];
    let attemptCount = 0;

    const fn = vi.fn((item: string) => {
      attemptCount++;
      // Fail first 2 attempts for item 'b'
      if (item === 'b' && attemptCount <= 4) {
        // attempts 2 and 4 (b's 1st and 2nd)
        return Promise.reject(new Error('Fail b'));
      }
      return Promise.resolve(item.toUpperCase());
    });

    const promise = withParallelRetry(items, fn, {
      maxAttempts: 3,
      logger: mockLogger,
      operationName: 'uppercase',
    });

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ index: 0, status: 'success', value: 'A', attempts: 1 });
    expect(results[1].status).toBe('success');
    expect(results[1].value).toBe('B');
    expect(results[1].attempts).toBeGreaterThan(1);
    expect(results[2]).toEqual({ index: 2, status: 'success', value: 'C', attempts: 1 });
  });

  it('should mark items as failed after max attempts', async () => {
    const items = [1, 2, 3];
    const error = new Error('Persistent failure');

    const fn = vi.fn((item: number) => {
      if (item === 2) {
        return Promise.reject(error);
      }
      return Promise.resolve(item * 2);
    });

    const promise = withParallelRetry(items, fn, {
      maxAttempts: 3,
      logger: mockLogger,
    });

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ index: 0, status: 'success', value: 2, attempts: 1 });
    expect(results[1]).toEqual({
      index: 1,
      status: 'failed',
      error,
      attempts: 3,
    });
    expect(results[2]).toEqual({ index: 2, status: 'success', value: 6, attempts: 1 });
  });

  it('should stop retrying once all items succeed', async () => {
    const items = [1, 2, 3];
    let callCount = 0;

    const fn = vi.fn((item: number) => {
      callCount++;
      // Fail first attempt for item 2
      if (item === 2 && callCount === 2) {
        return Promise.reject(new Error('Fail once'));
      }
      return Promise.resolve(item * 2);
    });

    const promise = withParallelRetry(items, fn, {
      maxAttempts: 5, // Allow many attempts
      logger: mockLogger,
    });

    await vi.runAllTimersAsync();
    const results = await promise;

    // Should only retry item 2 once, not continue to attempt 5
    expect(results.every(r => r.status === 'success')).toBe(true);
    expect(fn).toHaveBeenCalledTimes(4); // 3 initial + 1 retry for item 2
  });

  it('should provide index to processing function', async () => {
    const items = ['a', 'b', 'c'];
    const fn = vi.fn((item: string, index: number) => {
      return Promise.resolve(`${item}-${index}`);
    });

    const promise = withParallelRetry(items, fn);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results[0].value).toBe('a-0');
    expect(results[1].value).toBe('b-1');
    expect(results[2].value).toBe('c-2');
    expect(fn).toHaveBeenCalledWith('a', 0);
    expect(fn).toHaveBeenCalledWith('b', 1);
    expect(fn).toHaveBeenCalledWith('c', 2);
  });

  it('should log progress', async () => {
    const items = [1, 2, 3];
    const fn = vi.fn((item: number) => Promise.resolve(item * 2));

    const promise = withParallelRetry(items, fn, {
      maxAttempts: 2,
      logger: mockLogger,
      operationName: 'multiply',
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(mockLogger.info).toHaveBeenCalled();
    // Check that it logged attempt info
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, total: 3 }),
      expect.stringContaining('multiply')
    );
  });

  it('should handle empty array', async () => {
    const items: number[] = [];
    const fn = vi.fn((item: number) => Promise.resolve(item));

    const promise = withParallelRetry(items, fn);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('should use default options', async () => {
    const items = [1, 2];
    const fn = vi.fn((item: number) => Promise.resolve(item));

    const promise = withParallelRetry(items, fn);
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === 'success')).toBe(true);
  });

  it('should respect shouldRetry and skip retries for non-retryable errors', async () => {
    const items = [1, 2, 3];
    const retryableError = new Error('Retryable: timeout');
    const permanentError = new Error('Permanent: 401 unauthorized');

    const fn = vi.fn((item: number) => {
      if (item === 2) return Promise.reject(permanentError);
      if (item === 3) return Promise.reject(retryableError);
      return Promise.resolve(item * 2);
    });

    // Only retry retryable errors, not permanent ones
    const shouldRetry = vi.fn((error: unknown) => {
      return error === retryableError;
    });

    const promise = withParallelRetry(items, fn, {
      maxAttempts: 3,
      logger: mockLogger,
      shouldRetry,
    });

    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(3);
    // Item 1 succeeds immediately
    expect(results[0]).toEqual({ index: 0, status: 'success', value: 2, attempts: 1 });
    // Item 2 fails permanently - should NOT be retried (only 1 attempt)
    expect(results[1].status).toBe('failed');
    expect(results[1].attempts).toBe(1);
    expect(results[1].error).toBe(permanentError);
    // Item 3 fails with retryable error - should be retried (3 attempts)
    expect(results[2].status).toBe('failed');
    expect(results[2].attempts).toBe(3);
    expect(results[2].error).toBe(retryableError);

    // shouldRetry should have been called for each failed item on each attempt
    expect(shouldRetry).toHaveBeenCalled();
  });
});
