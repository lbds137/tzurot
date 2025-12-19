/**
 * Notification Cache Tests
 *
 * Tests for the rate-limiting notification cache used by ActivatedChannelProcessor.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { INTERVALS } from '@tzurot/common-types';
import {
  shouldNotifyUser,
  _resetNotificationCacheForTesting,
  _getNotificationCacheSizeForTesting,
  _addNotificationCacheEntryForTesting,
  _triggerCleanupForTesting,
} from './notificationCache.js';

describe('notificationCache', () => {
  beforeEach(() => {
    _resetNotificationCacheForTesting();
  });

  describe('shouldNotifyUser', () => {
    it('should return true for first notification to a user', () => {
      const result = shouldNotifyUser('channel-1', 'user-1');
      expect(result).toBe(true);
    });

    it('should return false for repeated notification within cooldown', () => {
      // First notification - should return true
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(true);

      // Immediate second notification - should return false (rate limited)
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(false);
    });

    it('should track different users separately', () => {
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(true);
      expect(shouldNotifyUser('channel-1', 'user-2')).toBe(true);
      expect(shouldNotifyUser('channel-1', 'user-3')).toBe(true);
    });

    it('should track different channels separately', () => {
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(true);
      expect(shouldNotifyUser('channel-2', 'user-1')).toBe(true);
      expect(shouldNotifyUser('channel-3', 'user-1')).toBe(true);
    });

    it('should rate limit same user in same channel', () => {
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(true);
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(false);
      expect(shouldNotifyUser('channel-1', 'user-1')).toBe(false);
    });
  });

  describe('cleanupNotificationCache', () => {
    it('should remove expired cache entries during cleanup', () => {
      const now = Date.now();
      const expiredTimestamp = now - INTERVALS.ONE_HOUR_MS - 1000; // 1 second past expiry
      const recentTimestamp = now - 1000; // 1 second ago (not expired)

      // Add expired entry
      _addNotificationCacheEntryForTesting('expired-channel', 'expired-user', expiredTimestamp);
      // Add recent entry
      _addNotificationCacheEntryForTesting('recent-channel', 'recent-user', recentTimestamp);

      expect(_getNotificationCacheSizeForTesting()).toBe(2);

      // Trigger cleanup
      _triggerCleanupForTesting();

      // Only the expired entry should be removed
      expect(_getNotificationCacheSizeForTesting()).toBe(1);
    });

    it('should keep entries that are within the cooldown period', () => {
      const now = Date.now();
      const withinCooldown = now - INTERVALS.ONE_HOUR_MS + 60000; // 1 minute before expiry

      _addNotificationCacheEntryForTesting('test-channel', 'test-user', withinCooldown);

      expect(_getNotificationCacheSizeForTesting()).toBe(1);

      _triggerCleanupForTesting();

      // Entry should still exist (not expired)
      expect(_getNotificationCacheSizeForTesting()).toBe(1);
    });

    it('should remove all expired entries when multiple exist', () => {
      const now = Date.now();
      const expired1 = now - INTERVALS.ONE_HOUR_MS - 1000;
      const expired2 = now - INTERVALS.ONE_HOUR_MS - 2000;
      const expired3 = now - INTERVALS.ONE_HOUR_MS - 3000;

      _addNotificationCacheEntryForTesting('channel-1', 'user-1', expired1);
      _addNotificationCacheEntryForTesting('channel-2', 'user-2', expired2);
      _addNotificationCacheEntryForTesting('channel-3', 'user-3', expired3);

      expect(_getNotificationCacheSizeForTesting()).toBe(3);

      _triggerCleanupForTesting();

      // All entries should be removed
      expect(_getNotificationCacheSizeForTesting()).toBe(0);
    });

    it('should handle empty cache gracefully', () => {
      expect(_getNotificationCacheSizeForTesting()).toBe(0);

      // Should not throw
      _triggerCleanupForTesting();

      expect(_getNotificationCacheSizeForTesting()).toBe(0);
    });
  });

  describe('test utilities', () => {
    it('should reset cache completely', () => {
      shouldNotifyUser('channel-1', 'user-1');
      shouldNotifyUser('channel-2', 'user-2');

      expect(_getNotificationCacheSizeForTesting()).toBe(2);

      _resetNotificationCacheForTesting();

      expect(_getNotificationCacheSizeForTesting()).toBe(0);
    });

    it('should allow adding entries with specific timestamps', () => {
      const customTimestamp = 1234567890;
      _addNotificationCacheEntryForTesting('channel-1', 'user-1', customTimestamp);

      expect(_getNotificationCacheSizeForTesting()).toBe(1);
    });
  });
});
