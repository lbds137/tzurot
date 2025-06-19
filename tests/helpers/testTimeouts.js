/**
 * Test helper utilities for managing timeouts and preventing long-running tests
 */

/**
 * Sets up fake timers for tests that involve timeouts or delays
 * This prevents tests from actually waiting for real time to pass
 *
 * @example
 * beforeEach(() => {
 *   setupFakeTimers();
 * });
 *
 * afterEach(() => {
 *   cleanupFakeTimers();
 * });
 */
function setupFakeTimers() {
  jest.useFakeTimers();
}

/**
 * Cleans up fake timers and restores real timers
 */
function cleanupFakeTimers() {
  jest.clearAllTimers();
  jest.useRealTimers();
}

/**
 * Mocks a fetch operation that would timeout, allowing tests to control when it fails
 * @param {Function} mockFetch - The mocked fetch function (e.g., nodeFetch)
 * @param {number} delay - The delay before the operation should fail (default: 60000ms)
 * @returns {Object} - Object with abort function to manually trigger the timeout
 */
function mockTimeoutFetch(mockFetch, delay = 60000) {
  let rejectFn;
  let timeoutId;

  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';

  mockFetch.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        rejectFn = reject;
        timeoutId = setTimeout(() => reject(abortError), delay);
      })
  );

  return {
    abort: () => {
      if (rejectFn) {
        clearTimeout(timeoutId);
        rejectFn(abortError);
      }
    },
    advanceToTimeout: () => {
      jest.advanceTimersByTime(delay);
    },
  };
}

/**
 * Mocks a slow operation that would eventually succeed
 * Useful for testing timeout behavior without waiting
 *
 * @param {Function} mockFn - The function to mock
 * @param {*} resolveValue - The value to resolve with
 * @param {number} delay - The delay before resolving (default: 60000ms)
 */
function mockSlowOperation(mockFn, resolveValue, delay = 60000) {
  mockFn.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        setTimeout(() => resolve(resolveValue), delay);
      })
  );
}

/**
 * Helper to test operations with AbortController
 * Sets up the mock to properly handle abort signals
 *
 * @param {Function} mockFetch - The mocked fetch function
 * @param {Object} options - Options for the mock
 * @returns {Object} - Controller and promise for the operation
 */
function setupAbortableOperation(mockFetch, options = {}) {
  const { shouldSucceed = false, successValue = null, delay = 30000 } = options;

  let abortListener;
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';

  const promise = new Promise((resolve, reject) => {
    mockFetch.mockImplementationOnce((url, fetchOptions) => {
      // Set up abort listener if signal is provided
      if (fetchOptions && fetchOptions.signal) {
        abortListener = () => reject(abortError);
        fetchOptions.signal.addEventListener('abort', abortListener);
      }

      if (shouldSucceed) {
        // Simulate successful completion before timeout
        setTimeout(() => resolve(successValue), delay / 2);
      } else {
        // Simulate operation that takes longer than timeout
        setTimeout(() => resolve(successValue), delay * 2);
      }

      return new Promise((innerResolve, innerReject) => {
        if (fetchOptions && fetchOptions.signal) {
          fetchOptions.signal.addEventListener('abort', () => innerReject(abortError));
        }
      });
    });
  });

  return { promise, abortListener };
}

/**
 * Jest configuration to set default timeout for all tests
 * Add this to your test files or jest setup
 */
const DEFAULT_TEST_TIMEOUT = 5000; // 5 seconds

/**
 * Wrapper for async tests that enforces a timeout
 * @param {string} name - Test name
 * @param {Function} fn - Test function
 * @param {number} timeout - Custom timeout (default: 5000ms)
 */
function testWithTimeout(name, fn, timeout = DEFAULT_TEST_TIMEOUT) {
  return test(name, fn, timeout);
}

module.exports = {
  setupFakeTimers,
  cleanupFakeTimers,
  mockTimeoutFetch,
  mockSlowOperation,
  setupAbortableOperation,
  DEFAULT_TEST_TIMEOUT,
  testWithTimeout,
};
