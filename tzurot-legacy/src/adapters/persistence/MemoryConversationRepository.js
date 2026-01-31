const { ConversationRepository } = require('../../domain/conversation');
const logger = require('../../logger');

/**
 * MemoryConversationRepository - In-memory implementation of ConversationRepository
 *
 * This adapter provides fast, in-memory storage for active conversations.
 * It's suitable for ephemeral conversation tracking where persistence isn't required.
 * For production use, conversations should be persisted to disk periodically.
 */
class MemoryConversationRepository extends ConversationRepository {
  /**
   * @param {Object} options
   * @param {number} options.maxConversations - Maximum conversations to keep in memory
   * @param {number} options.ttlMs - Time to live for inactive conversations (ms)
   */
  constructor(options = {}) {
    super();
    this.maxConversations = options.maxConversations || 1000;
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // 24 hours default

    // Storage maps
    this._conversations = new Map(); // conversationId -> conversation
    this._messageIndex = new Map(); // messageId -> conversationId
    this._userIndex = new Map(); // userId -> Set<conversationId>
    this._personalityIndex = new Map(); // personalityId -> Set<conversationId>
    this._lastAccess = new Map(); // conversationId -> timestamp
  }

  /**
   * Save a conversation aggregate
   * @param {Conversation} conversation - Conversation to save
   * @returns {Promise<void>}
   */
  async save(conversation) {
    try {
      const conversationId = conversation.id.toString();
      const userId = conversation.conversationId.userId;
      const personalityId = conversation.activePersonalityId?.toString();

      // Update main storage
      this._conversations.set(conversationId, conversation);
      this._lastAccess.set(conversationId, Date.now());

      // Update message index
      conversation.messages.forEach(message => {
        this._messageIndex.set(message.id, conversationId);
      });

      // Update user index
      if (!this._userIndex.has(userId)) {
        this._userIndex.set(userId, new Set());
      }
      this._userIndex.get(userId).add(conversationId);

      // Update personality index
      if (personalityId) {
        if (!this._personalityIndex.has(personalityId)) {
          this._personalityIndex.set(personalityId, new Set());
        }
        this._personalityIndex.get(personalityId).add(conversationId);
      }

      // Cleanup if over limit
      await this._enforceLimit();

      logger.debug(`[MemoryConversationRepository] Saved conversation: ${conversationId}`);
    } catch (error) {
      logger.error('[MemoryConversationRepository] Failed to save conversation:', error);
      throw new Error(`Failed to save conversation: ${error.message}`);
    }
  }

  /**
   * Find conversation by ID
   * @param {ConversationId} conversationId - Conversation ID
   * @returns {Promise<Conversation|null>} Conversation or null if not found
   */
  async findById(conversationId) {
    try {
      const id = conversationId.toString();
      const conversation = this._conversations.get(id);

      if (conversation) {
        // Update last access time
        this._lastAccess.set(id, Date.now());

        // Return a copy to maintain immutability
        return this._cloneConversation(conversation);
      }

      return null;
    } catch (error) {
      logger.error('[MemoryConversationRepository] Failed to find by ID:', error);
      throw new Error(`Failed to find conversation: ${error.message}`);
    }
  }

  /**
   * Find active conversations for a user
   * @param {string} userId - User ID
   * @returns {Promise<Conversation[]>} Array of conversations
   */
  async findActiveByUser(userId) {
    try {
      const conversationIds = this._userIndex.get(userId);
      if (!conversationIds) {
        return [];
      }

      const activeConversations = [];
      const now = Date.now();

      for (const conversationId of conversationIds) {
        const conversation = this._conversations.get(conversationId);
        if (conversation && !conversation.ended) {
          // Check if conversation is still within TTL
          const lastAccess = this._lastAccess.get(conversationId) || 0;
          if (now - lastAccess < this.ttlMs) {
            activeConversations.push(this._cloneConversation(conversation));
          }
        }
      }

      return activeConversations;
    } catch (error) {
      logger.error('[MemoryConversationRepository] Failed to find by user:', error);
      throw new Error(`Failed to find conversations by user: ${error.message}`);
    }
  }

  /**
   * Find conversation by message ID
   * @param {string} messageId - Discord message ID
   * @returns {Promise<Conversation|null>} Conversation containing the message
   */
  async findByMessageId(messageId) {
    try {
      const conversationId = this._messageIndex.get(messageId);
      if (!conversationId) {
        return null;
      }

      const conversation = this._conversations.get(conversationId);
      if (conversation) {
        // Update last access time
        this._lastAccess.set(conversationId, Date.now());
        return this._cloneConversation(conversation);
      }

      return null;
    } catch (error) {
      logger.error('[MemoryConversationRepository] Failed to find by message ID:', error);
      throw new Error(`Failed to find conversation by message: ${error.message}`);
    }
  }

  /**
   * Find all conversations with a specific personality
   * @param {PersonalityId} personalityId - Personality ID
   * @returns {Promise<Conversation[]>} Array of conversations
   */
  async findByPersonality(personalityId) {
    try {
      const id = personalityId.toString();
      const conversationIds = this._personalityIndex.get(id);
      if (!conversationIds) {
        return [];
      }

      const conversations = [];
      for (const conversationId of conversationIds) {
        const conversation = this._conversations.get(conversationId);
        if (conversation) {
          conversations.push(this._cloneConversation(conversation));
        }
      }

      return conversations;
    } catch (error) {
      logger.error('[MemoryConversationRepository] Failed to find by personality:', error);
      throw new Error(`Failed to find conversations by personality: ${error.message}`);
    }
  }

  /**
   * Delete a conversation
   * @param {ConversationId} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async delete(conversationId) {
    try {
      const id = conversationId.toString();
      const conversation = this._conversations.get(id);

      if (!conversation) {
        return; // Already deleted
      }

      // Remove from main storage
      this._conversations.delete(id);
      this._lastAccess.delete(id);

      // Remove from message index
      conversation.messages.forEach(message => {
        this._messageIndex.delete(message.id);
      });

      // Remove from user index
      const userConversations = this._userIndex.get(conversation.conversationId.userId);
      if (userConversations) {
        userConversations.delete(id);
        if (userConversations.size === 0) {
          this._userIndex.delete(conversation.conversationId.userId);
        }
      }

      // Remove from personality index
      if (conversation.activePersonalityId) {
        const personalityConversations = this._personalityIndex.get(
          conversation.activePersonalityId.toString()
        );
        if (personalityConversations) {
          personalityConversations.delete(id);
          if (personalityConversations.size === 0) {
            this._personalityIndex.delete(conversation.activePersonalityId.toString());
          }
        }
      }

      logger.debug(`[MemoryConversationRepository] Deleted conversation: ${id}`);
    } catch (error) {
      logger.error('[MemoryConversationRepository] Failed to delete conversation:', error);
      throw new Error(`Failed to delete conversation: ${error.message}`);
    }
  }

  /**
   * Clean up expired conversations
   * @param {Date} expiryDate - Delete conversations ended before this date
   * @returns {Promise<number>} Number of conversations deleted
   */
  async cleanupExpired(expiryDate) {
    try {
      const expiryTime = expiryDate.getTime();
      let deletedCount = 0;
      const toDelete = new Set();

      for (const [conversationId, conversation] of this._conversations) {
        let shouldDelete = false;

        // Check if conversation is ended and expired
        if (conversation.ended && conversation.endedAt) {
          const endedTime =
            typeof conversation.endedAt === 'string'
              ? new Date(conversation.endedAt).getTime()
              : conversation.endedAt.getTime();
          if (endedTime < expiryTime) {
            shouldDelete = true;
          }
        }

        // Also check TTL for inactive conversations
        const lastAccess = this._lastAccess.get(conversationId) || 0;
        if (Date.now() - lastAccess > this.ttlMs) {
          shouldDelete = true;
        }

        if (shouldDelete) {
          toDelete.add(conversationId);
        }
      }

      // Delete the conversations
      for (const conversationId of toDelete) {
        const conversation = this._conversations.get(conversationId);
        if (conversation) {
          await this.delete(conversation.conversationId);
          deletedCount++;
        }
      }

      logger.info(
        `[MemoryConversationRepository] Cleaned up ${deletedCount} expired conversations`
      );
      return deletedCount;
    } catch (error) {
      logger.error(
        '[MemoryConversationRepository] Failed to cleanup expired conversations:',
        error
      );
      throw new Error(`Failed to cleanup expired conversations: ${error.message}`);
    }
  }

  /**
   * Get repository statistics
   * @returns {Object} Statistics about the repository
   */
  getStats() {
    return {
      totalConversations: this._conversations.size,
      totalMessages: this._messageIndex.size,
      totalUsers: this._userIndex.size,
      totalPersonalities: this._personalityIndex.size,
      memoryUsage: this._estimateMemoryUsage(),
    };
  }

  /**
   * Clear all conversations from memory
   * @returns {Promise<void>}
   */
  async clear() {
    this._conversations.clear();
    this._messageIndex.clear();
    this._userIndex.clear();
    this._personalityIndex.clear();
    this._lastAccess.clear();
    logger.info('[MemoryConversationRepository] Cleared all conversations');
  }

  /**
   * Enforce maximum conversation limit
   * @private
   */
  async _enforceLimit() {
    if (this._conversations.size <= this.maxConversations) {
      return;
    }

    // Find oldest conversations by last access time
    const conversationsByAccess = Array.from(this._lastAccess.entries()).sort(
      (a, b) => a[1] - b[1]
    ); // Sort by access time, oldest first

    // Delete oldest conversations until under limit
    const toDelete = this._conversations.size - this.maxConversations;
    for (let i = 0; i < toDelete && i < conversationsByAccess.length; i++) {
      const [conversationId] = conversationsByAccess[i];
      const conversation = this._conversations.get(conversationId);
      if (conversation) {
        await this.delete(conversation.conversationId);
      }
    }
  }

  /**
   * Clone a conversation to maintain immutability
   * @private
   */
  _cloneConversation(conversation) {
    // Since domain objects are immutable, we can return them directly
    // The Conversation aggregate should handle its own immutability
    return conversation;
  }

  /**
   * Estimate memory usage (rough approximation)
   * @private
   */
  _estimateMemoryUsage() {
    // Rough estimate: assume 1KB per conversation + 100 bytes per message
    const conversationSize = this._conversations.size * 1024;
    const messageSize = this._messageIndex.size * 100;
    const indexOverhead = (this._userIndex.size + this._personalityIndex.size) * 64;

    return conversationSize + messageSize + indexOverhead;
  }
}

module.exports = { MemoryConversationRepository };
