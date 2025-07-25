/**
 * Repository for managing extended personality data with automatic backup detection
 * @module domain/personality/PersonalityDataRepository
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');
const { ExtendedPersonalityProfile } = require('./ExtendedPersonalityProfile');

/**
 * @class PersonalityDataRepository
 * @description Manages extended personality data with automatic migration from backup files
 */
class PersonalityDataRepository {
  constructor(dataDir = null) {
    // Allow injection for testing
    this.dataDir =
      dataDir || path.join(__dirname, '..', '..', '..', 'data', 'ddd_personality_data');
    this.backupDir = path.join(__dirname, '..', '..', '..', 'data', 'personalities');
    this.cache = new Map(); // Memory cache for loaded data
  }

  /**
   * Get extended personality data, automatically loading from backups if available
   * @param {string} personalityName - Name of the personality
   * @returns {Promise<ExtendedPersonalityProfile|null>}
   */
  async getExtendedProfile(personalityName) {
    // Check cache first
    if (this.cache.has(personalityName)) {
      return this.cache.get(personalityName);
    }

    try {
      // Check if we have migrated data
      const migratedData = await this.loadMigratedData(personalityName);
      if (migratedData) {
        const profile = ExtendedPersonalityProfile.fromJSON(migratedData);
        this.cache.set(personalityName, profile);
        return profile;
      }

      // Check for backup data and migrate on-the-fly
      const backupData = await this.loadBackupData(personalityName);
      if (backupData) {
        logger.info(
          `[PersonalityDataRepository] Auto-migrating backup data for ${personalityName}`
        );
        const profile = ExtendedPersonalityProfile.fromBackupData(backupData);

        // Save migrated data for future use
        await this.saveMigratedData(personalityName, profile);
        this.cache.set(personalityName, profile);
        return profile;
      }

      return null;
    } catch (error) {
      logger.error(
        `[PersonalityDataRepository] Error loading data for ${personalityName}: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Check if personality has extended data available (either migrated or in backups)
   * @param {string} personalityName - Name of the personality
   * @returns {Promise<boolean>}
   */
  async hasExtendedData(personalityName) {
    // Check migrated data first
    const personalityDir = path.join(this.dataDir, personalityName);
    try {
      await fs.access(path.join(personalityDir, 'profile.json'));
      return true;
    } catch {
      // Check backup directory
      try {
        const backupPath = path.join(this.backupDir, personalityName);
        await fs.access(backupPath);
        return true;
      } catch {
        // No backup data found
      }
    }
    return false;
  }

  /**
   * Load migrated data from ddd_personality_data directory
   * @private
   */
  async loadMigratedData(personalityName) {
    const personalityDir = path.join(this.dataDir, personalityName);
    const profilePath = path.join(personalityDir, 'profile.json');

    try {
      const data = await fs.readFile(profilePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Load backup data from various backup directories
   * @private
   */
  async loadBackupData(personalityName) {
    try {
      const personalityBackupDir = path.join(this.backupDir, personalityName);

      // Check if backup directory exists
      await fs.access(personalityBackupDir);

      // Load main profile data
      const mainDataPath = path.join(personalityBackupDir, `${personalityName}.json`);
      let mainData = {};
      try {
        const mainContent = await fs.readFile(mainDataPath, 'utf8');
        mainData = JSON.parse(mainContent);
      } catch (_error) {
        logger.debug(`[PersonalityDataRepository] No main profile data for ${personalityName}`);
      }

      // Load auxiliary data files
      const auxiliaryData = {};

      // Try to load each auxiliary file
      const auxiliaryFiles = {
        knowledge: `${personalityName}_knowledge.json`,
        memories: `${personalityName}_memories.json`,
        training: `${personalityName}_training.json`,
        userPersonalization: `${personalityName}_user_personalization.json`,
        chatHistory: `${personalityName}_chat_history.json`,
      };

      for (const [key, filename] of Object.entries(auxiliaryFiles)) {
        try {
          const filePath = path.join(personalityBackupDir, filename);
          const content = await fs.readFile(filePath, 'utf8');
          auxiliaryData[key] = JSON.parse(content);
        } catch {
          // File doesn't exist or can't be read, that's okay
          logger.debug(`[PersonalityDataRepository] No ${key} data for ${personalityName}`);
        }
      }

      // Return combined data
      return {
        main: mainData,
        ...auxiliaryData,
      };
    } catch {
      // No backup data found for this personality
      return null;
    }
  }

  /**
   * Save migrated data to ddd_personality_data directory
   * @private
   */
  async saveMigratedData(personalityName, profile) {
    const personalityDir = path.join(this.dataDir, personalityName);

    // Ensure directory exists
    await fs.mkdir(personalityDir, { recursive: true });

    // Save profile data
    const profilePath = path.join(personalityDir, 'profile.json');
    await fs.writeFile(profilePath, JSON.stringify(profile.toJSON(), null, 2));

    logger.info(`[PersonalityDataRepository] Saved migrated data for ${personalityName}`);
  }

  /**
   * Get chat history for a personality
   * @param {string} personalityName - Name of the personality
   * @param {Object} options - Query options
   * @returns {Promise<Array>}
   */
  async getChatHistory(personalityName, options = {}) {
    const { limit = 50, beforeTimestamp = null, userId = null } = options;

    // First check if we have extended profile with chat history
    const profile = await this.getExtendedProfile(personalityName);
    if (!profile) {
      return [];
    }

    // Check for chat history in auxiliary data
    const chatHistoryPath = path.join(this.dataDir, personalityName, 'chat_history.json');
    let allMessages = [];

    try {
      const content = await fs.readFile(chatHistoryPath, 'utf8');
      const chatData = JSON.parse(content);
      allMessages = chatData.messages || [];
    } catch {
      // Try loading from backup
      const backupData = await this.loadBackupData(personalityName);
      if (backupData && backupData.chatHistory) {
        allMessages = backupData.chatHistory.messages || [];
      }
    }

    // Filter by user if specified
    if (userId) {
      allMessages = allMessages.filter(
        msg => msg.user_id === userId || (msg.metadata && msg.metadata.user_id === userId)
      );
    }

    // Filter by timestamp if specified
    if (beforeTimestamp) {
      allMessages = allMessages.filter(msg => msg.ts < beforeTimestamp);
    }

    // Sort by timestamp descending and limit
    allMessages.sort((a, b) => b.ts - a.ts);
    return allMessages.slice(0, limit);
  }

  /**
   * Get knowledge/story data for a personality
   * @param {string} personalityName - Name of the personality
   * @returns {Promise<Array>}
   */
  async getKnowledge(personalityName) {
    const knowledgePath = path.join(this.dataDir, personalityName, 'knowledge.json');

    try {
      const content = await fs.readFile(knowledgePath, 'utf8');
      return JSON.parse(content);
    } catch {
      // Try loading from backup
      const backupData = await this.loadBackupData(personalityName);
      return (backupData && backupData.knowledge) || [];
    }
  }

  /**
   * Get memories for a personality
   * @param {string} personalityName - Name of the personality
   * @returns {Promise<Array>}
   */
  async getMemories(personalityName) {
    const memoriesPath = path.join(this.dataDir, personalityName, 'memories.json');

    try {
      const content = await fs.readFile(memoriesPath, 'utf8');
      return JSON.parse(content);
    } catch {
      // Try loading from backup
      const backupData = await this.loadBackupData(personalityName);
      return (backupData && backupData.memories) || [];
    }
  }

  /**
   * Clear cache for a specific personality or all
   * @param {string} [personalityName] - Name of personality to clear, or null for all
   */
  clearCache(personalityName = null) {
    if (personalityName) {
      this.cache.delete(personalityName);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = { PersonalityDataRepository };
