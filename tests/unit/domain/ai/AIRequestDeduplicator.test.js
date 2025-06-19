const { AIRequestDeduplicator } = require('../../../../src/domain/ai/AIRequestDeduplicator');

describe('AIRequestDeduplicator', () => {
  let deduplicator;
  let mockTimers;
  let currentTime;

  beforeEach(() => {
    currentTime = 1000;
    mockTimers = {
      now: jest.fn(() => currentTime),
      setTimeout: jest.fn((fn, ms) => {
        // Return a mock timer ID
        return { id: Math.random() };
      }),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(),
      clearInterval: jest.fn(),
    };

    deduplicator = new AIRequestDeduplicator({
      timers: mockTimers,
      requestTTL: 5000,
      errorBlackoutDuration: 10000,
      cleanupInterval: 30000,
    });
  });

  afterEach(() => {
    if (deduplicator) {
      deduplicator.clear();
    }
  });

  describe('constructor', () => {
    it('should require timer functions', () => {
      expect(() => new AIRequestDeduplicator()).toThrow(
        'Timer functions must be provided via config.timers'
      );
    });

    it('should initialize with default configuration', () => {
      const d = new AIRequestDeduplicator({ timers: mockTimers });
      expect(d.config.requestTTL).toBe(30000);
      expect(d.config.errorBlackoutDuration).toBe(60000);
      expect(d.config.cleanupInterval).toBe(60000);
    });

    it('should accept custom configuration', () => {
      expect(deduplicator.config.requestTTL).toBe(5000);
      expect(deduplicator.config.errorBlackoutDuration).toBe(10000);
      expect(deduplicator.config.cleanupInterval).toBe(30000);
    });

    it('should schedule cleanup on initialization', () => {
      expect(mockTimers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
    });
  });

  describe('checkDuplicate', () => {
    it('should return null for new requests', async () => {
      const result = await deduplicator.checkDuplicate('TestBot', 'Hello');
      expect(result).toBeNull();
    });

    it('should return existing promise for duplicate requests', async () => {
      const promise = Promise.resolve('response');
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);

      const result = deduplicator.checkDuplicate('TestBot', 'Hello');
      expect(result).toBeTruthy();
      // Verify it's the same promise by checking resolved value
      await expect(result).resolves.toBe('response');
    });

    it('should throw error for requests in blackout period', async () => {
      deduplicator.markFailed('TestBot', 'Hello');

      await expect(deduplicator.checkDuplicate('TestBot', 'Hello')).rejects.toThrow(
        'Request is in error blackout period'
      );
    });

    it('should be case-insensitive for personality names', async () => {
      const promise = Promise.resolve('response');
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);

      const result = deduplicator.checkDuplicate('testbot', 'Hello');
      expect(result).toBeTruthy();
      // Verify it's the same promise by checking resolved value
      await expect(result).resolves.toBe('response');
    });

    it('should consider context in deduplication', async () => {
      const promise1 = Promise.resolve('response1');
      const promise2 = Promise.resolve('response2');

      deduplicator.registerPending('TestBot', 'Hello', { userAuth: 'user1' }, promise1);
      deduplicator.registerPending('TestBot', 'Hello', { userAuth: 'user2' }, promise2);

      const result1 = deduplicator.checkDuplicate('TestBot', 'Hello', { userAuth: 'user1' });
      const result2 = deduplicator.checkDuplicate('TestBot', 'Hello', { userAuth: 'user2' });

      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();
      // Verify they are different promises with different values
      await expect(result1).resolves.toBe('response1');
      await expect(result2).resolves.toBe('response2');
    });
  });

  describe('registerPending', () => {
    it('should register a pending request', () => {
      const promise = Promise.resolve('response');
      const signature = deduplicator.registerPending('TestBot', 'Hello', {}, promise);

      expect(signature).toBeTruthy();
      expect(deduplicator.pendingRequests.size).toBe(1);
    });

    it('should clean up after promise resolves', async () => {
      const promise = Promise.resolve('response');
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);

      expect(deduplicator.pendingRequests.size).toBe(1);

      // Wait for the promise and its finally handler
      await promise;
      // Use Jest's timer helpers to flush microtasks
      await Promise.resolve();

      expect(deduplicator.pendingRequests.size).toBe(0);
    });

    it('should add to blackout on promise rejection', async () => {
      const promise = Promise.reject(new Error('API error'));
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);

      // Wait for the promise chain to complete (including catch handler)
      await promise.catch(() => {}); // Catch to prevent unhandled rejection
      // Give the internal catch handler time to execute
      await Promise.resolve();
      await Promise.resolve();

      expect(deduplicator.errorBlackouts.size).toBe(1);
    });
  });

  describe('markFailed', () => {
    it('should add request to blackout', () => {
      deduplicator.markFailed('TestBot', 'Hello');

      expect(deduplicator.errorBlackouts.size).toBe(1);
      const blackoutUntil = deduplicator.errorBlackouts.values().next().value;
      expect(blackoutUntil).toBe(currentTime + 10000);
    });
  });

  describe('cleanup', () => {
    it('should remove stale pending requests', () => {
      const promise = new Promise(() => {}); // Never resolves
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);

      // Advance time past TTL
      currentTime += 6000;

      // Trigger cleanup
      deduplicator._cleanupStaleEntries();

      expect(deduplicator.pendingRequests.size).toBe(0);
    });

    it('should remove expired blackouts', () => {
      deduplicator.markFailed('TestBot', 'Hello');
      expect(deduplicator.errorBlackouts.size).toBe(1);

      // Advance time past blackout duration
      currentTime += 11000;

      // Trigger cleanup
      deduplicator._cleanupStaleEntries();

      expect(deduplicator.errorBlackouts.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      const promise = new Promise(() => {});
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);
      deduplicator.markFailed('TestBot', 'World');

      const stats = deduplicator.getStats();
      expect(stats).toEqual({
        pendingRequests: 1,
        errorBlackouts: 1,
      });
    });
  });

  describe('clear', () => {
    it('should clear all state', () => {
      const promise = new Promise(() => {});
      deduplicator.registerPending('TestBot', 'Hello', {}, promise);
      deduplicator.markFailed('TestBot', 'World');

      deduplicator.clear();

      expect(deduplicator.pendingRequests.size).toBe(0);
      expect(deduplicator.errorBlackouts.size).toBe(0);
      expect(mockTimers.clearTimeout).toHaveBeenCalled();
    });
  });
});
