const { saveData, loadData } = require('../../dataStorage');
const logger = require('../../logger');

// File names for stored data
const PERSONALITIES_FILE = 'personalities';
const ALIASES_FILE = 'aliases';

/**
 * PersonalityPersistence - Handles file-based storage of personality data
 *
 * This class manages the persistence layer for personalities,
 * handling loading from and saving to disk storage.
 */
class PersonalityPersistence {
  /**
   * Load personality data from disk
   * @returns {Promise<{personalities: Object, aliases: Object}>} The loaded data
   */
  async load() {
    try {
      logger.info('[PersonalityPersistence] Loading personality data from disk');

      // Load personalities
      const personalities = (await loadData(PERSONALITIES_FILE)) || {};
      const personalityCount = Object.keys(personalities).length;
      logger.info(`[PersonalityPersistence] Found ${personalityCount} personalities in storage`);

      // Load aliases
      const aliases = (await loadData(ALIASES_FILE)) || {};
      const aliasCount = Object.keys(aliases).length;
      logger.info(`[PersonalityPersistence] Found ${aliasCount} aliases in storage`);

      return { personalities, aliases };
    } catch (error) {
      logger.error(`[PersonalityPersistence] Error loading data: ${error.message}`);
      // Return empty objects on error to allow the system to continue
      return { personalities: {}, aliases: {} };
    }
  }

  /**
   * Save personality data to disk
   * @param {Object} personalities - The personalities object to save
   * @param {Object} aliases - The aliases object to save
   * @returns {Promise<boolean>} True if saved successfully, false otherwise
   */
  async save(personalities, aliases) {
    try {
      logger.debug('[PersonalityPersistence] Saving personality data to disk');

      // Save personalities
      const personalitySaved = await saveData(PERSONALITIES_FILE, personalities);
      if (!personalitySaved) {
        logger.error('[PersonalityPersistence] Failed to save personalities');
        return false;
      }

      // Save aliases
      const aliasesSaved = await saveData(ALIASES_FILE, aliases);
      if (!aliasesSaved) {
        logger.error('[PersonalityPersistence] Failed to save aliases');
        return false;
      }

      const personalityCount = Object.keys(personalities).length;
      const aliasCount = Object.keys(aliases).length;
      logger.info(
        `[PersonalityPersistence] Successfully saved ${personalityCount} personalities and ${aliasCount} aliases`
      );

      return true;
    } catch (error) {
      logger.error(`[PersonalityPersistence] Error saving data: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if personality files exist
   * @returns {Promise<{personalitiesExist: boolean, aliasesExist: boolean}>} File existence status
   */
  async checkFilesExist() {
    try {
      const personalities = await loadData(PERSONALITIES_FILE);
      const aliases = await loadData(ALIASES_FILE);

      return {
        personalitiesExist: personalities !== null,
        aliasesExist: aliases !== null,
      };
    } catch (error) {
      logger.error(`[PersonalityPersistence] Error checking files: ${error.message}`);
      return {
        personalitiesExist: false,
        aliasesExist: false,
      };
    }
  }

  /**
   * Clear all personality data from disk
   * @returns {Promise<boolean>} True if cleared successfully, false otherwise
   */
  async clear() {
    try {
      logger.warn('[PersonalityPersistence] Clearing all personality data from disk');

      const personalitiesCleared = await saveData(PERSONALITIES_FILE, {});
      const aliasesCleared = await saveData(ALIASES_FILE, {});

      if (personalitiesCleared && aliasesCleared) {
        logger.info('[PersonalityPersistence] Successfully cleared all personality data');
        return true;
      } else {
        logger.error('[PersonalityPersistence] Failed to clear some personality data');
        return false;
      }
    } catch (error) {
      logger.error(`[PersonalityPersistence] Error clearing data: ${error.message}`);
      return false;
    }
  }

  /**
   * Create a backup of personality data
   * @returns {Promise<boolean>} True if backup created successfully, false otherwise
   */
  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPersonalitiesFile = `${PERSONALITIES_FILE}_backup_${timestamp}`;
      const backupAliasesFile = `${ALIASES_FILE}_backup_${timestamp}`;

      const { personalities, aliases } = await this.load();

      const personalitiesBackup = await saveData(backupPersonalitiesFile, personalities);
      const aliasesBackup = await saveData(backupAliasesFile, aliases);

      if (personalitiesBackup && aliasesBackup) {
        logger.info(
          `[PersonalityPersistence] Backup created: ${backupPersonalitiesFile}, ${backupAliasesFile}`
        );
        return true;
      } else {
        logger.error('[PersonalityPersistence] Failed to create backup');
        return false;
      }
    } catch (error) {
      logger.error(`[PersonalityPersistence] Error creating backup: ${error.message}`);
      return false;
    }
  }
}

module.exports = PersonalityPersistence;
