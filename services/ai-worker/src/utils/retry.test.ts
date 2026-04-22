/**
 * Retry Service Tests
 *
 * Tests for retry and timeout utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { TimeoutError } from '@tzurot/common-types';
import { withRetry, withTimeout, RetryError } from './retry.js';

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

    it('should include getErrorContext in exhaustion error log', async () => {
      const error = new Error('Persistent failure');
      const fn = vi.fn().mockRejectedValue(error);
      const getErrorContext = vi.fn().mockReturnValue({
        errorCategory: 'SERVER_ERROR',
        errorType: 'TRANSIENT',
        shouldRetry: true,
      });

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
        logger: mockLogger,
        operationName: 'exhaustion-test',
        getErrorContext,
      });

      const assertionPromise = expect(promise).rejects.toThrow(RetryError);
      await vi.runAllTimersAsync();
      await assertionPromise;

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCategory: 'SERVER_ERROR',
          errorType: 'TRANSIENT',
          shouldRetry: true,
        }),
        expect.any(String)
      );
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

    it('should call getErrorContext and spread result into log on retryable error', async () => {
      const apiError = new Error('Rate limited');
      const fn = vi.fn().mockRejectedValueOnce(apiError).mockResolvedValue('success');
      const getErrorContext = vi.fn().mockReturnValue({
        errorCategory: 'RATE_LIMIT',
        errorType: 'TRANSIENT',
        shouldRetry: true,
      });

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
        logger: mockLogger,
        operationName: 'test-op',
        getErrorContext,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(getErrorContext).toHaveBeenCalledWith(apiError);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCategory: 'RATE_LIMIT',
          errorType: 'TRANSIENT',
          shouldRetry: true,
        }),
        expect.any(String)
      );
    });

    it('should call getErrorContext in handleNonRetryableError path', async () => {
      const permanentError = new Error('Auth failed');
      const fn = vi.fn().mockRejectedValue(permanentError);
      const getErrorContext = vi.fn().mockReturnValue({
        errorCategory: 'AUTHENTICATION',
        errorType: 'PERMANENT',
        shouldRetry: false,
      });

      const promise = withRetry(fn, {
        maxAttempts: 3,
        logger: mockLogger,
        operationName: 'auth-test',
        shouldRetry: () => false,
        getErrorContext,
      });

      const assertionPromise = expect(promise).rejects.toThrow(RetryError);
      await vi.runAllTimersAsync();
      await assertionPromise;

      expect(getErrorContext).toHaveBeenCalledWith(permanentError);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCategory: 'AUTHENTICATION',
          errorType: 'PERMANENT',
          shouldRetry: false,
        }),
        expect.any(String)
      );
    });

    it('should not suppress original error if getErrorContext throws', async () => {
      const originalError = new Error('Original API failure');
      const fn = vi.fn().mockRejectedValue(originalError);
      const getErrorContext = vi.fn().mockImplementation(() => {
        throw new Error('Bug in getErrorContext');
      });

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 100,
        logger: mockLogger,
        operationName: 'ctx-throws-test',
        getErrorContext,
      });

      const assertionPromise = expect(promise).rejects.toThrow(RetryError);
      await vi.runAllTimersAsync();
      await assertionPromise;

      // The original error should be preserved as lastError, not the getErrorContext bug
      await expect(promise).rejects.toMatchObject({
        lastError: originalError,
      });
      // getErrorContext failure should be logged as a warning
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        '[Retry] getErrorContext threw, ignoring'
      );
    });

    it('should log success with attempt and durationMs on first-attempt success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      const promise = withRetry(fn, {
        logger: mockLogger,
        operationName: 'fast-op',
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          operationName: 'fast-op',
          attempt: 1,
          durationMs: expect.any(Number),
          totalTimeMs: expect.any(Number),
        }),
        expect.stringContaining('succeeded on attempt 1')
      );
    });

    it('should log success with attempt number reflecting retry index', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('first try fails'))
        .mockResolvedValue('ok');

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 10,
        logger: mockLogger,
        operationName: 'retry-op',
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ attempt: 2, durationMs: expect.any(Number) }),
        expect.stringContaining('succeeded on attempt 2')
      );
    });

    it('should include durationMs in per-attempt failure log', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 10,
        logger: mockLogger,
        operationName: 'fail-log-op',
      });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          operationName: 'fail-log-op',
          attempt: 1,
          maxAttempts: 2,
          durationMs: expect.any(Number),
        }),
        expect.stringContaining('failed (attempt 1/2)')
      );
    });

    it('should include operationName in exhaustion log', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('permanent failure'));

      const promise = withRetry(fn, {
        maxAttempts: 2,
        initialDelayMs: 10,
        logger: mockLogger,
        operationName: 'exhaust-op',
      });
      const assertion = expect(promise).rejects.toThrow(RetryError);
      await vi.runAllTimersAsync();
      await assertion;

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          operationName: 'exhaust-op',
          attempts: 2,
          totalTimeMs: expect.any(Number),
        }),
        expect.stringContaining('exhausted all retry attempts')
      );
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

    it('should throw TimeoutError if operation exceeds timeout', async () => {
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

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      let caught: unknown;
      const catcher = promise.catch(e => {
        caught = e;
      });

      // Advance timers to trigger the timeout
      await vi.advanceTimersByTimeAsync(timeoutMs);
      await catcher;

      // Verify typed sentinel and all properties in one place
      expect(caught).toBeInstanceOf(TimeoutError);
      const err = caught as TimeoutError;
      expect(err.timeoutMs).toBe(50);
      expect(err.operationName).toBe('test-operation');
      expect(err.message).toBe('test-operation timed out after 50ms');
      expect(err.name).toBe('TimeoutError');
      expect(err.cause).toBeDefined();
    });

    it('should propagate non-timeout errors', async () => {
      const fn = vi.fn(() => {
        throw new Error('Custom error');
      });

      await expect(withTimeout(fn, 5000)).rejects.toThrow('Custom error');
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
