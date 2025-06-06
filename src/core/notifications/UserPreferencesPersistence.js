const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

/**
 * UserPreferencesPersistence - Manages user notification preferences
 */
class UserPreferencesPersistence {
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.join(__dirname, '../../../data');
    this.preferencesFile = path.join(this.dataPath, 'releaseNotificationPreferences.json');
    this.preferences = new Map();
    this.saveDebounceTimer = null;
    this.saveDebounceDelay = options.saveDebounceDelay || 5000; // 5 seconds

    // Injectable timer functions for testability
    this.scheduler = options.scheduler || setTimeout;
    this.clearScheduler = options.clearScheduler || clearTimeout;
  }

  /**
   * Load preferences from disk
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.preferencesFile, 'utf8'));
      this.preferences.clear();

      for (const [userId, prefs] of Object.entries(data)) {
        this.preferences.set(userId, prefs);
      }

      logger.info(`[UserPreferencesPersistence] Loaded ${this.preferences.size} user preferences`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('[UserPreferencesPersistence] No preferences file found, starting fresh');
        return;
      }
      logger.error(`[UserPreferencesPersistence] Error loading preferences: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save preferences to disk (debounced)
   * @returns {Promise<void>}
   */
  async save() {
    // Clear existing timer
    if (this.saveDebounceTimer) {
      this.clearScheduler(this.saveDebounceTimer);
    }

    // Set new timer
    this.saveDebounceTimer = this.scheduler(async () => {
      await this._performSave();
    }, this.saveDebounceDelay);
  }

  /**
   * Force immediate save
   * @returns {Promise<void>}
   */
  async forceSave() {
    if (this.saveDebounceTimer) {
      this.clearScheduler(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    await this._performSave();
  }

  /**
   * Actually perform the save operation
   * @private
   * @returns {Promise<void>}
   */
  async _performSave() {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });

      const data = {};
      for (const [userId, prefs] of this.preferences.entries()) {
        data[userId] = prefs;
      }

      await fs.writeFile(this.preferencesFile, JSON.stringify(data, null, 2));
      logger.info(`[UserPreferencesPersistence] Saved ${this.preferences.size} user preferences`);
    } catch (error) {
      logger.error(`[UserPreferencesPersistence] Error saving preferences: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get user preferences
   * @param {string} userId - Discord user ID
   * @returns {Object} User preferences with defaults
   */
  getUserPreferences(userId) {
    const now = new Date().toISOString();
    const defaults = {
      optedOut: false,
      notificationLevel: 'minor', // 'major', 'minor', 'patch', 'none'
      lastNotified: null,
      createdAt: now,
      updatedAt: now,
    };

    const stored = this.preferences.get(userId);
    return { ...defaults, ...stored };
  }

  /**
   * Update user preferences
   * @param {string} userId - Discord user ID
   * @param {Object} updates - Preference updates
   * @returns {Promise<Object>} Updated preferences
   */
  async updateUserPreferences(userId, updates) {
    const current = this.getUserPreferences(userId);
    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
      // Preserve createdAt if it exists
      createdAt: current.createdAt || new Date().toISOString(),
    };

    this.preferences.set(userId, updated);
    await this.save(); // Debounced save

    logger.info(`[UserPreferencesPersistence] Updated preferences for user ${userId}`);
    return updated;
  }

  /**
   * Set user opt-out status
   * @param {string} userId - Discord user ID
   * @param {boolean} optedOut - Whether user is opted out
   * @returns {Promise<Object>} Updated preferences
   */
  async setOptOut(userId, optedOut) {
    return this.updateUserPreferences(userId, { optedOut });
  }

  /**
   * Set user notification level
   * @param {string} userId - Discord user ID
   * @param {string} level - Notification level ('major', 'minor', 'patch', 'none')
   * @returns {Promise<Object>} Updated preferences
   */
  async setNotificationLevel(userId, level) {
    const validLevels = ['major', 'minor', 'patch', 'none'];
    if (!validLevels.includes(level)) {
      throw new Error(`Invalid notification level: ${level}`);
    }
    return this.updateUserPreferences(userId, { notificationLevel: level });
  }

  /**
   * Record that a user was notified of a version
   * @param {string} userId - Discord user ID
   * @param {string} version - Version that was notified
   * @returns {Promise<Object>} Updated preferences
   */
  async recordNotification(userId, version) {
    return this.updateUserPreferences(userId, { lastNotified: version });
  }

  /**
   * Get all users who should be notified for a change type
   * @param {string} changeType - Type of change ('major', 'minor', 'patch')
   * @returns {Array<string>} User IDs to notify
   */
  getUsersToNotify(changeType) {
    const users = [];

    for (const [userId, prefs] of this.preferences.entries()) {
      // Skip opted out users
      if (prefs.optedOut) continue;

      // Get user's notification level (default to minor)
      const userLevel = prefs.notificationLevel || 'minor';

      // Skip users with 'none' level
      if (userLevel === 'none') continue;

      // Check if user should be notified based on their preference
      let shouldNotify = false;

      switch (userLevel) {
        case 'major':
          // Only notify for major changes
          shouldNotify = changeType === 'major';
          break;
        case 'minor':
          // Notify for minor and major changes
          shouldNotify = changeType === 'major' || changeType === 'minor';
          break;
        case 'patch':
          // Notify for all changes (patch, minor, and major)
          shouldNotify = true;
          break;
      }

      if (shouldNotify) {
        users.push(userId);
      }
    }

    return users;
  }

  /**
   * Get count of users by preference type
   * @returns {Object} Statistics about user preferences
   */
  getStatistics() {
    const stats = {
      total: this.preferences.size,
      optedOut: 0,
      byLevel: { major: 0, minor: 0, patch: 0, none: 0 },
    };

    for (const prefs of this.preferences.values()) {
      if (prefs.optedOut) stats.optedOut++;
      const level = prefs.notificationLevel || 'minor';
      if (stats.byLevel[level] !== undefined) {
        stats.byLevel[level]++;
      }
    }

    return stats;
  }

  /**
   * Check if any user has ever been notified
   * @returns {boolean} True if at least one notification has been sent
   */
  hasAnyUserBeenNotified() {
    for (const prefs of this.preferences.values()) {
      if (prefs.lastNotified) {
        return true;
      }
    }
    return false;
  }
}

module.exports = UserPreferencesPersistence;
