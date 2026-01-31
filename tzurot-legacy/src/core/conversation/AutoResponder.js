const logger = require('../../logger');

/**
 * AutoResponder - Manages auto-response settings for users
 *
 * This module handles which users have auto-response enabled,
 * allowing the bot to continue conversations without requiring mentions.
 */
class AutoResponder {
  constructor() {
    // Track users with auto-response enabled
    this.autoResponseUsers = new Set();
  }

  /**
   * Enable auto-response for a user
   * @param {string} userId - Discord user ID
   * @returns {boolean} Success status
   */
  enable(userId) {
    this.autoResponseUsers.add(userId);
    logger.debug(`[AutoResponder] Enabled auto-response for user ${userId}`);
    return true;
  }

  /**
   * Disable auto-response for a user
   * @param {string} userId - Discord user ID
   * @returns {boolean} Whether the user had auto-response enabled
   */
  disable(userId) {
    const result = this.autoResponseUsers.delete(userId);
    if (result) {
      logger.debug(`[AutoResponder] Disabled auto-response for user ${userId}`);
    }
    return result;
  }

  /**
   * Check if auto-response is enabled for a user
   * @param {string} userId - Discord user ID
   * @returns {boolean} Whether auto-response is enabled
   */
  isEnabled(userId) {
    return this.autoResponseUsers.has(userId);
  }

  /**
   * Get all users with auto-response enabled (for persistence)
   * @returns {string[]} Array of user IDs
   */
  getAllUsers() {
    return Array.from(this.autoResponseUsers);
  }

  /**
   * Load users from persisted data
   * @param {string[]} users - Array of user IDs
   */
  loadFromData(users) {
    if (users && Array.isArray(users)) {
      this.autoResponseUsers.clear();
      users.forEach(userId => this.autoResponseUsers.add(userId));
      logger.info(`[AutoResponder] Loaded ${this.autoResponseUsers.size} auto-response users`);
    }
  }

  /**
   * Clear all auto-response settings
   */
  clear() {
    this.autoResponseUsers.clear();
  }
}

module.exports = AutoResponder;
