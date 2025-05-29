const logger = require('../../logger');
const ConversationTracker = require('./ConversationTracker');
const AutoResponder = require('./AutoResponder');
const ChannelActivation = require('./ChannelActivation');
const ConversationPersistence = require('./ConversationPersistence');
const MessageHistory = require('./MessageHistory');

/**
 * ConversationManager - Main orchestrator for conversation management
 * 
 * This module coordinates all conversation-related functionality including
 * tracking active conversations, managing auto-responses, channel activations,
 * and persisting data.
 */
class ConversationManager {
  constructor(options = {}) {
    // Injectable timer functions
    this.scheduler = options.scheduler || setTimeout;
    this.interval = options.interval || setInterval;
    
    // Initialize sub-modules
    this.tracker = new ConversationTracker();
    this.autoResponder = new AutoResponder();
    this.channelActivation = new ChannelActivation();
    this.persistence = new ConversationPersistence();
    this.messageHistory = new MessageHistory(this.tracker);
    
    // Periodic save interval
    this.saveInterval = null;
    
    // Track if initialized
    this.initialized = false;
  }

  /**
   * Initialize the conversation manager
   */
  async init() {
    try {
      // Load persisted data
      const data = await this.persistence.loadAll();
      
      // Load data into sub-modules
      if (data.conversations) {
        this.tracker.loadFromData(data.conversations, data.messageMap);
      }
      
      if (data.autoResponseUsers) {
        this.autoResponder.loadFromData(data.autoResponseUsers);
      }
      
      if (data.activatedChannels) {
        this.channelActivation.loadFromData(data.activatedChannels);
      }
      
      // Start periodic save
      this._startPeriodicSave();
      
      this.initialized = true;
      logger.info('[ConversationManager] Initialization complete');
    } catch (error) {
      logger.error(`[ConversationManager] Error initializing: ${error.message}`);
      throw error;
    }
  }

  /**
   * Record a message as part of a conversation with a personality
   * @param {string} userId - Discord user ID
   * @param {string} channelId - Discord channel ID
   * @param {string|string[]} messageIds - ID or array of IDs of messages sent by the webhook
   * @param {string} personalityName - Full name of the personality
   * @param {boolean} [isDM=false] - Whether this is a DM channel
   * @param {boolean} [isMentionOnly=false] - Whether this was initiated by a mention
   */
  recordConversation(userId, channelId, messageIds, personalityName, isDM = false, isMentionOnly = false) {
    // For DM channels, automatically enable auto-response
    if (isDM) {
      this.autoResponder.enable(userId);
      logger.info(`[ConversationManager] Auto-enabled auto-response for user ${userId} in DM channel`);
    }
    
    // Record the conversation
    this.tracker.recordConversation({
      userId,
      channelId,
      messageIds,
      personalityName,
      isDM,
      isMentionOnly
    });
    
    // Save data
    this._scheduleSave();
  }

  /**
   * Get the active personality for a user in a channel
   * @param {string} userId - Discord user ID
   * @param {string} channelId - Discord channel ID
   * @param {boolean} [isDM=false] - Whether this is a DM channel
   * @returns {string|null} The personality name or null if no active conversation
   */
  getActivePersonality(userId, channelId, isDM = false) {
    const autoResponseEnabled = this.autoResponder.isEnabled(userId);
    return this.tracker.getActivePersonality(userId, channelId, isDM, autoResponseEnabled);
  }

  /**
   * Check if a message ID is from a known conversation
   * @param {string} messageId - Discord message ID
   * @param {Object} [options] - Additional options
   * @param {string} [options.webhookUsername] - Username of the webhook for fallback detection
   * @returns {string|null} The personality name or null if not found
   */
  getPersonalityFromMessage(messageId, options = {}) {
    return this.messageHistory.getPersonalityFromMessage(messageId, options);
  }

  /**
   * Clear conversation history
   * @param {string} userId - Discord user ID
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} Whether a conversation was cleared
   */
  clearConversation(userId, channelId) {
    const result = this.tracker.clearConversation(userId, channelId);
    
    if (result) {
      this._scheduleSave();
    }
    
    return result;
  }

  /**
   * Activate a personality in a channel
   * @param {string} channelId - Discord channel ID
   * @param {string} personalityName - Full name of the personality
   * @param {string} userId - Discord user ID who activated
   * @returns {boolean} Success status
   */
  activatePersonality(channelId, personalityName, userId) {
    const result = this.channelActivation.activate(channelId, personalityName, userId);
    
    if (result) {
      this._scheduleSave();
    }
    
    return result;
  }

  /**
   * Deactivate personality in a channel
   * @param {string} channelId - Discord channel ID
   * @returns {boolean} Success status
   */
  deactivatePersonality(channelId) {
    const result = this.channelActivation.deactivate(channelId);
    
    if (result) {
      this._scheduleSave();
    }
    
    return result;
  }

  /**
   * Check if a channel has an activated personality
   * @param {string} channelId - Discord channel ID
   * @returns {string|null} The personality name or null if none activated
   */
  getActivatedPersonality(channelId) {
    return this.channelActivation.getActivatedPersonality(channelId);
  }

  /**
   * Get all channels with activated personalities
   * @returns {Object} Map of channel IDs to personality names
   */
  getAllActivatedChannels() {
    return this.channelActivation.getAllActivatedChannels();
  }

  /**
   * Enable auto-response for a user
   * @param {string} userId - Discord user ID
   * @returns {boolean} Success status
   */
  enableAutoResponse(userId) {
    const result = this.autoResponder.enable(userId);
    this._scheduleSave();
    return result;
  }

  /**
   * Disable auto-response for a user
   * @param {string} userId - Discord user ID
   * @returns {boolean} Success status
   */
  disableAutoResponse(userId) {
    const result = this.autoResponder.disable(userId);
    
    if (result) {
      this._scheduleSave();
    }
    
    return result;
  }

  /**
   * Check if auto-response is enabled for a user
   * @param {string} userId - Discord user ID
   * @returns {boolean} Whether auto-response is enabled
   */
  isAutoResponseEnabled(userId) {
    return this.autoResponder.isEnabled(userId);
  }

  /**
   * Save all data immediately
   */
  async saveAllData() {
    try {
      const data = {
        conversations: this.tracker.getAllConversations(),
        messageMap: this.tracker.getAllMessageMappings(),
        autoResponseUsers: this.autoResponder.getAllUsers(),
        activatedChannels: this.channelActivation.getAllActivationData()
      };
      
      await this.persistence.saveAll(data);
    } catch (error) {
      logger.error(`[ConversationManager] Error saving data: ${error.message}`);
    }
  }

  /**
   * Schedule a save operation (debounced)
   * @private
   */
  _scheduleSave() {
    // Debounce saves - if a save is already scheduled, don't schedule another
    if (this.pendingSave) {
      return;
    }
    
    this.pendingSave = this.scheduler(() => {
      this.pendingSave = null;
      this.saveAllData();
    }, 1000); // Save after 1 second of inactivity
  }

  /**
   * Start periodic save interval
   * @private
   */
  _startPeriodicSave() {
    this.saveInterval = this.interval(() => {
      logger.info('[ConversationManager] Running periodic data save...');
      this.saveAllData();
    }, 5 * 60 * 1000); // Save every 5 minutes
    
    // Add unref if available (Node.js timers)
    if (this.saveInterval && this.saveInterval.unref) {
      this.saveInterval.unref();
    }
  }

  /**
   * Stop all intervals and cleanup (for testing)
   */
  async shutdown() {
    // Stop periodic save
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    
    // Clear pending save
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
    
    // Stop tracker cleanup
    this.tracker.stopCleanup();
    
    // Final save
    await this.saveAllData();
    
    this.initialized = false;
    logger.info('[ConversationManager] Shutdown complete');
  }
}

// Create singleton instance
const conversationManager = new ConversationManager();

// Export singleton with original API for backward compatibility
module.exports = {
  // Instance methods bound to singleton
  initConversationManager: () => conversationManager.init(),
  recordConversation: (...args) => conversationManager.recordConversation(...args),
  getActivePersonality: (...args) => conversationManager.getActivePersonality(...args),
  getPersonalityFromMessage: (...args) => conversationManager.getPersonalityFromMessage(...args),
  clearConversation: (...args) => conversationManager.clearConversation(...args),
  activatePersonality: (...args) => conversationManager.activatePersonality(...args),
  deactivatePersonality: (...args) => conversationManager.deactivatePersonality(...args),
  getActivatedPersonality: (...args) => conversationManager.getActivatedPersonality(...args),
  getAllActivatedChannels: () => conversationManager.getAllActivatedChannels(),
  enableAutoResponse: (...args) => conversationManager.enableAutoResponse(...args),
  disableAutoResponse: (...args) => conversationManager.disableAutoResponse(...args),
  isAutoResponseEnabled: (...args) => conversationManager.isAutoResponseEnabled(...args),
  saveAllData: () => conversationManager.saveAllData(),
  
  // Export the instance for advanced usage
  _instance: conversationManager
};