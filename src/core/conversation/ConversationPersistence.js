const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

/**
 * ConversationPersistence - Handles file-based persistence for conversation data
 *
 * This module manages saving and loading conversation data to/from the filesystem.
 */
class ConversationPersistence {
  constructor(dataDir = null) {
    // File paths for storing data
    this.DATA_DIR = dataDir || path.join(process.cwd(), 'data');
    this.CONVERSATIONS_FILE = path.join(this.DATA_DIR, 'conversations.json');
    this.CHANNEL_ACTIVATIONS_FILE = path.join(this.DATA_DIR, 'channel_activations.json');
    this.AUTO_RESPONSE_FILE = path.join(this.DATA_DIR, 'auto_response.json');
    this.MESSAGE_MAP_FILE = path.join(this.DATA_DIR, 'message_map.json');

    // Track if save is in progress to prevent concurrent saves
    this.isSaving = false;
  }

  /**
   * Ensure the data directory exists
   * @private
   */
  async _ensureDataDir() {
    try {
      await fs.mkdir(this.DATA_DIR, { recursive: true });
    } catch (error) {
      logger.error(`[ConversationPersistence] Error creating data directory: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save all conversation data to files
   * @param {Object} data - Data to save
   * @param {Object} data.conversations - Active conversations data
   * @param {Object} data.activatedChannels - Activated channels data
   * @param {string[]} data.autoResponseUsers - Users with auto-response enabled
   * @param {Object} data.messageMap - Message ID mappings
   */
  async saveAll(data) {
    if (this.isSaving) {
      logger.debug('[ConversationPersistence] Save already in progress, skipping');
      return;
    }

    this.isSaving = true;

    try {
      await this._ensureDataDir();

      // Save all data files in parallel
      await Promise.all([
        this._saveFile(this.CONVERSATIONS_FILE, data.conversations),
        this._saveFile(this.CHANNEL_ACTIVATIONS_FILE, data.activatedChannels),
        this._saveFile(this.AUTO_RESPONSE_FILE, data.autoResponseUsers),
        this._saveFile(this.MESSAGE_MAP_FILE, data.messageMap),
      ]);

      logger.info('[ConversationPersistence] All conversation data saved successfully');
    } catch (error) {
      logger.error(`[ConversationPersistence] Error saving conversation data: ${error.message}`);
      throw error;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Load all conversation data from files
   * @returns {Object} Loaded data
   */
  async loadAll() {
    try {
      await this._ensureDataDir();

      // Load all data files in parallel
      const [conversations, activatedChannels, autoResponseUsers, messageMap] = await Promise.all([
        this._loadFile(this.CONVERSATIONS_FILE),
        this._loadFile(this.CHANNEL_ACTIVATIONS_FILE),
        this._loadFile(this.AUTO_RESPONSE_FILE),
        this._loadFile(this.MESSAGE_MAP_FILE),
      ]);

      logger.info('[ConversationPersistence] All conversation data loaded successfully');

      return {
        conversations,
        activatedChannels,
        autoResponseUsers,
        messageMap,
      };
    } catch (error) {
      logger.error(`[ConversationPersistence] Error loading conversation data: ${error.message}`);
      // Return empty data structure on error
      return {
        conversations: {},
        activatedChannels: {},
        autoResponseUsers: [],
        messageMap: {},
      };
    }
  }

  /**
   * Save data to a specific file
   * @private
   * @param {string} filePath - Path to the file
   * @param {*} data - Data to save
   */
  async _saveFile(filePath, data) {
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      logger.debug(`[ConversationPersistence] Saved data to ${path.basename(filePath)}`);
    } catch (error) {
      logger.error(
        `[ConversationPersistence] Error saving to ${path.basename(filePath)}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Load data from a specific file
   * @private
   * @param {string} filePath - Path to the file
   * @returns {*} Loaded data or null if file doesn't exist
   */
  async _loadFile(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      logger.debug(`[ConversationPersistence] Loaded data from ${path.basename(filePath)}`);
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, return null
        logger.debug(
          `[ConversationPersistence] File ${path.basename(filePath)} does not exist yet`
        );
        return null;
      }
      logger.error(
        `[ConversationPersistence] Error loading from ${path.basename(filePath)}: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Delete all persisted data files (useful for testing)
   */
  async deleteAll() {
    try {
      await Promise.all([
        fs.unlink(this.CONVERSATIONS_FILE).catch(() => {}),
        fs.unlink(this.CHANNEL_ACTIVATIONS_FILE).catch(() => {}),
        fs.unlink(this.AUTO_RESPONSE_FILE).catch(() => {}),
        fs.unlink(this.MESSAGE_MAP_FILE).catch(() => {}),
      ]);
      logger.info('[ConversationPersistence] All conversation data files deleted');
    } catch (error) {
      logger.error(`[ConversationPersistence] Error deleting data files: ${error.message}`);
    }
  }
}

module.exports = ConversationPersistence;
