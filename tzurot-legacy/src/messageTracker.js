/**
 * Message Tracking System for Deduplication
 *
 * @module messageTracker
 * @description
 * This module provides a centralized message tracking system to prevent
 * duplicate message processing, replies, and send operations. It replaces
 * multiple overlapping deduplication mechanisms with a single, consistent approach.
 */

const logger = require('./logger');

/**
 * Centralized message tracking system for deduplication
 *
 * @class MessageTracker
 * @description
 * Tracks message operations to prevent duplicates. This class:
 * - Tracks message IDs for command processing
 * - Tracks reply operations to prevent duplicate replies
 * - Tracks channel send operations to prevent duplicate messages
 * - Automatically cleans up old entries to prevent memory leaks
 */
class MessageTracker {
  /**
   * Create a new MessageTracker instance
   * @param {Object} [options={}] - Configuration options
   * @param {boolean} [options.enableCleanupTimers=true] - Whether to enable cleanup timers
   * @param {Function} [options.scheduler=setTimeout] - Timer function to use for scheduling
   * @param {Function} [options.intervalScheduler=setInterval] - Interval function to use for periodic cleanup
   */
  constructor(options = {}) {
    const {
      enableCleanupTimers = true,
      scheduler = setTimeout,
      intervalScheduler = setInterval,
    } = options;

    /**
     * Map of tracked messages and operations with timestamps
     * @type {Map<string, number>}
     * @private
     */
    this.processedMessages = new Map();

    // Store options
    this.enableCleanupTimers = enableCleanupTimers;
    this.scheduler = scheduler;
    this.intervalScheduler = intervalScheduler;

    // Set up periodic cleanup
    this.setupPeriodicCleanup();

    logger.info('MessageTracker initialized');
  }

  /**
   * Set up periodic cleanup of old tracked messages
   * @private
   */
  setupPeriodicCleanup() {
    if (!this.enableCleanupTimers) {
      return;
    }

    // Clean up the tracker every 10 minutes to prevent memory growth
    const interval = this.intervalScheduler(
      () => {
        const now = Date.now();
        let count = 0;

        // Remove entries older than 10 minutes
        for (const [id, timestamp] of this.processedMessages.entries()) {
          if (now - timestamp > 10 * 60 * 1000) {
            this.processedMessages.delete(id);
            count++;
          }
        }

        if (count > 0) {
          logger.info(`MessageTracker cleanup removed ${count} entries`);
        }
      },
      10 * 60 * 1000
    );

    // unref() allows the process to exit even if timer is active
    if (interval && typeof interval.unref === 'function') {
      interval.unref();
    }
  }

  /**
   * Track a message to prevent duplicate processing
   * @param {string} messageId - The Discord message ID to track
   * @param {string} [type='message'] - The type of message (e.g., 'command', 'bot-message')
   * @returns {boolean} - False if message is a duplicate, true otherwise
   */
  track(messageId, type = 'message') {
    const trackingId = `${type}-${messageId}`;

    // If already processed, return false to indicate duplicate
    if (this.processedMessages.has(trackingId)) {
      const timeAgo = Date.now() - this.processedMessages.get(trackingId);
      logger.warn(
        `DUPLICATE DETECTION: ${trackingId} (${timeAgo}ms ago) - preventing duplicate processing`
      );
      return false;
    }

    // Mark as processed with current timestamp
    this.processedMessages.set(trackingId, Date.now());
    return true;
  }

  /**
   * Track an operation (like reply or send) to prevent duplicates
   * @param {string} channelId - The Discord channel ID
   * @param {string} operationType - The type of operation (e.g., 'reply', 'send')
   * @param {string} optionsSignature - A signature representing the operation content
   * @returns {boolean} - False if operation is a duplicate within 5 seconds, true otherwise
   */
  trackOperation(channelId, operationType, optionsSignature) {
    const operationId = `${operationType}-${channelId}-${optionsSignature}`;

    // Check for recent identical operations (within 5 seconds)
    if (this.processedMessages.has(operationId)) {
      const timeAgo = Date.now() - this.processedMessages.get(operationId);
      if (timeAgo < 5000) {
        logger.warn(
          `DUPLICATE OPERATION: ${operationId} (${timeAgo}ms ago) - preventing duplicate operation`
        );
        return false;
      }
    }

    // Record this operation
    this.processedMessages.set(operationId, Date.now());

    // Set a timeout to clean up this entry after 10 seconds (if timers are enabled)
    if (this.enableCleanupTimers) {
      this.scheduler(() => {
        this.processedMessages.delete(operationId);
      }, 10000);
    }

    return true;
  }

  /**
   * Get the current number of tracked messages and operations
   * @returns {number} - The number of tracked items
   */
  get size() {
    return this.processedMessages.size;
  }

  /**
   * Clear all tracked messages and operations
   * Primarily used for testing
   */
  clear() {
    this.processedMessages.clear();
    logger.debug('MessageTracker cleared');
  }
}

// Create a factory function for testing
function createMessageTracker(options) {
  return new MessageTracker(options);
}

// Export a singleton instance and the class for testing
module.exports = {
  messageTracker: new MessageTracker(),
  MessageTracker,
  createMessageTracker,
};
