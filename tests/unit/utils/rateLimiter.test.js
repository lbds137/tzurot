const RateLimiter = require('../../../src/utils/rateLimiter');
const logger = require('../../../src/logger');

// Mock the logger
jest.mock('../../../src/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

describe('RateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const limiter = new RateLimiter();

      expect(limiter.minRequestSpacing).toBe(6000);
      expect(limiter.maxConcurrent).toBe(1);
      expect(limiter.maxConsecutiveRateLimits).toBe(3);
      expect(limiter.cooldownPeriod).toBe(60000);
      expect(limiter.maxRetries).toBe(5);
      expect(limiter.logPrefix).toBe('[RateLimiter]');
      expect(limiter.lastRequestTime).toBe(0);
      expect(limiter.consecutiveRateLimits).toBe(0);
      expect(limiter.activeRequests).toBe(0);
      expect(limiter.requestQueue).toEqual([]);
      expect(limiter.inCooldown).toBe(false);
      expect(limiter.currentRequestContext).toBe(null);
    });

    it('should initialize with custom options', () => {
      const options = {
        minRequestSpacing: 5000,
        maxConcurrent: 3,
        maxConsecutiveRateLimits: 5,
        cooldownPeriod: 120000,
        maxRetries: 10,
        logPrefix: '[CustomRateLimiter]',
      };

      const limiter = new RateLimiter(options);

      expect(limiter.minRequestSpacing).toBe(5000);
      expect(limiter.maxConcurrent).toBe(3);
      expect(limiter.maxConsecutiveRateLimits).toBe(5);
      expect(limiter.cooldownPeriod).toBe(120000);
      expect(limiter.maxRetries).toBe(10);
      expect(limiter.logPrefix).toBe('[CustomRateLimiter]');
    });
  });

  describe('enqueue', () => {
    it('should execute requests immediately when queue is empty', async () => {
      const limiter = new RateLimiter();
      const requestFn = jest.fn().mockResolvedValue('result');

      const promise = limiter.enqueue(requestFn, { id: 1 });

      // Execute pending timers
      jest.runAllTimers();

      const result = await promise;

      expect(result).toBe('result');
      expect(requestFn).toHaveBeenCalledWith(limiter, { id: 1 });
      expect(logger.debug).toHaveBeenCalledWith('[RateLimiter] Request added to queue (length: 1)');
    });

    it('should handle request execution errors gracefully', async () => {
      const limiter = new RateLimiter();
      const error = new Error('Request failed');
      const requestFn = jest.fn().mockRejectedValue(error);

      const promise = limiter.enqueue(requestFn, { id: 1 });

      jest.runAllTimers();

      const result = await promise;

      expect(result).toBe(null);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Request execution failed: Request failed')
      );
    });

    it('should set and clear currentRequestContext during execution', async () => {
      const limiter = new RateLimiter();
      const context = { id: 1, type: 'test' };
      let contextDuringExecution = null;

      const requestFn = jest.fn().mockImplementation(rateLimiter => {
        contextDuringExecution = rateLimiter.getCurrentRequestContext();
        return Promise.resolve('result');
      });

      const promise = limiter.enqueue(requestFn, context);

      jest.runAllTimers();

      await promise;

      expect(contextDuringExecution).toEqual(context);
      expect(limiter.getCurrentRequestContext()).toBe(null);
    });
  });

  describe('processQueue', () => {
    it('should respect minRequestSpacing between requests', async () => {
      const limiter = new RateLimiter({ minRequestSpacing: 5000 });
      const requestFn1 = jest.fn().mockImplementation(() => {
        // Simulate request completion
        return Promise.resolve('result1');
      });
      const requestFn2 = jest.fn().mockResolvedValue('result2');

      // Enqueue two requests
      limiter.enqueue(requestFn1);
      limiter.enqueue(requestFn2);

      // First request should execute immediately
      jest.runAllTimers();
      expect(requestFn1).toHaveBeenCalled();

      // Complete first request to trigger queue processing
      await Promise.resolve();

      // Second request should not execute yet
      expect(requestFn2).not.toHaveBeenCalled();

      // Process the scheduled timer for the second request
      jest.runAllTimers();
      expect(requestFn2).toHaveBeenCalled();
    });

    it('should handle concurrent requests up to maxConcurrent limit', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 2, minRequestSpacing: 0 });
      let resolvers = [];
      const requestFn = jest.fn().mockImplementation(
        () =>
          new Promise(resolve => {
            resolvers.push(resolve);
          })
      );

      // Enqueue three requests
      limiter.enqueue(requestFn);
      limiter.enqueue(requestFn);
      limiter.enqueue(requestFn);

      // Process initial queue
      jest.runAllTimers();

      // First two should execute immediately
      expect(requestFn).toHaveBeenCalledTimes(2);
      expect(limiter.activeRequests).toBe(2);

      // Complete one request
      resolvers[0]('done');
      await Promise.resolve();

      // Process queue again
      jest.runAllTimers();

      // Third request should now execute
      expect(requestFn).toHaveBeenCalledTimes(3);
    });

    it('should enter cooldown mode after too many consecutive rate limits', () => {
      const limiter = new RateLimiter({
        maxConsecutiveRateLimits: 2,
        cooldownPeriod: 30000,
      });

      // Set consecutive rate limits
      limiter.consecutiveRateLimits = 2;

      const requestFn = jest.fn().mockResolvedValue('result');
      limiter.enqueue(requestFn);

      // Try to process queue
      limiter.processQueue();

      expect(limiter.inCooldown).toBe(true);
      expect(requestFn).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Too many consecutive rate limits')
      );

      // Advance time to end of cooldown
      jest.advanceTimersByTime(30000);

      expect(limiter.inCooldown).toBe(false);
      expect(limiter.consecutiveRateLimits).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Global cooldown period ended')
      );
    });

    it('should not process requests while in cooldown', () => {
      const limiter = new RateLimiter();
      limiter.inCooldown = true;

      const requestFn = jest.fn().mockResolvedValue('result');
      limiter.requestQueue.push(() => requestFn());

      limiter.processQueue();

      expect(requestFn).not.toHaveBeenCalled();
    });

    it('should add jitter to prevent synchronized requests', async () => {
      // Mock Math.random to control jitter
      const originalRandom = Math.random;
      Math.random = jest
        .fn()
        .mockReturnValueOnce(0) // First jitter = 0
        .mockReturnValueOnce(0.999); // Second jitter = 499

      const limiter = new RateLimiter({ minRequestSpacing: 1000 });
      const requestFn = jest.fn().mockResolvedValue('result');

      limiter.enqueue(requestFn);
      limiter.enqueue(requestFn);

      // First request executes immediately
      jest.runAllTimers();
      expect(requestFn).toHaveBeenCalledTimes(1);

      // Complete first request to trigger queue processing
      await Promise.resolve();

      // Second request should be scheduled with delay + jitter
      jest.runAllTimers();
      expect(requestFn).toHaveBeenCalledTimes(2);

      Math.random = originalRandom;
    });
  });

  describe('handleRateLimit', () => {
    it('should implement exponential backoff for rate limits', async () => {
      const limiter = new RateLimiter();

      const retryCountPromise = limiter.handleRateLimit('test-resource', null, 0);

      // Should wait baseWaitTime * 2^0 + jitter (3000ms + jitter)
      jest.advanceTimersByTime(3500);

      const retryCount = await retryCountPromise;

      expect(retryCount).toBe(1);
      expect(limiter.consecutiveRateLimits).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limited for test-resource, retry 1/5')
      );
    });

    it('should use retry-after header when provided', async () => {
      const limiter = new RateLimiter();

      const retryCountPromise = limiter.handleRateLimit('test-resource', 5, 0);

      // Should wait 5 seconds (5000ms)
      jest.advanceTimersByTime(5000);

      const retryCount = await retryCountPromise;

      expect(retryCount).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('retry 1/5 after 5000ms'));
    });

    it('should return max retries when consecutive rate limits exceed threshold', async () => {
      const limiter = new RateLimiter({ maxConsecutiveRateLimits: 2 });
      limiter.consecutiveRateLimits = 1; // Already had one rate limit

      const retryCount = await limiter.handleRateLimit('test-resource');

      expect(retryCount).toBe(limiter.maxRetries);
      expect(limiter.consecutiveRateLimits).toBe(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Too many consecutive rate limits')
      );
    });

    it('should give up after max retries', async () => {
      const limiter = new RateLimiter({ maxRetries: 3 });

      const retryCount = await limiter.handleRateLimit('test-resource', null, 3);

      expect(retryCount).toBe(3);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Exceeded maximum retries (3) for test-resource')
      );
    });

    it('should implement proper exponential backoff for multiple retries', async () => {
      const limiter = new RateLimiter();

      // Mock Math.random for predictable jitter
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.5); // jitter = 250

      // First retry: 3000 * 2^0 + 250 = 3250ms
      const retry1Promise = limiter.handleRateLimit('test-resource', null, 0);
      jest.advanceTimersByTime(3250);
      const retry1 = await retry1Promise;
      expect(retry1).toBe(1);

      // Reset consecutive rate limits after first retry
      limiter.consecutiveRateLimits = 0;

      // Second retry: 3000 * 2^1 + 250 = 6250ms
      const retry2Promise = limiter.handleRateLimit('test-resource', null, 1);
      jest.advanceTimersByTime(6250);
      const retry2 = await retry2Promise;
      expect(retry2).toBe(2);

      // Reset consecutive rate limits after second retry
      limiter.consecutiveRateLimits = 0;

      // Third retry: 3000 * 2^2 + 250 = 12250ms
      const retry3Promise = limiter.handleRateLimit('test-resource', null, 2);
      jest.advanceTimersByTime(12250);
      const retry3 = await retry3Promise;
      expect(retry3).toBe(3);

      Math.random = originalRandom;
    });
  });

  describe('recordSuccess', () => {
    it('should reset consecutive rate limits counter on success', () => {
      const limiter = new RateLimiter();
      limiter.consecutiveRateLimits = 3;

      limiter.recordSuccess();

      expect(limiter.consecutiveRateLimits).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Resetting consecutive rate limit counter')
      );
    });

    it('should not log when counter is already zero', () => {
      const limiter = new RateLimiter();
      limiter.consecutiveRateLimits = 0;

      limiter.recordSuccess();

      expect(limiter.consecutiveRateLimits).toBe(0);
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentRequestContext', () => {
    it('should return null when no request is executing', () => {
      const limiter = new RateLimiter();

      expect(limiter.getCurrentRequestContext()).toBe(null);
    });

    it('should return context during request execution', async () => {
      const limiter = new RateLimiter();
      const context = { userId: '123', action: 'test' };
      let capturedContext = null;

      const requestFn = jest.fn().mockImplementation(rateLimiter => {
        capturedContext = rateLimiter.getCurrentRequestContext();
        return Promise.resolve('done');
      });

      const promise = limiter.enqueue(requestFn, context);
      jest.runAllTimers();
      await promise;

      expect(capturedContext).toEqual(context);
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple requests with rate limiting and backoff', async () => {
      const limiter = new RateLimiter({
        minRequestSpacing: 1000,
        maxConcurrent: 1,
      });

      const results = [];
      const requestFn = jest.fn().mockImplementation((rateLimiter, context) => {
        results.push(context.id);
        rateLimiter.recordSuccess();
        return Promise.resolve(`result-${context.id}`);
      });

      // Enqueue multiple requests
      const promises = [];
      for (let i = 1; i <= 3; i++) {
        promises.push(limiter.enqueue(requestFn, { id: i }));
      }

      // Process all requests
      jest.runAllTimers();
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();

      const finalResults = await Promise.all(promises);

      expect(results).toEqual([1, 2, 3]);
      expect(finalResults).toEqual(['result-1', 'result-2', 'result-3']);
      expect(requestFn).toHaveBeenCalledTimes(3);
    });

    it('should recover from cooldown and process queued requests', async () => {
      const limiter = new RateLimiter({
        maxConsecutiveRateLimits: 2,
        cooldownPeriod: 10000,
      });

      // Simulate rate limits
      limiter.consecutiveRateLimits = 2;

      const requestFn = jest.fn().mockResolvedValue('success');

      // Enqueue request during cooldown
      const promise = limiter.enqueue(requestFn);

      // Should enter cooldown
      expect(limiter.inCooldown).toBe(true);
      expect(requestFn).not.toHaveBeenCalled();

      // Wait for cooldown to end
      jest.advanceTimersByTime(10000);

      // Request should now be processed
      expect(limiter.inCooldown).toBe(false);
      expect(requestFn).toHaveBeenCalled();

      const result = await promise;
      expect(result).toBe('success');
    });
  });
});
