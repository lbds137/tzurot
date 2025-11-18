/**
 * Tests for RequestDeduplicationCache
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestDeduplicationCache } from './RequestDeduplicationCache.js';
import type { GenerateRequest } from '../types.js';

describe('RequestDeduplicationCache', () => {
  let cache: RequestDeduplicationCache;

  // Mock request for testing
  const createMockRequest = (message: string, userId = 'user-123'): GenerateRequest => ({
    personality: {
      id: 'test-personality-id',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'testbot',
      systemPrompt: 'Test system prompt',
      model: 'gpt-4',
      visionModel: undefined,
      temperature: 0.7,
      maxTokens: 1000,
      contextWindowTokens: 8000,
      characterInfo: 'Test character info',
      personalityTraits: 'Test personality traits',
    },
    message,
    context: {
      userId,
      channelId: 'channel-123',
      serverId: 'guild-123',
    },
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (cache) {
      cache.dispose();
    }
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      cache = new RequestDeduplicationCache();

      expect(cache.getCacheSize()).toBe(0);
    });

    it('should create cache with custom options', () => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 1000,
        cleanupIntervalMs: 5000,
      });

      expect(cache.getCacheSize()).toBe(0);
    });

    it('should start cleanup timer on construction', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      cache = new RequestDeduplicationCache({
        cleanupIntervalMs: 10000,
      });

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10000);
    });
  });

  describe('checkDuplicate', () => {
    beforeEach(() => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 5000,
      });
    });

    it('should return null for new request', () => {
      const request = createMockRequest('Hello world');

      const result = cache.checkDuplicate(request);

      expect(result).toBeNull();
    });

    it('should return null for uncached request', () => {
      const request = createMockRequest('Hello world');

      const result = cache.checkDuplicate(request);

      expect(result).toBeNull();
      expect(cache.getCacheSize()).toBe(0);
    });

    it('should detect duplicate request within window', () => {
      const request = createMockRequest('Hello world');

      // Cache the request
      cache.cacheRequest(request, 'req-123', 'job-456');

      // Check for duplicate
      const result = cache.checkDuplicate(request);

      expect(result).not.toBeNull();
      expect(result?.requestId).toBe('req-123');
      expect(result?.jobId).toBe('job-456');
    });

    it('should return null for expired request', () => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 1000, // 1 second window
      });

      const request = createMockRequest('Hello world');

      // Cache the request
      cache.cacheRequest(request, 'req-123', 'job-456');

      // Advance time past expiration
      vi.advanceTimersByTime(1500);

      // Should not find duplicate (expired)
      const result = cache.checkDuplicate(request);

      expect(result).toBeNull();
    });

    it('should clean up expired entry on check', () => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 1000,
      });

      const request = createMockRequest('Hello world');

      // Cache the request
      cache.cacheRequest(request, 'req-123', 'job-456');
      expect(cache.getCacheSize()).toBe(1);

      // Advance time past expiration
      vi.advanceTimersByTime(1500);

      // Check should clean up expired entry
      cache.checkDuplicate(request);

      expect(cache.getCacheSize()).toBe(0);
    });

    it('should differentiate requests by message content', () => {
      const request1 = createMockRequest('Hello world');
      const request2 = createMockRequest('Goodbye world');

      cache.cacheRequest(request1, 'req-123', 'job-456');

      // Different message should not be duplicate
      const result = cache.checkDuplicate(request2);

      expect(result).toBeNull();
    });

    it('should differentiate requests by user ID', () => {
      const request1 = createMockRequest('Hello world', 'user-123');
      const request2 = createMockRequest('Hello world', 'user-456');

      cache.cacheRequest(request1, 'req-123', 'job-456');

      // Different user should not be duplicate
      const result = cache.checkDuplicate(request2);

      expect(result).toBeNull();
    });

    it('should differentiate requests by personality', () => {
      const request1 = createMockRequest('Hello world');
      const request2 = {
        ...createMockRequest('Hello world'),
        personality: {
          ...createMockRequest('Hello world').personality,
          name: 'DifferentBot',
        },
      };

      cache.cacheRequest(request1, 'req-123', 'job-456');

      // Different personality should not be duplicate
      const result = cache.checkDuplicate(request2);

      expect(result).toBeNull();
    });
  });

  describe('cacheRequest', () => {
    beforeEach(() => {
      cache = new RequestDeduplicationCache();
    });

    it('should cache a request', () => {
      const request = createMockRequest('Hello world');

      cache.cacheRequest(request, 'req-123', 'job-456');

      expect(cache.getCacheSize()).toBe(1);
    });

    it('should update cached request if called again with same request', () => {
      const request = createMockRequest('Hello world');

      // Cache first time
      cache.cacheRequest(request, 'req-123', 'job-456');

      // Cache again with different IDs (overwrites)
      cache.cacheRequest(request, 'req-789', 'job-abc');

      expect(cache.getCacheSize()).toBe(1);

      // Should return updated cache entry
      const result = cache.checkDuplicate(request);
      expect(result?.requestId).toBe('req-789');
      expect(result?.jobId).toBe('job-abc');
    });

    it('should cache multiple different requests', () => {
      const request1 = createMockRequest('Hello world');
      const request2 = createMockRequest('Goodbye world');

      cache.cacheRequest(request1, 'req-123', 'job-456');
      cache.cacheRequest(request2, 'req-789', 'job-abc');

      expect(cache.getCacheSize()).toBe(2);
    });
  });

  describe('automatic cleanup', () => {
    it('should clean up expired entries automatically', () => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 1000,
        cleanupIntervalMs: 500,
      });

      const request1 = createMockRequest('Message 1');
      const request2 = createMockRequest('Message 2');

      // Cache two requests
      cache.cacheRequest(request1, 'req-1', 'job-1');
      cache.cacheRequest(request2, 'req-2', 'job-2');

      expect(cache.getCacheSize()).toBe(2);

      // Advance time past expiration
      vi.advanceTimersByTime(1500);

      // Trigger cleanup (runs on interval)
      vi.runOnlyPendingTimers();

      expect(cache.getCacheSize()).toBe(0);
    });

    it('should only clean up expired entries', () => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 1000,
        cleanupIntervalMs: 500,
      });

      const request1 = createMockRequest('Message 1');

      // Cache first request
      cache.cacheRequest(request1, 'req-1', 'job-1');

      // Advance time partially (not expired yet)
      vi.advanceTimersByTime(500);

      // Cache second request (fresh)
      const request2 = createMockRequest('Message 2');
      cache.cacheRequest(request2, 'req-2', 'job-2');

      expect(cache.getCacheSize()).toBe(2);

      // Advance time to expire first request but not second
      vi.advanceTimersByTime(600); // Total: 1100ms (first expired, second at 600ms)

      // Trigger cleanup
      vi.runOnlyPendingTimers();

      // First should be cleaned, second should remain
      expect(cache.getCacheSize()).toBe(1);

      // Second request should still be cached
      const result = cache.checkDuplicate(request2);
      expect(result?.jobId).toBe('job-2');
    });

    it('should run cleanup on schedule', () => {
      cache = new RequestDeduplicationCache({
        duplicateWindowMs: 1000,
        cleanupIntervalMs: 5000, // 5 second cleanup interval
      });

      const request = createMockRequest('Hello world');
      cache.cacheRequest(request, 'req-123', 'job-456');

      // Advance to first cleanup (expired)
      vi.advanceTimersByTime(1500);
      vi.runOnlyPendingTimers();
      expect(cache.getCacheSize()).toBe(0);

      // Add new request
      cache.cacheRequest(request, 'req-789', 'job-abc');

      // Advance to second cleanup (expired)
      vi.advanceTimersByTime(6000);
      vi.runOnlyPendingTimers();
      expect(cache.getCacheSize()).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should stop cleanup timer', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      cache = new RequestDeduplicationCache();
      cache.dispose();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear all cache entries', () => {
      cache = new RequestDeduplicationCache();

      const request1 = createMockRequest('Message 1');
      const request2 = createMockRequest('Message 2');

      cache.cacheRequest(request1, 'req-1', 'job-1');
      cache.cacheRequest(request2, 'req-2', 'job-2');

      expect(cache.getCacheSize()).toBe(2);

      cache.dispose();

      expect(cache.getCacheSize()).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      cache = new RequestDeduplicationCache();

      cache.dispose();
      cache.dispose(); // Should not throw

      expect(cache.getCacheSize()).toBe(0);
    });

    it('should prevent memory leaks', () => {
      cache = new RequestDeduplicationCache({
        cleanupIntervalMs: 1000,
      });

      const request = createMockRequest('Hello world');
      cache.cacheRequest(request, 'req-123', 'job-456');

      expect(cache.getCacheSize()).toBe(1);

      // Dispose should clean everything up
      cache.dispose();

      expect(cache.getCacheSize()).toBe(0);

      // Advance time and run timers (should not run cleanup after dispose)
      const sizeBefore = cache.getCacheSize();
      vi.advanceTimersByTime(5000);
      vi.runOnlyPendingTimers();

      expect(cache.getCacheSize()).toBe(sizeBefore); // No change (timer stopped)
    });
  });

  describe('getCacheSize', () => {
    beforeEach(() => {
      cache = new RequestDeduplicationCache();
    });

    it('should return 0 for empty cache', () => {
      expect(cache.getCacheSize()).toBe(0);
    });

    it('should return correct size for cached entries', () => {
      const request1 = createMockRequest('Message 1');
      const request2 = createMockRequest('Message 2');
      const request3 = createMockRequest('Message 3');

      cache.cacheRequest(request1, 'req-1', 'job-1');
      expect(cache.getCacheSize()).toBe(1);

      cache.cacheRequest(request2, 'req-2', 'job-2');
      expect(cache.getCacheSize()).toBe(2);

      cache.cacheRequest(request3, 'req-3', 'job-3');
      expect(cache.getCacheSize()).toBe(3);
    });
  });

  describe('hash collision resistance', () => {
    beforeEach(() => {
      cache = new RequestDeduplicationCache();
    });

    it('should handle very similar messages differently', () => {
      const request1 = createMockRequest('Hello world!');
      const request2 = createMockRequest('Hello world?');

      cache.cacheRequest(request1, 'req-1', 'job-1');

      // Very similar but different message should not be duplicate
      const result = cache.checkDuplicate(request2);

      expect(result).toBeNull();
    });

    it('should handle identical messages from different contexts', () => {
      const request1 = createMockRequest('Hello');
      const request2 = {
        ...createMockRequest('Hello'),
        context: {
          ...createMockRequest('Hello').context,
          channelId: 'different-channel',
        },
      };

      cache.cacheRequest(request1, 'req-1', 'job-1');

      // Same message, different channel
      const result = cache.checkDuplicate(request2);

      expect(result).toBeNull();
    });
  });
});
