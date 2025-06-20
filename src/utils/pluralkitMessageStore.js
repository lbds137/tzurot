const logger = require('../logger');

/**
 * Temporary store for tracking original messages.
 * When a PluralKit webhook arrives, we can look up the original user
 * by finding a recently deleted message with the same content.
 */
class PluralKitMessageStore {
  constructor(options = {}) {
    this.pendingMessages = new Map();
    this.deletedMessages = new Map(); // Track deleted messages separately
    this.expirationTime = options.expirationTime || 5000; // 5 seconds - PluralKit usually processes within 1-2 seconds

    // Injectable timer function for testability
    const intervalFn = options.interval || setInterval;
    const enableCleanup = options.enableCleanup !== undefined ? options.enableCleanup : true;

    // Clean up expired messages every 10 seconds
    if (enableCleanup) {
      this.cleanupInterval = intervalFn(() => this.cleanup(), 10000);
    }
  }

  /**
   * Store a message that might be processed by PluralKit
   * @param {string} messageId - The original message ID
   * @param {Object} messageData - Data about the original message
   */
  store(messageId, messageData) {
    this.pendingMessages.set(messageId, {
      userId: messageData.userId,
      channelId: messageData.channelId,
      content: messageData.content,
      timestamp: Date.now(),
      guildId: messageData.guildId,
      username: messageData.username,
    });

    // Don't log every message since we're storing all messages now
  }

  /**
   * Mark a message as deleted and move it to deleted storage
   * @param {string} messageId - The message ID that was deleted
   */
  markAsDeleted(messageId) {
    const messageData = this.pendingMessages.get(messageId);
    if (messageData) {
      // Move to deleted messages map
      this.deletedMessages.set(`${messageData.channelId}-${messageData.content}`, {
        ...messageData,
        deletedAt: Date.now(),
      });
      this.pendingMessages.delete(messageId);
      logger.debug(`[PluralKitStore] Marked message ${messageId} as deleted`);
    }
  }

  /**
   * Find a recently deleted message by content
   * @param {string} content - The message content to match
   * @param {string} channelId - The channel ID to match
   * @returns {Object|null} The stored message data or null
   */
  findDeletedMessage(content, channelId) {
    const key = `${channelId}-${content}`;
    const messageData = this.deletedMessages.get(key);

    if (messageData) {
      const now = Date.now();
      // Check if the deletion is recent (within 5 seconds)
      if (now - messageData.deletedAt < this.expirationTime) {
        logger.debug(`[PluralKitStore] Found deleted message from user ${messageData.userId}`);
        // Remove it to prevent reuse
        this.deletedMessages.delete(key);
        return messageData;
      }
    }

    return null;
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use findDeletedMessage instead
   */
  findByContent(content, channelId) {
    return this.findDeletedMessage(content, channelId);
  }

  /**
   * Remove a stored message
   * @param {string} messageId - The message ID to remove
   */
  remove(messageId) {
    if (this.pendingMessages.has(messageId)) {
      const data = this.pendingMessages.get(messageId);
      logger.debug(`[PluralKitStore] Removing message from user ${data.userId}`);
      this.pendingMessages.delete(messageId);
    }
  }

  /**
   * Clean up expired messages
   */
  cleanup() {
    const now = Date.now();
    let cleanedPending = 0;
    let cleanedDeleted = 0;

    // Clean up pending messages
    for (const [messageId, data] of this.pendingMessages.entries()) {
      if (now - data.timestamp > this.expirationTime) {
        this.pendingMessages.delete(messageId);
        cleanedPending++;
      }
    }

    // Clean up deleted messages
    for (const [key, data] of this.deletedMessages.entries()) {
      if (now - data.deletedAt > this.expirationTime) {
        this.deletedMessages.delete(key);
        cleanedDeleted++;
      }
    }

    if (cleanedPending > 0 || cleanedDeleted > 0) {
      logger.debug(
        `[PluralKitStore] Cleaned up ${cleanedPending} pending and ${cleanedDeleted} deleted messages`
      );
    }
  }

  /**
   * Get the number of pending and deleted messages
   * @returns {Object} The counts of pending and deleted messages
   */
  size() {
    return {
      pending: this.pendingMessages.size,
      deleted: this.deletedMessages.size,
    };
  }

  /**
   * Clear all data and stop intervals (for testing)
   */
  clear() {
    this.pendingMessages.clear();
    this.deletedMessages.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Export the class
module.exports = PluralKitMessageStore;

// Factory function to create instances
module.exports.create = function (options = {}) {
  return new PluralKitMessageStore(options);
};

// For backward compatibility, create a lazy-loaded singleton
// This will be created on first access, not at module load time
let _instance = null;
Object.defineProperty(module.exports, 'instance', {
  get() {
    if (!_instance) {
      // Create with cleanup disabled in test environment
      const isTestEnvironment = process.env.JEST_WORKER_ID !== undefined;
      _instance = new PluralKitMessageStore({
        enableCleanup: !isTestEnvironment,
      });
    }
    return _instance;
  },
  // Allow tests to reset the instance
  set(value) {
    _instance = value;
  },
});
