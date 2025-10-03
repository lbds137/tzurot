/**
 * Request Tracker Module
 *
 * Manages request tracking to prevent duplicate processing of messages.
 * This module tracks active requests by user-channel-personality combinations
 * to ensure the same request isn't processed multiple times concurrently.
 */

const logger = require('../logger');

// Map to track active requests and prevent duplicates
const activeRequests = new Map();

/**
 * Track a request to prevent duplicates
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {string} personalityName - Personality name
 * @returns {string|null} Request key if successful, null if duplicate
 */
function trackRequest(userId, channelId, personalityName) {
  const requestKey = `${userId}-${channelId}-${personalityName}`;

  // Check if this request is already in progress
  if (activeRequests.has(requestKey)) {
    logger.info(`[RequestTracker] Ignoring duplicate request: ${requestKey}`);
    return null;
  }

  // Track this request
  activeRequests.set(requestKey, Date.now());
  return requestKey;
}

/**
 * Remove a tracked request when processing is complete
 * @param {string} requestKey - The request key to remove
 */
function removeRequest(requestKey) {
  if (requestKey && activeRequests.has(requestKey)) {
    activeRequests.delete(requestKey);
    logger.debug(`[RequestTracker] Removed request: ${requestKey}`);
  }
}

/**
 * Check if a request is currently being processed
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {string} personalityName - Personality name
 * @returns {boolean} True if request is active
 */
function isRequestActive(userId, channelId, personalityName) {
  const requestKey = `${userId}-${channelId}-${personalityName}`;
  return activeRequests.has(requestKey);
}

/**
 * Get the number of active requests
 * @returns {number} Number of active requests
 */
function getActiveRequestCount() {
  return activeRequests.size;
}

/**
 * Clear all active requests (for testing or reset)
 */
function clearAllRequests() {
  activeRequests.clear();
  logger.info('[RequestTracker] Cleared all active requests');
}

/**
 * Get age of a request in milliseconds
 * @param {string} requestKey - The request key
 * @returns {number|null} Age in milliseconds or null if not found
 */
function getRequestAge(requestKey) {
  const timestamp = activeRequests.get(requestKey);
  return timestamp ? Date.now() - timestamp : null;
}

/**
 * Clean up stale requests (older than specified age)
 * @param {number} maxAgeMs - Maximum age in milliseconds (default: 5 minutes)
 * @returns {number} Number of requests cleaned up
 */
function cleanupStaleRequests(maxAgeMs = 5 * 60 * 1000) {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, timestamp] of activeRequests.entries()) {
    if (now - timestamp > maxAgeMs) {
      activeRequests.delete(key);
      cleaned++;
      logger.info(`[RequestTracker] Cleaned up stale request: ${key}`);
    }
  }

  if (cleaned > 0) {
    logger.info(`[RequestTracker] Cleaned up ${cleaned} stale requests`);
  }

  return cleaned;
}

module.exports = {
  trackRequest,
  removeRequest,
  isRequestActive,
  getActiveRequestCount,
  clearAllRequests,
  getRequestAge,
  cleanupStaleRequests,
  activeRequests, // Export for backward compatibility
};
