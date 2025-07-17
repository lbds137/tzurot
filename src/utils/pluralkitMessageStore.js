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
    this.deletedMessagesByChannel = new Map(); // New structure for flexible searching
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

    logger.debug(
      `[PluralKitStore] Stored message ${messageId} from user ${messageData.userId} with content: "${messageData.content}"`
    );
  }

  /**
   * Mark a message as deleted and move it to deleted storage
   * @param {string} messageId - The message ID that was deleted
   */
  markAsDeleted(messageId) {
    const messageData = this.pendingMessages.get(messageId);
    if (messageData) {
      // Instead of using content as the key, use a separate structure
      // This allows us to search more flexibly
      const deletedData = {
        ...messageData,
        deletedAt: Date.now(),
        messageId: messageId,
      };

      // Store in a list per channel instead of by exact content
      const channelId = messageData.channelId;
      if (!this.deletedMessagesByChannel.has(channelId)) {
        this.deletedMessagesByChannel.set(channelId, []);
      }

      this.deletedMessagesByChannel.get(channelId).push(deletedData);

      // Also keep the old storage for backward compatibility
      this.deletedMessages.set(`${messageData.channelId}-${messageData.content}`, deletedData);

      this.pendingMessages.delete(messageId);
      logger.debug(
        `[PluralKitStore] Marked message ${messageId} as deleted with content: "${messageData.content}"`
      );
    }
  }

  /**
   * Find a recently deleted message by content
   * @param {string} content - The message content to match
   * @param {string} channelId - The channel ID to match
   * @returns {Object|null} The stored message data or null
   */
  findDeletedMessage(content, channelId) {
    logger.debug(
      `[PluralKitStore] Looking for deleted message in channel ${channelId} with content: "${content}"`
    );

    const now = Date.now();

    // First try exact match (for backward compatibility)
    const key = `${channelId}-${content}`;
    const exactMatch = this.deletedMessages.get(key);
    if (exactMatch && now - exactMatch.deletedAt < this.expirationTime) {
      logger.debug(`[PluralKitStore] Found exact match for user ${exactMatch.userId}`);
      this.deletedMessages.delete(key);

      // Also remove from channel list to prevent reuse
      const channelMessages = this.deletedMessagesByChannel.get(channelId);
      if (channelMessages) {
        const index = channelMessages.findIndex(
          msg => msg.messageId === exactMatch.messageId && msg.content === content
        );
        if (index !== -1) {
          channelMessages.splice(index, 1);
        }
      }

      return exactMatch;
    }

    // If no exact match, search through channel messages
    const channelMessages = this.deletedMessagesByChannel.get(channelId);
    if (!channelMessages || channelMessages.length === 0) {
      logger.debug(`[PluralKitStore] No deleted messages found in channel ${channelId}`);
      return null;
    }

    logger.debug(
      `[PluralKitStore] Searching through ${channelMessages.length} deleted messages in channel`
    );

    // Search for messages where the webhook content might be contained in the original
    for (let i = channelMessages.length - 1; i >= 0; i--) {
      const msg = channelMessages[i];
      const age = now - msg.deletedAt;

      if (age >= this.expirationTime) {
        // Remove old message
        channelMessages.splice(i, 1);
        continue;
      }

      // Check if the webhook content could be derived from the original message
      // This handles cases where Pluralkit strips proxy tags
      if (msg.content.includes(content)) {
        logger.debug(
          `[PluralKitStore] Found potential match: original="${msg.content}" contains webhook="${content}"`
        );

        // Additional validation: the content should be a significant part of the message
        // This prevents false matches like "hi" matching "this is a test"
        const contentRatio = content.length / msg.content.length;
        if (contentRatio > 0.5) {
          // Webhook content is at least 50% of original
          logger.debug(
            `[PluralKitStore] Match validated (ratio: ${contentRatio}), user: ${msg.userId}`
          );
          channelMessages.splice(i, 1); // Remove to prevent reuse

          // Also clean up the old map
          const oldKey = `${channelId}-${msg.content}`;
          this.deletedMessages.delete(oldKey);

          return msg;
        } else {
          logger.debug(`[PluralKitStore] Match rejected, content ratio too low: ${contentRatio}`);
        }
      }
    }

    logger.debug(`[PluralKitStore] No matching deleted message found`);
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

    // Clean up channel message lists
    for (const [channelId, messages] of this.deletedMessagesByChannel.entries()) {
      const originalLength = messages.length;
      const filtered = messages.filter(msg => now - msg.deletedAt < this.expirationTime);
      if (filtered.length < originalLength) {
        cleanedDeleted += originalLength - filtered.length;
        if (filtered.length === 0) {
          this.deletedMessagesByChannel.delete(channelId);
        } else {
          this.deletedMessagesByChannel.set(channelId, filtered);
        }
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
    this.deletedMessagesByChannel.clear();
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
