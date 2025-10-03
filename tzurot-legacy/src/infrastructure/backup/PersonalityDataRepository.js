/**
 * PersonalityDataRepository Infrastructure
 * Handles persistence of personality backup data to filesystem
 */

const fs = require('fs').promises;
const path = require('path');
const { PersonalityData, BackupMetadata } = require('../../domain/backup/PersonalityData');
const logger = require('../../logger');

/**
 * File-based repository for personality backup data
 */
class PersonalityDataRepository {
  /**
   * Create repository
   * @param {Object} options - Repository options
   * @param {string} [options.backupDir] - Base directory for backups
   * @param {Object} [options.fs] - File system interface (for testing)
   */
  constructor({ backupDir = null, fs: fsInterface = null } = {}) {
    this.fs = fsInterface || fs;
    this.backupDir = backupDir || this._getDefaultBackupDir();
  }

  /**
   * Load personality data from storage
   * @param {string} personalityName - Name of personality
   * @returns {Promise<PersonalityData>} Loaded personality data
   */
  async load(personalityName) {
    const personalityData = new PersonalityData(personalityName);

    try {
      // Load metadata
      const metadata = await this._loadMetadata(personalityName);
      personalityData.metadata = metadata;

      // Load profile if exists
      try {
        const profile = await this._loadProfile(personalityName);
        personalityData.updateProfile(profile);
      } catch (error) {
        // Profile doesn't exist yet - that's okay
        logger.debug(`[PersonalityDataRepository] No existing profile for ${personalityName}`);
      }

      // Load other data types if they exist
      personalityData.memories = await this._loadMemories(personalityName);
      personalityData.knowledge = await this._loadKnowledge(personalityName);
      personalityData.training = await this._loadTraining(personalityName);
      personalityData.userPersonalization = await this._loadUserPersonalization(personalityName);
      personalityData.chatHistory = await this._loadChatHistory(personalityName);

      logger.debug(`[PersonalityDataRepository] Loaded data for ${personalityName}`);
      return personalityData;
    } catch (error) {
      logger.error(
        `[PersonalityDataRepository] Error loading ${personalityName}: ${error.message}`
      );
      // Return empty personality data if loading fails
      return personalityData;
    }
  }

  /**
   * Save personality data to storage
   * @param {PersonalityData} personalityData - Data to save
   * @returns {Promise<void>}
   */
  async save(personalityData) {
    if (!(personalityData instanceof PersonalityData)) {
      throw new Error('Invalid data: must be PersonalityData instance');
    }

    const personalityDir = path.join(this.backupDir, personalityData.name);
    await this._ensureDirectoryExists(personalityDir);

    try {
      // Save metadata
      await this._saveMetadata(personalityData.name, personalityData.metadata);

      // Save profile if exists
      if (personalityData.profile) {
        await this._saveProfile(personalityData.name, personalityData.profile);
      }

      // Save other data types
      if (personalityData.memories.length > 0) {
        await this._saveMemories(personalityData.name, personalityData.memories);
      }

      if (personalityData.knowledge.length > 0) {
        await this._saveKnowledge(personalityData.name, personalityData.knowledge);
      }

      if (personalityData.training.length > 0) {
        await this._saveTraining(personalityData.name, personalityData.training);
      }

      if (Object.keys(personalityData.userPersonalization).length > 0) {
        await this._saveUserPersonalization(
          personalityData.name,
          personalityData.userPersonalization
        );
      }

      if (personalityData.chatHistory.length > 0) {
        await this._saveChatHistory(
          personalityData.name,
          personalityData.chatHistory,
          personalityData.id
        );
      }

      logger.info(`[PersonalityDataRepository] Saved data for ${personalityData.name}`);
    } catch (error) {
      logger.error(
        `[PersonalityDataRepository] Error saving ${personalityData.name}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Check if personality data exists
   * @param {string} personalityName - Name of personality
   * @returns {Promise<boolean>} True if data exists
   */
  async exists(personalityName) {
    const personalityDir = path.join(this.backupDir, personalityName);
    try {
      await this.fs.access(personalityDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get default backup directory
   * @private
   */
  _getDefaultBackupDir() {
    return path.join(__dirname, '..', '..', '..', 'data', 'personalities');
  }

  /**
   * Ensure directory exists
   * @private
   */
  async _ensureDirectoryExists(dir) {
    await this.fs.mkdir(dir, { recursive: true });
  }

  /**
   * Load metadata
   * @private
   */
  async _loadMetadata(personalityName) {
    const metadataPath = path.join(this.backupDir, personalityName, '.backup-metadata.json');
    try {
      const data = await this.fs.readFile(metadataPath, 'utf8');
      const metadataData = JSON.parse(data);
      return new BackupMetadata(metadataData);
    } catch {
      return new BackupMetadata();
    }
  }

  /**
   * Save metadata
   * @private
   */
  async _saveMetadata(personalityName, metadata) {
    const metadataPath = path.join(this.backupDir, personalityName, '.backup-metadata.json');
    await this.fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load profile
   * @private
   */
  async _loadProfile(personalityName) {
    const profilePath = path.join(this.backupDir, personalityName, `${personalityName}.json`);
    const data = await this.fs.readFile(profilePath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * Save profile
   * @private
   */
  async _saveProfile(personalityName, profile) {
    const profilePath = path.join(this.backupDir, personalityName, `${personalityName}.json`);
    await this.fs.writeFile(profilePath, JSON.stringify(profile, null, 2));
    logger.info(`[PersonalityDataRepository] Saved profile for ${personalityName}`);
  }

  /**
   * Load memories
   * @private
   */
  async _loadMemories(personalityName) {
    const memoryPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_memories.json`
    );
    try {
      const data = await this.fs.readFile(memoryPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Save memories
   * @private
   */
  async _saveMemories(personalityName, memories) {
    const memoryPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_memories.json`
    );
    await this.fs.writeFile(memoryPath, JSON.stringify(memories, null, 2));
    logger.info(
      `[PersonalityDataRepository] Saved ${memories.length} memories for ${personalityName}`
    );
  }

  /**
   * Load knowledge
   * @private
   */
  async _loadKnowledge(personalityName) {
    const knowledgePath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_knowledge.json`
    );
    try {
      const data = await this.fs.readFile(knowledgePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Save knowledge
   * @private
   */
  async _saveKnowledge(personalityName, knowledge) {
    const knowledgePath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_knowledge.json`
    );
    await this.fs.writeFile(knowledgePath, JSON.stringify(knowledge, null, 2));
    logger.info(`[PersonalityDataRepository] Saved knowledge/story data for ${personalityName}`);
  }

  /**
   * Load training
   * @private
   */
  async _loadTraining(personalityName) {
    const trainingPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_training.json`
    );
    try {
      const data = await this.fs.readFile(trainingPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  /**
   * Save training
   * @private
   */
  async _saveTraining(personalityName, training) {
    const trainingPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_training.json`
    );
    await this.fs.writeFile(trainingPath, JSON.stringify(training, null, 2));
    logger.info(`[PersonalityDataRepository] Saved training data for ${personalityName}`);
  }

  /**
   * Load user personalization
   * @private
   */
  async _loadUserPersonalization(personalityName) {
    const userPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_user_personalization.json`
    );
    try {
      const data = await this.fs.readFile(userPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  /**
   * Save user personalization
   * @private
   */
  async _saveUserPersonalization(personalityName, userPersonalization) {
    const userPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_user_personalization.json`
    );
    await this.fs.writeFile(userPath, JSON.stringify(userPersonalization, null, 2));
    logger.info(
      `[PersonalityDataRepository] Saved user personalization data for ${personalityName}`
    );
  }

  /**
   * Load chat history
   * @private
   */
  async _loadChatHistory(personalityName) {
    const chatPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_chat_history.json`
    );
    try {
      const data = await this.fs.readFile(chatPath, 'utf8');
      const chatData = JSON.parse(data);
      return chatData.messages || [];
    } catch {
      return [];
    }
  }

  /**
   * Save chat history
   * @private
   */
  async _saveChatHistory(personalityName, messages, personalityId) {
    const chatData = {
      shape_id: personalityId,
      shape_name: personalityName,
      message_count: messages.length,
      date_range: {
        earliest: messages.length > 0 ? new Date(messages[0].ts * 1000).toISOString() : null,
        latest:
          messages.length > 0
            ? new Date(messages[messages.length - 1].ts * 1000).toISOString()
            : null,
      },
      export_date: new Date().toISOString(),
      messages: messages,
    };

    const chatPath = path.join(
      this.backupDir,
      personalityName,
      `${personalityName}_chat_history.json`
    );
    await this.fs.writeFile(chatPath, JSON.stringify(chatData, null, 2));
    logger.info(
      `[PersonalityDataRepository] Saved ${messages.length} chat messages for ${personalityName}`
    );
  }
}

module.exports = {
  PersonalityDataRepository,
};
