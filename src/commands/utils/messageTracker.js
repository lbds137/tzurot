/**
 * MessageTracker - Tracks processed messages to prevent duplicates
 */
const logger = require('../../logger');

class MessageTracker {
  constructor(options = {}) {
    const {
      enableCleanupTimers = true,
      scheduler = setTimeout
    } = options;

    // Track processed message IDs to prevent duplicates
    this.processedMessages = new Set();

    // Track recent command executions by user
    this.recentCommands = new Map();

    // Track commands currently sending embed responses
    this.sendingEmbedResponses = new Set();

    // Track completed add commands to prevent duplicates
    this.completedAddCommands = new Set();

    // Track embeds already generated
    this.hasGeneratedFirstEmbed = new Set();

    // Specific tracking for add command message IDs
    this.addCommandMessageIds = new Set();

    // Store options
    this.enableCleanupTimers = enableCleanupTimers;
    this.scheduler = scheduler;

    // Set up cleanup intervals
    this._setupCleanupIntervals();
  }

  /**
   * Set up intervals to clean up tracking data and prevent memory leaks
   * @private
   */
  _setupCleanupIntervals() {
    // Only set up intervals if enabled
    if (!this.enableCleanupTimers) {
      return;
    }
    
    // Clean up processed messages every 10 minutes
    setInterval(
      () => {
        if (this.processedMessages.size > 0) {
          logger.debug(
            `[MessageTracker] Cleaning up processed messages cache (size: ${this.processedMessages.size})`
          );
          this.processedMessages.clear();
        }

        // Also clean up sendingEmbedResponses
        if (this.sendingEmbedResponses.size > 0) {
          logger.debug(
            `[MessageTracker] Cleaning up sendingEmbedResponses (size: ${this.sendingEmbedResponses.size})`
          );
          this.sendingEmbedResponses.clear();
        }

        // Clean up addCommandMessageIds
        if (this.addCommandMessageIds.size > 0) {
          logger.debug(
            `[MessageTracker] Cleaning up addCommandMessageIds (size: ${this.addCommandMessageIds.size})`
          );
          this.addCommandMessageIds.clear();
        }
      },
      10 * 60 * 1000
    ).unref(); // 10 minutes

    // Clean up completedAddCommands and hasGeneratedFirstEmbed every hour
    setInterval(
      () => {
        if (this.completedAddCommands.size > 0) {
          logger.debug(
            `[MessageTracker] Cleaning up completedAddCommands (size: ${this.completedAddCommands.size})`
          );
          this.completedAddCommands.clear();
        }

        if (this.hasGeneratedFirstEmbed.size > 0) {
          logger.debug(
            `[MessageTracker] Cleaning up hasGeneratedFirstEmbed (size: ${this.hasGeneratedFirstEmbed.size})`
          );
          this.hasGeneratedFirstEmbed.clear();
        }
      },
      60 * 60 * 1000
    ).unref(); // 1 hour
  }

  /**
   * Check if a message has been processed already
   * @param {string} messageId - Discord message ID
   * @returns {boolean} Whether the message has been processed
   */
  isProcessed(messageId) {
    return this.processedMessages.has(messageId);
  }

  /**
   * Mark a message as processed
   * @param {string} messageId - Discord message ID
   * @param {number} timeout - Optional timeout in ms (default: 30000)
   */
  markAsProcessed(messageId, timeout = 30000) {
    this.processedMessages.add(messageId);
    logger.debug(`[MessageTracker] Message ${messageId} marked as processed`);

    // Auto-remove after timeout (configurable via enableCleanupTimers)
    if (this.enableCleanupTimers) {
      this.scheduler(() => {
        this.processedMessages.delete(messageId);
        logger.debug(
          `[MessageTracker] Message ${messageId} removed from processedMessages after timeout`
        );
      }, timeout);
    }
  }

  /**
   * Check if a command was recently executed by the user
   * @param {string} userId - User ID
   * @param {string} command - Command name
   * @param {Array<string>} args - Command arguments
   * @returns {boolean} Whether the command was recently executed
   */
  isRecentCommand(userId, command, args) {
    const commandKey = `${userId}-${command}-${args.join('-')}`;
    const timestamp = this.recentCommands.get(commandKey);

    if (timestamp && Date.now() - timestamp < 3000) {
      logger.info(
        `[MessageTracker] Detected duplicate command execution: ${command} from ${userId}`
      );
      return true;
    }

    // Clean up old entries
    const now = Date.now();
    for (const [key, time] of this.recentCommands.entries()) {
      if (now - time > 10000) {
        // 10 seconds
        this.recentCommands.delete(key);
      }
    }

    // Mark this command as recent
    this.recentCommands.set(commandKey, now);
    return false;
  }

  /**
   * Check if an add command message ID has been processed
   * @param {string} messageId - Message ID
   * @returns {boolean} Whether the message has been processed
   */
  isAddCommandProcessed(messageId) {
    return this.addCommandMessageIds.has(messageId);
  }

  /**
   * Mark an add command message ID as processed
   * @param {string} messageId - Message ID
   */
  markAddCommandAsProcessed(messageId) {
    this.addCommandMessageIds.add(messageId);

    // Auto-remove after 1 minute
    setTimeout(() => {
      this.addCommandMessageIds.delete(messageId);
    }, 60 * 1000);
  }

  /**
   * Mark a command as sending an embed response
   * @param {string} messageKey - Unique message key
   */
  markSendingEmbed(messageKey) {
    this.sendingEmbedResponses.add(messageKey);
  }

  /**
   * Clear sending embed marker
   * @param {string} messageKey - Unique message key
   */
  clearSendingEmbed(messageKey) {
    this.sendingEmbedResponses.delete(messageKey);
  }

  /**
   * Check if already sending an embed for this message key
   * @param {string} messageKey - Unique message key
   * @returns {boolean} Whether already sending an embed
   */
  isSendingEmbed(messageKey) {
    return this.sendingEmbedResponses.has(messageKey);
  }

  /**
   * Mark as having generated first embed
   * @param {string} messageKey - Unique message key
   */
  markGeneratedFirstEmbed(messageKey) {
    this.hasGeneratedFirstEmbed.add(messageKey);
  }

  /**
   * Check if first embed already generated
   * @param {string} messageKey - Unique message key
   * @returns {boolean} Whether first embed was generated
   */
  hasFirstEmbed(messageKey) {
    return this.hasGeneratedFirstEmbed.has(messageKey);
  }

  /**
   * Mark add command as completed
   * @param {string} commandKey - Unique command key
   */
  markAddCommandCompleted(commandKey) {
    this.completedAddCommands.add(commandKey);

    // Auto-remove after a reasonable timeout (30 minutes)
    // This allows re-adding personalities that were removed
    setTimeout(
      () => {
        this.completedAddCommands.delete(commandKey);
        logger.debug(
          `[MessageTracker] Removed ${commandKey} from completedAddCommands after timeout`
        );
      },
      30 * 60 * 1000
    ); // 30 minutes
  }

  /**
   * Check if add command was completed
   * @param {string} commandKey - Unique command key
   * @returns {boolean} Whether command was completed
   */
  isAddCommandCompleted(commandKey) {
    return this.completedAddCommands.has(commandKey);
  }

  /**
   * Manually remove a completed add command key
   * This is useful when a personality is removed to immediately allow re-adding
   * @param {string} userId - User ID
   * @param {string} personalityName - Personality name
   */
  removeCompletedAddCommand(userId, personalityName) {
    // Generate a key pattern that matches how keys are created in the add command
    const keyPattern = `${userId}-${personalityName}-`;

    // Find and remove any keys that match this pattern
    for (const key of this.completedAddCommands) {
      if (key.startsWith(keyPattern)) {
        this.completedAddCommands.delete(key);
        logger.info(
          `[MessageTracker] Manually removed ${key} from completedAddCommands to allow re-adding`
        );
      }
    }
  }
}

// Export singleton instance
const messageTracker = new MessageTracker();
module.exports = messageTracker;
