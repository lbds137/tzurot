/**
 * Notification Cache
 *
 * Manages rate-limiting for user notifications about private personality access.
 * Uses a time-based cache to prevent spamming users with repeated notifications.
 */

import { INTERVALS } from '@tzurot/common-types';

/** How long to wait before notifying the same user again about private personality access (1 hour) */
const NOTIFICATION_COOLDOWN_MS = INTERVALS.ONE_HOUR_MS;

/** Cache to track which users have been notified about private personality access */
const notificationCache = new Map<string, number>();

/**
 * Check if we should notify a user about private personality access.
 * Uses a cooldown to prevent spamming the same user.
 */
export function shouldNotifyUser(channelId: string, userId: string): boolean {
  const key = `${channelId}:${userId}`;
  const lastNotified = notificationCache.get(key);
  const now = Date.now();

  if (lastNotified !== undefined && now - lastNotified < NOTIFICATION_COOLDOWN_MS) {
    return false; // Still in cooldown period
  }

  notificationCache.set(key, now);
  return true;
}

/**
 * Periodically clean up old entries from the notification cache.
 * Removes entries that have expired past the cooldown period.
 */
function cleanupNotificationCache(): void {
  const now = Date.now();
  for (const [key, timestamp] of notificationCache.entries()) {
    if (now - timestamp > NOTIFICATION_COOLDOWN_MS) {
      notificationCache.delete(key);
    }
  }
}

/** Timer reference for cleanup interval */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup of the notification cache.
 * This should be called during bot initialization, not at module import time.
 * Safe for bot-client: single-instance, local UI state (not horizontally scaled)
 */
export function startNotificationCacheCleanup(): void {
  if (cleanupTimer !== null) {
    return; // Already started
  }
  cleanupTimer = setInterval(cleanupNotificationCache, INTERVALS.ONE_HOUR_MS);
}

/**
 * Stop periodic cleanup of the notification cache.
 * This should be called during bot shutdown.
 */
export function stopNotificationCacheCleanup(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ============================================================================
// Test Utilities
// ============================================================================
// These functions are exported for testing purposes only.
// They allow tests to manipulate the cache state directly.

/**
 * Reset the notification cache.
 * @internal Exported for testing only.
 */
export function _resetNotificationCacheForTesting(): void {
  notificationCache.clear();
}

/**
 * Get the current size of the notification cache.
 * @internal Exported for testing only.
 */
export function _getNotificationCacheSizeForTesting(): number {
  return notificationCache.size;
}

/**
 * Add an entry to the notification cache with a specific timestamp.
 * @internal Exported for testing only.
 */
export function _addNotificationCacheEntryForTesting(
  channelId: string,
  userId: string,
  timestamp: number
): void {
  const key = `${channelId}:${userId}`;
  notificationCache.set(key, timestamp);
}

/**
 * Trigger cleanup of the notification cache.
 * @internal Exported for testing only.
 */
export function _triggerCleanupForTesting(): void {
  cleanupNotificationCache();
}
