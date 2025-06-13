/**
 * MessageTracker - Tracks processed messages to prevent duplicates
 */
const logger = require('../../logger');

// Timer functions will be injected or use defaults

class MessageTracker {
  constructor(options = {}) {
    const {
      enableCleanupTimers = true,
      scheduler = globalThis.setTimeout || setTimeout,
      interval = globalThis.setInterval || setInterval,
      delay = ms => {
        const timer = globalThis.setTimeout || setTimeout;
        return new Promise(resolve => timer(resolve, ms));
      },
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

    // Log initialization for debugging
    logger.debug('[MessageTracker] Initialized with empty tracking sets');

    // Store options
    this.enableCleanupTimers = enableCleanupTimers;
    this.scheduler = scheduler;
    this.interval = interval;
    this.delay = delay;

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
    const processedInterval = this.interval(
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
    );

    // Allow process to exit even with interval running
    if (processedInterval.unref) {
      processedInterval.unref();
    }

    // Clean up completedAddCommands and hasGeneratedFirstEmbed every hour
    const completedInterval = this.interval(
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
    );

    // Allow process to exit even with interval running
    if (completedInterval.unref) {
      completedInterval.unref();
    }
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
    this.scheduler(() => {
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
    logger.info(`[MessageTracker] Marking add command as completed: ${commandKey}`);
    logger.debug(
      `[MessageTracker] Current completedAddCommands size: ${this.completedAddCommands.size}`
    );
    this.completedAddCommands.add(commandKey);
    logger.debug(
      `[MessageTracker] After adding, completedAddCommands size: ${this.completedAddCommands.size}`
    );

    // Auto-remove after a reasonable timeout (30 minutes)
    // This allows re-adding personalities that were removed
    this.scheduler(
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
    const isCompleted = this.completedAddCommands.has(commandKey);
    if (isCompleted) {
      logger.debug(`[MessageTracker] Command key ${commandKey} found in completedAddCommands`);
      logger.debug(
        `[MessageTracker] Current completedAddCommands contents: ${Array.from(this.completedAddCommands).join(', ')}`
      );
    }
    return isCompleted;
  }

  /**
   * Manually remove a completed add command key
   * This is useful when a personality is removed to immediately allow re-adding
   * @param {string} userId - User ID
   * @param {string} personalityName - Personality name
   */
  removeCompletedAddCommand(userId, personalityName) {
    // Generate key patterns that match how keys are created in the add command
    const keyPatternWithDash = `${userId}-${personalityName}-`;
    const keyPatternExact = `${userId}-${personalityName}`;

    // Find and remove any keys that match these patterns
    for (const key of this.completedAddCommands) {
      if (key.startsWith(keyPatternWithDash) || key === keyPatternExact) {
        this.completedAddCommands.delete(key);
        logger.info(
          `[MessageTracker] Manually removed ${key} from completedAddCommands to allow re-adding`
        );
      }
    }
  }

  /**
   * Clear all completed add commands for a specific personality name
   * This is useful when a personality needs to be re-added by any user
   * @param {string} personalityName - Personality name
   */
  clearAllCompletedAddCommandsForPersonality(personalityName) {
    let removedCount = 0;
    // Find and remove any keys that contain this personality name
    for (const key of this.completedAddCommands) {
      // Keys are in format: userId-personalityName or userId-personalityName-alias-aliasName
      const parts = key.split('-');
      if (parts.length >= 2 && parts[1] === personalityName) {
        this.completedAddCommands.delete(key);
        logger.info(`[MessageTracker] Cleared completed add command: ${key}`);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      logger.info(
        `[MessageTracker] Cleared ${removedCount} completed add commands for personality: ${personalityName}`
      );
    }
    return removedCount;
  }
}

// Export the class
module.exports = MessageTracker;
