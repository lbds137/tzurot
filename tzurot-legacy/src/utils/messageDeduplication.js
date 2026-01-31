/**
 * Message Deduplication Manager
 *
 * This module handles detection and prevention of duplicate messages
 * being sent through webhooks. It uses content hashing and time-based
 * expiration to identify duplicates.
 */

const logger = require('../logger');
const { TIME } = require('../constants');

// Cache to track recently sent messages to prevent duplicates
const recentMessageCache = new Map();

// Set a timeout for message caching (from constants)
const _MESSAGE_CACHE_TIMEOUT = TIME.MESSAGE_CACHE_TIMEOUT;

// Short timeout for duplicate detection (5 seconds)
const DUPLICATE_DETECTION_TIMEOUT = 5000;

// Cleanup timeout (10 seconds) - slightly longer than duplicate timeout
const CLEANUP_TIMEOUT = 10000;

/**
 * Hash a message content to create a unique identifier
 * This helps detect duplicate messages
 * @param {string} content - The message content
 * @param {string} username - The username sending the message
 * @param {string} channelId - The channel ID
 * @returns {string} - A hash representing this message
 */
function hashMessage(content, username, channelId) {
  // Create a hash using multiple parts of the content to better handle chunks
  const contentLength = content ? content.length : 0;

  // For longer messages, also include middle and end sections to differentiate chunks
  if (contentLength > 100) {
    const start = (content || '').substring(0, 30).replace(/\s+/g, '');
    const middle = (content || '')
      .substring(Math.floor(contentLength / 2), Math.floor(contentLength / 2) + 20)
      .replace(/\s+/g, '');
    const end = (content || '').substring(contentLength - 20).replace(/\s+/g, '');
    const hash = `${channelId}_${username}_${start}_${middle}_${end}_${contentLength}`;
    return hash;
  } else {
    // For shorter messages, use the whole content
    const contentHash = (content || '').replace(/\s+/g, '');
    const hash = `${channelId}_${username}_${contentHash}`;
    return hash;
  }
}

/**
 * Check if a message is a duplicate of recently sent messages
 * @param {string} content - Message content
 * @param {string} username - Username sending the message
 * @param {string} channelId - Channel ID
 * @returns {boolean} - True if this appears to be a duplicate
 */
function isDuplicateMessage(content, username, channelId) {
  // If content is empty, it can't be a duplicate
  if (!content || content.length === 0) {
    return false;
  }

  // Create a hash key for this message
  const hash = hashMessage(content, username, channelId);

  // Check if the hash exists in our cache
  if (recentMessageCache.has(hash)) {
    const timestamp = recentMessageCache.get(hash);
    const timeSinceLastMessage = Date.now() - timestamp;

    if (timeSinceLastMessage < DUPLICATE_DETECTION_TIMEOUT) {
      logger.info(
        `[MessageDeduplication] Detected duplicate message with hash: ${hash}, sent ${timeSinceLastMessage}ms ago`
      );
      return true;
    } else {
      logger.info(
        `[MessageDeduplication] Message with same hash found but ${timeSinceLastMessage}ms have passed (> ${DUPLICATE_DETECTION_TIMEOUT}ms), allowing it`
      );
    }
  }

  // Not a duplicate, add to cache
  recentMessageCache.set(hash, Date.now());

  // Cleanup old cache entries
  cleanupOldEntries();

  return false;
}

/**
 * Clean up old cache entries to prevent memory growth
 */
function cleanupOldEntries() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, timestamp] of recentMessageCache.entries()) {
    if (now - timestamp > CLEANUP_TIMEOUT) {
      recentMessageCache.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug(`[MessageDeduplication] Cleaned up ${cleanedCount} old cache entries`);
  }
}

/**
 * Clear all cached messages
 */
function clearCache() {
  const size = recentMessageCache.size;
  recentMessageCache.clear();
  logger.info(`[MessageDeduplication] Cleared message cache (${size} entries)`);
}

/**
 * Get the current cache size
 * @returns {number} Number of cached message hashes
 */
function getCacheSize() {
  return recentMessageCache.size;
}

/**
 * Manually add a message hash to the cache
 * Useful for testing or preventing known duplicates
 * @param {string} content - Message content
 * @param {string} username - Username
 * @param {string} channelId - Channel ID
 * @param {number} timestamp - Optional timestamp (defaults to now)
 */
function addToCache(content, username, channelId, timestamp = Date.now()) {
  const hash = hashMessage(content, username, channelId);
  recentMessageCache.set(hash, timestamp);
}

/**
 * Check if a specific hash is in the cache
 * @param {string} hash - The message hash
 * @returns {boolean} True if the hash is cached
 */
function hasHash(hash) {
  return recentMessageCache.has(hash);
}

/**
 * Get all cached hashes (for testing/debugging)
 * @returns {Array<string>} Array of cached hashes
 */
function getAllHashes() {
  return Array.from(recentMessageCache.keys());
}

module.exports = {
  hashMessage,
  isDuplicateMessage,
  clearCache,
  getCacheSize,
  addToCache,
  hasHash,
  getAllHashes,
  cleanupOldEntries,
  // Constants for testing
  DUPLICATE_DETECTION_TIMEOUT,
  CLEANUP_TIMEOUT,
  // Expose cache for testing only
  _recentMessageCache: recentMessageCache,
};
