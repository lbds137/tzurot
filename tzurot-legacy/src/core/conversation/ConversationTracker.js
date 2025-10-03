const logger = require('../../logger');

/**
 * ConversationTracker - Manages active conversations and message mappings
 *
 * This module tracks active conversations between users and personalities,
 * maintaining the relationship between messages and their originating conversations.
 */
class ConversationTracker {
  constructor(options = {}) {
    // Track ongoing conversations by user-channel key
    this.activeConversations = new Map();

    // Map message IDs to conversations for quicker lookup
    this.messageIdMap = new Map();

    // Timeout configuration
    this.CONVERSATION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    this.DM_CONVERSATION_TIMEOUT = 120 * 60 * 1000; // 2 hours for DMs

    // Injectable timer functions for testability
    this.interval = options.interval || setInterval;
    this.enableCleanup = options.enableCleanup !== false; // Default to true

    // Start cleanup interval
    if (this.enableCleanup) {
      this._startCleanupInterval();
    }
  }

  /**
   * Record a new conversation or update an existing one
   * @param {Object} options - Conversation options
   * @param {string} options.userId - Discord user ID
   * @param {string} options.channelId - Discord channel ID
   * @param {string|string[]} options.messageIds - Message ID(s) from the personality
   * @param {string} options.personalityName - Full name of the personality
   * @param {boolean} [options.isDM=false] - Whether this is a DM channel
   * @param {boolean} [options.isMentionOnly=false] - Whether this was initiated by a mention
   * @returns {void}
   */
  recordConversation({
    userId,
    channelId,
    messageIds,
    personalityName,
    isDM = false,
    isMentionOnly = false,
  }) {
    const key = `${userId}-${channelId}`;
    const timestamp = Date.now();

    // Convert single message ID to array if needed
    const messageIdArray = Array.isArray(messageIds) ? messageIds : [messageIds];

    // Store conversation information
    const conversationData = {
      personalityName,
      messageIds: messageIdArray,
      timestamp,
      isDM,
      isMentionOnly,
    };

    this.activeConversations.set(key, conversationData);

    // Map each message ID to this conversation for quick lookup
    messageIdArray.forEach(msgId => {
      this.messageIdMap.set(msgId, {
        userId,
        channelId,
        personalityName,
        timestamp,
        isDM,
        isMentionOnly,
      });
    });

    logger.info(
      `[ConversationTracker] Recorded conversation for ${key} with personality ${personalityName}, isDM: ${isDM}, isMentionOnly: ${isMentionOnly}, messageIds: ${messageIdArray.join(', ')}`
    );
  }

  /**
   * Get active personality for a user in a channel
   * @param {string} userId - Discord user ID
   * @param {string} channelId - Discord channel ID
   * @param {boolean} [isDM=false] - Whether this is a DM channel
   * @param {boolean} [autoResponseEnabled=false] - Whether auto-response is enabled for the user
   * @returns {string|null} The personality name or null if no active conversation
   */
  getActivePersonality(userId, channelId, isDM = false, autoResponseEnabled = false) {
    const key = `${userId}-${channelId}`;
    const conversation = this.activeConversations.get(key);

    if (!conversation) {
      logger.debug(`[ConversationTracker] No active conversation found for ${key}`);
      return null;
    }

    logger.info(`
      [ConversationTracker] Checking active conversation for ${key}: isMentionOnly=${conversation.isMentionOnly}, isDM=${isDM}, autoResponseEnabled=${autoResponseEnabled}, personalityName=${conversation.personalityName}`);

    // If this was a mention-only conversation in a guild channel, don't continue it
    if (!isDM && conversation.isMentionOnly) {
      logger.debug(
        `[ConversationTracker] Removing mention-only conversation for ${userId} in channel ${channelId}`
      );
      this.clearConversation(userId, channelId);
      return null;
    }

    // For guild channels, only continue if auto-response is enabled
    // This is a safety check in case isMentionOnly wasn't set correctly
    if (!isDM && !autoResponseEnabled) {
      logger.debug(
        `[ConversationTracker] Not continuing conversation in guild channel without autoResponse - clearing conversation`
      );
      this.clearConversation(userId, channelId);
      return null;
    }

    // Check if the conversation is still fresh
    const timeoutMs = isDM ? this.DM_CONVERSATION_TIMEOUT : this.CONVERSATION_TIMEOUT;
    const isStale = Date.now() - conversation.timestamp > timeoutMs;

    if (isStale) {
      this.clearConversation(userId, channelId);
      return null;
    }

    return conversation.personalityName;
  }

  /**
   * Get personality from a message ID
   * @param {string} messageId - Discord message ID
   * @returns {Object|null} Conversation data or null if not found
   */
  getConversationByMessageId(messageId) {
    const data = this.messageIdMap.get(messageId);

    if (data) {
      logger.debug(
        `[ConversationTracker] Found personality ${data.personalityName} for message ${messageId}`
      );
      return data;
    }

    // Fallback to searching through active conversations (for backward compatibility)
    for (const [, conversation] of this.activeConversations.entries()) {
      if (conversation.messageIds && conversation.messageIds.includes(messageId)) {
        return {
          personalityName: conversation.personalityName,
          isDM: conversation.isDM,
          isMentionOnly: conversation.isMentionOnly,
        };
      }

      // Legacy support for older conversations
      if (conversation.lastMessageId === messageId) {
        return {
          personalityName: conversation.personalityName,
          isDM: conversation.isDM,
          isMentionOnly: conversation.isMentionOnly,
        };
      }
    }

    return null;
  }

  /**
   * Clear a conversation
   * @param {string} userId - Discord user ID
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} Whether a conversation was cleared
   */
  clearConversation(userId, channelId) {
    const key = `${userId}-${channelId}`;
    const conversation = this.activeConversations.get(key);

    if (!conversation) {
      return false;
    }

    // Clean up message ID mappings
    if (conversation.messageIds) {
      conversation.messageIds.forEach(msgId => {
        this.messageIdMap.delete(msgId);
      });
    }

    // Legacy support
    if (conversation.lastMessageId) {
      this.messageIdMap.delete(conversation.lastMessageId);
    }

    this.activeConversations.delete(key);
    logger.debug(`[ConversationTracker] Cleared conversation for ${key}`);

    return true;
  }

  /**
   * Get all active conversations (for persistence)
   * @returns {Object} Plain object with all conversations
   */
  getAllConversations() {
    const conversations = {};
    for (const [key, value] of this.activeConversations.entries()) {
      conversations[key] = value;
    }
    return conversations;
  }

  /**
   * Get all message mappings (for persistence)
   * @returns {Object} Plain object with all message mappings
   */
  getAllMessageMappings() {
    const mappings = {};
    for (const [key, value] of this.messageIdMap.entries()) {
      mappings[key] = value;
    }
    return mappings;
  }

  /**
   * Load conversations from persisted data
   * @param {Object} conversations - Conversations object from storage
   * @param {Object} messageMappings - Message mappings object from storage
   */
  loadFromData(conversations, messageMappings) {
    // Load conversations
    if (conversations) {
      for (const [key, value] of Object.entries(conversations)) {
        this.activeConversations.set(key, value);
      }
      logger.info(
        `[ConversationTracker] Loaded ${this.activeConversations.size} active conversations`
      );
    }

    // Load message mappings
    if (messageMappings) {
      for (const [key, value] of Object.entries(messageMappings)) {
        this.messageIdMap.set(key, value);
      }
      logger.info(`[ConversationTracker] Loaded ${this.messageIdMap.size} message ID mappings`);
    }
  }

  /**
   * Start the cleanup interval for stale conversations
   * @private
   */
  _startCleanupInterval() {
    this.cleanupInterval = this.interval(
      () => {
        this._cleanupStaleConversations();
      },
      10 * 60 * 1000
    ); // Run every 10 minutes

    // Allow process to exit even with interval running
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up stale conversations
   * @private
   */
  _cleanupStaleConversations() {
    const now = Date.now();
    let cleanupCount = 0;

    // Clean up stale conversations
    for (const [key, conversation] of this.activeConversations.entries()) {
      const timeout = conversation.isDM ? this.DM_CONVERSATION_TIMEOUT : this.CONVERSATION_TIMEOUT;

      if (now - conversation.timestamp > timeout) {
        // Clean up message ID mappings
        if (conversation.messageIds) {
          conversation.messageIds.forEach(msgId => {
            this.messageIdMap.delete(msgId);
          });
        }

        // Legacy support
        if (conversation.lastMessageId) {
          this.messageIdMap.delete(conversation.lastMessageId);
        }

        this.activeConversations.delete(key);
        cleanupCount++;
      }
    }

    // Clean up orphaned message mappings
    for (const [msgId, data] of this.messageIdMap.entries()) {
      const timeout = data.isDM ? this.DM_CONVERSATION_TIMEOUT : this.CONVERSATION_TIMEOUT;

      if (now - data.timestamp > timeout) {
        this.messageIdMap.delete(msgId);
        cleanupCount++;
      }
    }

    if (cleanupCount > 0) {
      logger.info(`[ConversationTracker] Cleaned up ${cleanupCount} stale entries`);
    }
  }

  /**
   * Stop the cleanup interval (for testing)
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  /**
   * Clean up and stop the interval
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

module.exports = ConversationTracker;
