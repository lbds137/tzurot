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
    this.clearScheduler = options.clearScheduler || clearTimeout;
    this.clearInterval = options.clearInterval || clearInterval;

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
  recordConversation(
    userId,
    channelId,
    messageIds,
    personalityName,
    isDM = false,
    isMentionOnly = false
  ) {
    // For DM channels, automatically enable auto-response
    if (isDM) {
      this.autoResponder.enable(userId);
      logger.info(
        `[ConversationManager] Auto-enabled auto-response for user ${userId} in DM channel`
      );
    }

    // Record the conversation
    this.tracker.recordConversation({
      userId,
      channelId,
      messageIds,
      personalityName,
      isDM,
      isMentionOnly,
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
   * @returns {Promise<string|null>} The personality name or null if not found
   */
  async getPersonalityFromMessage(messageId, options = {}) {
    return await this.messageHistory.getPersonalityFromMessage(messageId, options);
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
        activatedChannels: this.channelActivation.getAllActivationData(),
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
    this.saveInterval = this.interval(
      () => {
        logger.info('[ConversationManager] Running periodic data save...');
        this.saveAllData();
      },
      5 * 60 * 1000
    ); // Save every 5 minutes

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
      this.clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    // Clear pending save
    if (this.pendingSave) {
      this.clearScheduler(this.pendingSave);
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

// Export class and factory functions
module.exports = {
  ConversationManager,

  // Factory function for creating new instances
  create: (options = {}) => {
    return new ConversationManager(options);
  },

  // Lazy singleton getter for backward compatibility
  getInstance: (() => {
    let instance = null;
    return () => {
      if (!instance) {
        instance = new ConversationManager();
      }
      return instance;
    };
  })(),

  // Legacy API for backward compatibility - delegates to singleton
  initConversationManager: () => module.exports.getInstance().init(),
  recordConversation: (...args) => module.exports.getInstance().recordConversation(...args),
  getActivePersonality: (...args) => module.exports.getInstance().getActivePersonality(...args),
  getPersonalityFromMessage: async (...args) =>
    await module.exports.getInstance().getPersonalityFromMessage(...args),
  clearConversation: (...args) => module.exports.getInstance().clearConversation(...args),
  activatePersonality: (...args) => module.exports.getInstance().activatePersonality(...args),
  deactivatePersonality: (...args) => module.exports.getInstance().deactivatePersonality(...args),
  getActivatedPersonality: (...args) =>
    module.exports.getInstance().getActivatedPersonality(...args),
  getAllActivatedChannels: () => module.exports.getInstance().getAllActivatedChannels(),
  enableAutoResponse: (...args) => module.exports.getInstance().enableAutoResponse(...args),
  disableAutoResponse: (...args) => module.exports.getInstance().disableAutoResponse(...args),
  isAutoResponseEnabled: (...args) => module.exports.getInstance().isAutoResponseEnabled(...args),
  saveAllData: () => module.exports.getInstance().saveAllData(),

  // Export the instance getter for advanced usage
  get _instance() {
    return module.exports.getInstance();
  },
};
