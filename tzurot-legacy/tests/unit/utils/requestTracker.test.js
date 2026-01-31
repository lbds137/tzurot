const requestTracker = require('../../../src/utils/requestTracker');
const logger = require('../../../src/logger');

// Mock the logger
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
}));

describe('Request Tracker', () => {
  beforeEach(() => {
    // Clear all requests before each test
    requestTracker.clearAllRequests();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('trackRequest', () => {
    it('should track a new request and return request key', () => {
      const userId = 'user123';
      const channelId = 'channel456';
      const personalityName = 'test-personality';

      const result = requestTracker.trackRequest(userId, channelId, personalityName);

      expect(result).toBe('user123-channel456-test-personality');
      expect(requestTracker.getActiveRequestCount()).toBe(1);
    });

    it('should return null for duplicate request', () => {
      const userId = 'user123';
      const channelId = 'channel456';
      const personalityName = 'test-personality';

      // First request
      const first = requestTracker.trackRequest(userId, channelId, personalityName);
      expect(first).not.toBeNull();

      // Duplicate request
      const second = requestTracker.trackRequest(userId, channelId, personalityName);
      expect(second).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        '[RequestTracker] Ignoring duplicate request: user123-channel456-test-personality'
      );
    });

    it('should track different requests independently', () => {
      const result1 = requestTracker.trackRequest('user1', 'channel1', 'personality1');
      const result2 = requestTracker.trackRequest('user2', 'channel1', 'personality1');
      const result3 = requestTracker.trackRequest('user1', 'channel2', 'personality1');

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(result3).not.toBeNull();
      expect(requestTracker.getActiveRequestCount()).toBe(3);
    });
  });

  describe('removeRequest', () => {
    it('should remove a tracked request', () => {
      const requestKey = requestTracker.trackRequest('user123', 'channel456', 'test-personality');
      expect(requestTracker.getActiveRequestCount()).toBe(1);

      requestTracker.removeRequest(requestKey);
      expect(requestTracker.getActiveRequestCount()).toBe(0);
      expect(logger.debug).toHaveBeenCalledWith(
        '[RequestTracker] Removed request: user123-channel456-test-personality'
      );
    });

    it('should handle removing non-existent request gracefully', () => {
      requestTracker.removeRequest('non-existent-key');
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('should handle null/undefined request key', () => {
      requestTracker.removeRequest(null);
      requestTracker.removeRequest(undefined);
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });

  describe('isRequestActive', () => {
    it('should return true for active request', () => {
      requestTracker.trackRequest('user123', 'channel456', 'test-personality');

      const isActive = requestTracker.isRequestActive('user123', 'channel456', 'test-personality');
      expect(isActive).toBe(true);
    });

    it('should return false for non-active request', () => {
      const isActive = requestTracker.isRequestActive('user123', 'channel456', 'test-personality');
      expect(isActive).toBe(false);
    });
  });

  describe('getRequestAge', () => {
    it('should return age of existing request', () => {
      const requestKey = requestTracker.trackRequest('user123', 'channel456', 'test-personality');

      // Advance timers by 100ms
      jest.advanceTimersByTime(100);

      const age = requestTracker.getRequestAge(requestKey);
      expect(age).toBeGreaterThanOrEqual(100);
      expect(age).toBeLessThan(200);
    });

    it('should return null for non-existent request', () => {
      const age = requestTracker.getRequestAge('non-existent-key');
      expect(age).toBeNull();
    });
  });

  describe('cleanupStaleRequests', () => {
    it('should clean up requests older than specified age', () => {
      // Create some requests
      const key1 = requestTracker.trackRequest('user1', 'channel1', 'personality1');

      // Advance time by 100ms
      jest.advanceTimersByTime(100);

      const key2 = requestTracker.trackRequest('user2', 'channel2', 'personality2');

      // Clean up requests older than 50ms
      const cleaned = requestTracker.cleanupStaleRequests(50);

      expect(cleaned).toBe(1);
      expect(requestTracker.isRequestActive('user1', 'channel1', 'personality1')).toBe(false);
      expect(requestTracker.isRequestActive('user2', 'channel2', 'personality2')).toBe(true);
    });

    it('should return 0 when no stale requests', () => {
      requestTracker.trackRequest('user1', 'channel1', 'personality1');

      const cleaned = requestTracker.cleanupStaleRequests(5 * 60 * 1000);
      expect(cleaned).toBe(0);
    });

    it('should use default max age of 5 minutes', () => {
      // Mock Date.now to simulate old requests
      const originalNow = Date.now;
      const mockTime = originalNow();
      Date.now = jest.fn(() => mockTime);

      // Track a request
      requestTracker.trackRequest('user1', 'channel1', 'personality1');

      // Move time forward 6 minutes
      Date.now = jest.fn(() => mockTime + 6 * 60 * 1000);

      const cleaned = requestTracker.cleanupStaleRequests();
      expect(cleaned).toBe(1);

      // Restore Date.now
      Date.now = originalNow;
    });
  });

  describe('clearAllRequests', () => {
    it('should clear all active requests', () => {
      requestTracker.trackRequest('user1', 'channel1', 'personality1');
      requestTracker.trackRequest('user2', 'channel2', 'personality2');
      expect(requestTracker.getActiveRequestCount()).toBe(2);

      requestTracker.clearAllRequests();
      expect(requestTracker.getActiveRequestCount()).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('[RequestTracker] Cleared all active requests');
    });
  });

  describe('activeRequests backward compatibility', () => {
    it('should expose activeRequests Map', () => {
      expect(requestTracker.activeRequests).toBeInstanceOf(Map);

      // Should be the same instance that's used internally
      requestTracker.trackRequest('user1', 'channel1', 'personality1');
      expect(requestTracker.activeRequests.size).toBe(1);
    });
  });
});
