const fs = require('fs').promises;
const path = require('path');
const {
  Conversation,
  ConversationId,
  Message,
  ConversationSettings,
} = require('../../domain/conversation');
const { ConversationRepository } = require('../../domain/conversation');
const { PersonalityId } = require('../../domain/personality');
const logger = require('../../logger');

/**
 * FileConversationRepository - File-based implementation of ConversationRepository
 *
 * This adapter implements persistence for conversations using the file system.
 * In production, this would likely be replaced with a database adapter.
 *
 * Note: This implementation stores only metadata, not full message history,
 * as conversations are typically short-lived in the bot's context.
 */
class FileConversationRepository extends ConversationRepository {
  /**
   * @param {Object} options
   * @param {string} options.dataPath - Path to data directory
   * @param {string} options.filename - Filename for conversations data
   * @param {number} options.maxConversations - Maximum conversations to keep in memory
   */
  constructor({
    dataPath = './data',
    filename = 'conversations.json',
    maxConversations = 1000,
  } = {}) {
    super();
    this.dataPath = dataPath;
    this.filePath = path.join(dataPath, filename);
    this.maxConversations = maxConversations;
    this._cache = null; // In-memory cache
    this._initialized = false;
  }

  /**
   * Initialize the repository
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;

    try {
      // Ensure data directory exists
      await fs.mkdir(this.dataPath, { recursive: true });

      // Load existing data or create new file
      try {
        const data = await fs.readFile(this.filePath, 'utf8');
        this._cache = JSON.parse(data);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, create it
          this._cache = { conversations: {}, channelActivations: {} };
          await this._persist();
        } else {
          throw error;
        }
      }

      // Clean up old conversations on startup
      await this._cleanupOldConversations();

      this._initialized = true;
      logger.info('[FileConversationRepository] Initialized successfully');
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to initialize:', error);
      throw new Error(`Failed to initialize repository: ${error.message}`);
    }
  }

  /**
   * Save a conversation
   * @param {Conversation} conversation - Conversation to save
   * @returns {Promise<void>}
   */
  async save(conversation) {
    await this._ensureInitialized();

    try {
      const data = conversation.toJSON();

      // Store conversation metadata only (not full message history)
      this._cache.conversations[conversation.id] = {
        id: conversation.id,
        userId: data.conversationId.userId,
        channelId: data.conversationId.channelId,
        personalityId: data.activePersonalityId,
        messages: data.messages.slice(-10), // Keep last 10 messages
        settings: data.settings,
        startedAt: data.startedAt,
        updatedAt: data.lastActivityAt || data.startedAt,
        endedAt: data.endedAt,
        endedReason: data.ended ? 'manual' : null,
        savedAt: new Date().toISOString(),
      };

      // Enforce max conversations limit
      await this._enforceMaxConversations();

      await this._persist();

      logger.info(`[FileConversationRepository] Saved conversation: ${conversation.id}`);
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to save conversation:', error);
      throw new Error(`Failed to save conversation: ${error.message}`);
    }
  }

  /**
   * Find a conversation by ID
   * @param {ConversationId} conversationId - ID to search for
   * @returns {Promise<Conversation|null>}
   */
  async findById(conversationId) {
    await this._ensureInitialized();

    try {
      const data = this._cache.conversations[conversationId.toString()];
      if (!data) {
        return null;
      }

      return this._hydrate(data);
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to find by ID:', error);
      throw new Error(`Failed to find conversation: ${error.message}`);
    }
  }

  /**
   * Find active conversations by user
   * @param {string} userId - User ID
   * @returns {Promise<Conversation[]>}
   */
  async findActiveByUser(userId) {
    await this._ensureInitialized();

    try {
      const conversations = [];
      const now = Date.now();
      const activeThreshold = 30 * 60 * 1000; // 30 minutes

      for (const data of Object.values(this._cache.conversations)) {
        if (data.userId === userId && !data.endedAt) {
          const lastActivity = new Date(data.updatedAt || data.startedAt).getTime();
          if (now - lastActivity < activeThreshold) {
            conversations.push(await this._hydrate(data));
          }
        }
      }

      return conversations;
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to find active by user:', error);
      throw new Error(`Failed to find active conversations: ${error.message}`);
    }
  }

  /**
   * Find active conversation in channel
   * @param {string} channelId - Channel ID
   * @returns {Promise<Conversation|null>}
   */
  async findActiveByChannel(channelId) {
    await this._ensureInitialized();

    try {
      const now = Date.now();
      const activeThreshold = 30 * 60 * 1000; // 30 minutes

      // Look for most recent active conversation in channel
      let mostRecent = null;
      let mostRecentTime = 0;

      for (const data of Object.values(this._cache.conversations)) {
        if (data.channelId === channelId && !data.endedAt) {
          const lastActivity = new Date(data.updatedAt || data.startedAt).getTime();
          if (now - lastActivity < activeThreshold && lastActivity > mostRecentTime) {
            mostRecent = data;
            mostRecentTime = lastActivity;
          }
        }
      }

      return mostRecent ? this._hydrate(mostRecent) : null;
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to find active by channel:', error);
      throw new Error(`Failed to find active conversation: ${error.message}`);
    }
  }

  /**
   * Delete a conversation
   * @param {ConversationId} conversationId - ID to delete
   * @returns {Promise<void>}
   */
  async delete(conversationId) {
    await this._ensureInitialized();

    try {
      delete this._cache.conversations[conversationId.toString()];
      await this._persist();

      logger.info(
        `[FileConversationRepository] Deleted conversation: ${conversationId.toString()}`
      );
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to delete:', error);
      throw new Error(`Failed to delete conversation: ${error.message}`);
    }
  }

  /**
   * Count conversations by personality
   * @param {PersonalityId} personalityId - Personality ID
   * @returns {Promise<number>}
   */
  async countByPersonality(personalityId) {
    await this._ensureInitialized();

    try {
      let count = 0;

      for (const data of Object.values(this._cache.conversations)) {
        if (data.personalityId === personalityId.value) {
          count++;
        }
      }

      return count;
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to count by personality:', error);
      throw new Error(`Failed to count conversations: ${error.message}`);
    }
  }

  /**
   * Hydrate a conversation from stored data
   * @private
   */
  _hydrate(data) {
    // Create conversation ID
    const conversationId = new ConversationId(data.userId, data.channelId);

    // Create initial message
    const initialMessage = new Message({
      id: data.messages[0].id,
      content: data.messages[0].content,
      authorId: data.messages[0].authorId,
      timestamp: new Date(data.messages[0].timestamp),
      isFromPersonality: data.messages[0].isFromPersonality,
      channelId: data.channelId,
    });

    // Start conversation
    const conversation = Conversation.start(
      conversationId,
      initialMessage,
      new PersonalityId(data.personalityId)
    );

    // Add remaining messages
    for (let i = 1; i < data.messages.length; i++) {
      const msgData = data.messages[i];
      const message = new Message({
        id: msgData.id,
        content: msgData.content,
        authorId: msgData.authorId,
        timestamp: new Date(msgData.timestamp),
        isFromPersonality: msgData.isFromPersonality,
        channelId: data.channelId,
      });
      conversation.addMessage(message);
    }

    // Update settings if different from defaults
    if (data.settings) {
      const settings = new ConversationSettings(data.settings);
      conversation.updateSettings(settings);
    }

    // End conversation if ended
    if (data.endedAt) {
      conversation.end(data.endedReason || 'timeout');
    }

    // Mark as hydrated from persistence
    conversation.markEventsAsCommitted();

    return conversation;
  }

  /**
   * Persist cache to file
   * @private
   */
  async _persist() {
    try {
      const data = JSON.stringify(this._cache, null, 2);

      // Write to temp file first for atomic operation
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, data, 'utf8');

      // Rename to actual file
      await fs.rename(tempPath, this.filePath);

      logger.debug('[FileConversationRepository] Data persisted successfully');
    } catch (error) {
      logger.error('[FileConversationRepository] Failed to persist data:', error);
      throw new Error(`Failed to persist data: ${error.message}`);
    }
  }

  /**
   * Ensure repository is initialized
   * @private
   */
  async _ensureInitialized() {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  /**
   * Clean up old conversations
   * @private
   */
  async _cleanupOldConversations() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleanedCount = 0;

    for (const [id, data] of Object.entries(this._cache.conversations)) {
      const age = now - new Date(data.savedAt || data.startedAt).getTime();
      if (age > maxAge || data.endedAt) {
        delete this._cache.conversations[id];
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[FileConversationRepository] Cleaned up ${cleanedCount} old conversations`);
      await this._persist();
    }
  }

  /**
   * Enforce maximum conversations limit
   * @private
   */
  async _enforceMaxConversations() {
    const conversations = Object.entries(this._cache.conversations);

    if (conversations.length > this.maxConversations) {
      // Sort by last activity (oldest first)
      conversations.sort((a, b) => {
        const aTime = new Date(a[1].updatedAt || a[1].startedAt).getTime();
        const bTime = new Date(b[1].updatedAt || b[1].startedAt).getTime();
        return aTime - bTime;
      });

      // Remove oldest conversations
      const toRemove = conversations.length - this.maxConversations;
      for (let i = 0; i < toRemove; i++) {
        delete this._cache.conversations[conversations[i][0]];
      }

      logger.info(`[FileConversationRepository] Removed ${toRemove} oldest conversations`);
    }
  }

  /**
   * Get repository statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    await this._ensureInitialized();

    const activeCount = Object.values(this._cache.conversations).filter(c => !c.endedAt).length;

    const personalities = new Set();
    const users = new Set();
    const channels = new Set();

    for (const conv of Object.values(this._cache.conversations)) {
      personalities.add(conv.personalityId);
      users.add(conv.userId);
      channels.add(conv.channelId);
    }

    return {
      totalConversations: Object.keys(this._cache.conversations).length,
      activeConversations: activeCount,
      uniquePersonalities: personalities.size,
      uniqueUsers: users.size,
      uniqueChannels: channels.size,
    };
  }
}

module.exports = { FileConversationRepository };
