/**
 * AuthPersistence - Handles file I/O for authentication data
 *
 * Manages:
 * - Token persistence to disk
 * - NSFW verification persistence
 * - Data loading and saving
 * - File system operations
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

class AuthPersistence {
  constructor(dataDir = null) {
    this.dataDir = dataDir || path.join(process.cwd(), 'data');
    this.authTokensFile = path.join(this.dataDir, 'auth_tokens.json');
    this.nsfwVerifiedFile = path.join(this.dataDir, 'nsfw_verified.json');
  }

  /**
   * Ensure data directory exists
   * @returns {Promise<void>}
   */
  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      logger.error(`[AuthPersistence] Failed to create data directory:`, error);
      throw error;
    }
  }

  /**
   * Load user tokens from disk
   * @returns {Promise<Object>} The tokens object
   */
  async loadUserTokens() {
    try {
      await this.ensureDataDir();

      try {
        const data = await fs.readFile(this.authTokensFile, 'utf8');
        const tokens = JSON.parse(data);
        logger.info(`[AuthPersistence] Loaded ${Object.keys(tokens).length} user tokens`);
        return tokens;
      } catch (readError) {
        if (readError.code === 'ENOENT') {
          // File doesn't exist yet
          logger.info(`[AuthPersistence] No tokens file found, returning empty object`);
          return {};
        }
        throw readError;
      }
    } catch (error) {
      logger.error(`[AuthPersistence] Error loading user tokens:`, error);
      return {};
    }
  }

  /**
   * Save user tokens to disk
   * @param {Object} tokens - The tokens object to save
   * @returns {Promise<boolean>} Whether save was successful
   */
  async saveUserTokens(tokens) {
    try {
      await this.ensureDataDir();
      await fs.writeFile(this.authTokensFile, JSON.stringify(tokens, null, 2));
      logger.info(`[AuthPersistence] Saved ${Object.keys(tokens).length} user tokens`);
      return true;
    } catch (error) {
      logger.error(`[AuthPersistence] Error saving user tokens:`, error);
      return false;
    }
  }

  /**
   * Load NSFW verifications from disk
   * @returns {Promise<Object>} The verifications object
   */
  async loadNsfwVerifications() {
    try {
      await this.ensureDataDir();

      try {
        const data = await fs.readFile(this.nsfwVerifiedFile, 'utf8');
        const verifications = JSON.parse(data);
        logger.info(
          `[AuthPersistence] Loaded ${Object.keys(verifications).length} NSFW verification records`
        );
        return verifications;
      } catch (readError) {
        if (readError.code === 'ENOENT') {
          // File doesn't exist yet
          logger.info(`[AuthPersistence] No NSFW verification file found, returning empty object`);
          return {};
        }
        throw readError;
      }
    } catch (error) {
      logger.error(`[AuthPersistence] Error loading NSFW verifications:`, error);
      return {};
    }
  }

  /**
   * Save NSFW verifications to disk
   * @param {Object} verifications - The verifications object to save
   * @returns {Promise<boolean>} Whether save was successful
   */
  async saveNsfwVerifications(verifications) {
    try {
      await this.ensureDataDir();
      await fs.writeFile(this.nsfwVerifiedFile, JSON.stringify(verifications, null, 2));
      logger.info(
        `[AuthPersistence] Saved ${Object.keys(verifications).length} NSFW verification records`
      );
      return true;
    } catch (error) {
      logger.error(`[AuthPersistence] Error saving NSFW verifications:`, error);
      return false;
    }
  }

  /**
   * Create a backup of authentication data
   * @returns {Promise<boolean>} Whether backup was successful
   */
  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const backupDir = path.join(this.dataDir, 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      // Backup tokens
      try {
        const tokensData = await fs.readFile(this.authTokensFile, 'utf8');
        const tokensBackupFile = path.join(backupDir, `auth_tokens_${timestamp}.json`);
        await fs.writeFile(tokensBackupFile, tokensData);
        logger.info(`[AuthPersistence] Created tokens backup: ${tokensBackupFile}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error(`[AuthPersistence] Failed to backup tokens:`, error);
        }
      }

      // Backup NSFW verifications
      try {
        const nsfwData = await fs.readFile(this.nsfwVerifiedFile, 'utf8');
        const nsfwBackupFile = path.join(backupDir, `nsfw_verified_${timestamp}.json`);
        await fs.writeFile(nsfwBackupFile, nsfwData);
        logger.info(`[AuthPersistence] Created NSFW verifications backup: ${nsfwBackupFile}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error(`[AuthPersistence] Failed to backup NSFW verifications:`, error);
        }
      }

      return true;
    } catch (error) {
      logger.error(`[AuthPersistence] Error creating backup:`, error);
      return false;
    }
  }

  /**
   * Get file statistics
   * @returns {Promise<Object>} File statistics
   */
  async getFileStats() {
    const stats = {
      dataDir: this.dataDir,
      files: {},
    };

    try {
      const tokenStats = await fs.stat(this.authTokensFile);
      stats.files.authTokens = {
        exists: true,
        size: tokenStats.size,
        modified: tokenStats.mtime,
      };
    } catch (_error) {
      stats.files.authTokens = { exists: false };
    }

    try {
      const nsfwStats = await fs.stat(this.nsfwVerifiedFile);
      stats.files.nsfwVerified = {
        exists: true,
        size: nsfwStats.size,
        modified: nsfwStats.mtime,
      };
    } catch (_error) {
      stats.files.nsfwVerified = { exists: false };
    }

    return stats;
  }

  /**
   * Delete all authentication data (use with caution!)
   * @param {boolean} confirm - Must be true to proceed
   * @returns {Promise<boolean>} Whether deletion was successful
   */
  async deleteAllData(confirm = false) {
    if (!confirm) {
      logger.warn(`[AuthPersistence] deleteAllData called without confirmation`);
      return false;
    }

    try {
      // Create backup first
      await this.createBackup();

      // Delete files
      try {
        await fs.unlink(this.authTokensFile);
        logger.info(`[AuthPersistence] Deleted auth tokens file`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      try {
        await fs.unlink(this.nsfwVerifiedFile);
        logger.info(`[AuthPersistence] Deleted NSFW verifications file`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      return true;
    } catch (error) {
      logger.error(`[AuthPersistence] Error deleting data:`, error);
      return false;
    }
  }
}

module.exports = AuthPersistence;
