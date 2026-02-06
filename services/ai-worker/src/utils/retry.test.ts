/**
 * Retry Service Tests
 *
 * Tests for retry and timeout utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { withRetry, withTimeout, withParallelRetry, RetryError } from './retry.js';

describe('retryService', () => {
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

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const promise = withRetry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry and eventually succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValue('success');

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        logger: mockLogger,
        operationName: 'test-op',
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.value).toBe('success');
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2); // Failed attempts
      expect(mockLogger.info).toHaveBeenCalledTimes(1); // Success after retries
    });

    it('should throw RetryError after all attempts fail', async () => {
      const error = new Error('Persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      // 1. Create the promise
      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        logger: mockLogger,
      });

      // 2. Attach the assertion handler BEFORE advancing timers
      const assertionPromise = expect(promise).rejects.toThrow(RetryError);

      // 3. NOW advance the timers to trigger the rejection
      await vi.runAllTimersAsync();

      // 4. Await the assertion
      await assertionPromise;

      // 5. Synchronous assertions after the fact
      expect(fn).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should use exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        logger: mockLogger,
      });

      // First attempt - immediate
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Second attempt - after 1000ms
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Third attempt - after 2000ms (1000 * 2^1)
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(3);

      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.value).toBe('success');
    });

    it('should respect maxDelayMs cap', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('Fail')).mockResolvedValue('success');

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 10000,
        maxDelayMs: 500,
        logger: mockLogger,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Should wait 500ms (capped), not 10000ms
      await vi.advanceTimersByTimeAsync(500);
      expect(fn).toHaveBeenCalledTimes(2);

      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.value).toBe('success');
    });

    it('should respect global timeout', async () => {
      // Create a function that fails quickly but has long delays between retries
      const fn = vi.fn().mockRejectedValue(new Error('Fail'));

      const promise = withRetry(fn, {
        maxAttempts: 10,
        initialDelayMs: 200, // Long delays between retries
        backoffMultiplier: 2,
        globalTimeoutMs: 500, // Global timeout shorter than sum of retry delays
        logger: mockLogger,
        operationName: 'slow-op',
      });

      // Attach handler before advancing timers
      const assertionPromise = expect(promise).rejects.toThrow(RetryError);

      // Run all timers to completion - this will trigger the global timeout
      await vi.runAllTimersAsync();

      await assertionPromise;
      await expect(promise).rejects.toThrow('exceeded global timeout');
    });

    it('should use default options', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const promise = withRetry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
    });

    it('should normalize non-Error objects for logging', async () => {
      // LangChain sometimes throws literal {} — verify we wrap it in a real Error
      const emptyObj = {};
      const fn = vi.fn().mockRejectedValueOnce(emptyObj).mockResolvedValue('success');

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
        logger: mockLogger,
        operationName: 'llm-call',
      });

      await vi.runAllTimersAsync();
      await promise;

      // The logger should receive a real Error, not the raw {}
      const warnCall = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
      const loggedErr = warnCall[0].err;
      expect(loggedErr).toBeInstanceOf(Error);
      expect(loggedErr.name).toBe('NormalizedError');
      expect(loggedErr.message).toContain('llm-call');
      expect(loggedErr.message).toContain('{}');
    });

    it('should normalize non-Error objects in non-retryable error path', async () => {
      // Plain object thrown + shouldRetry returns false → handleNonRetryableError
      const weirdError = { code: 'QUOTA_EXCEEDED' };
      const fn = vi.fn().mockRejectedValue(weirdError);

      const promise = withRetry(fn, {
        maxAttempts: 3,
        logger: mockLogger,
        operationName: 'quota-test',
        shouldRetry: () => false,
      });

      const assertionPromise = expect(promise).rejects.toThrow(RetryError);
      await vi.runAllTimersAsync();
      await assertionPromise;

      // handleNonRetryableError should log a normalized Error
      const warnCall = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
      const loggedErr = warnCall[0].err;
      expect(loggedErr).toBeInstanceOf(Error);
      expect(loggedErr.name).toBe('NormalizedError');
      expect(loggedErr.message).toContain('QUOTA_EXCEEDED');
    });

    it('should pass through real Error instances to logger unchanged', async () => {
      const realError = new Error('Connection refused');
      const fn = vi.fn().mockRejectedValueOnce(realError).mockResolvedValue('success');

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
        logger: mockLogger,
        operationName: 'test-op',
      });

      await vi.runAllTimersAsync();
      await promise;

      const warnCall = (mockLogger.warn as ReturnType<typeof vi.fn>).mock.calls[0];
      const loggedErr = warnCall[0].err;
      // Should be the exact same Error instance, not wrapped
      expect(loggedErr).toBe(realError);
    });

    it('should include custom operation name in errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Fail'));

      const promise = withRetry(fn, {
        maxAttempts: 1,
        operationName: 'custom-operation',
      });

      // Attach handler before advancing timers
      const assertionPromise = expect(promise).rejects.toThrow(
        'custom-operation failed after 1 attempts'
      );

      await vi.runAllTimersAsync();

      await assertionPromise;
    });
  });

  describe('withTimeout', () => {
    it('should complete before timeout', async () => {
      const fn = vi.fn((_signal: AbortSignal) => {
        return Promise.resolve('success');
      });

      const result = await withTimeout(fn, 5000);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(expect.any(AbortSignal));
    });

    it('should throw timeout error if operation exceeds timeout', async () => {
      const timeoutMs = 50;

      // A function that never resolves, simulating a long-running operation
      const fn = vi.fn((signal: AbortSignal) => {
        return new Promise((_resolve, reject) => {
          // Listen for abort to properly reject with AbortError
          signal.addEventListener('abort', () => {
            const error = new Error('Aborted!');
            error.name = 'AbortError';
            reject(error);
          });
        });
      });

      const promise = withTimeout(fn, timeoutMs, 'test-operation');

      // Attach handler before advancing timers
      const assertionPromise = expect(promise).rejects.toThrow(
        'test-operation timed out after 50ms'
      );

      // Advance timers to trigger the timeout
      await vi.advanceTimersByTimeAsync(timeoutMs);

      await assertionPromise;
    });

    it('should propagate non-timeout errors', async () => {
      const fn = vi.fn(() => {
        throw new Error('Custom error');
      });

      await expect(withTimeout(fn, 5000)).rejects.toThrow('Custom error');
    });
  });

  describe('withParallelRetry', () => {
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
  });

  describe('RetryError', () => {
    it('should include attempt count and last error', () => {
      const lastError = new Error('Last failure');
      const retryError = new RetryError('Operation failed', 3, lastError);

      expect(retryError.message).toBe('Operation failed');
      expect(retryError.attempts).toBe(3);
      expect(retryError.lastError).toBe(lastError);
      expect(retryError.name).toBe('RetryError');
    });

    it('should be throwable and catchable', () => {
      const error = new RetryError('Test', 5, new Error('Inner'));

      expect(() => {
        throw error;
      }).toThrow(RetryError);

      try {
        throw error;
      } catch (e) {
        expect(e).toBeInstanceOf(RetryError);
        expect((e as RetryError).attempts).toBe(5);
      }
    });
  });
});
