/**
 * ZIP Archive Service
 * Creates ZIP archives from personality backup data
 */

const JSZip = require('jszip');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

class ZipArchiveService {
  constructor(dependencies = {}) {
    this.fs = dependencies.fs || fs;
    this.JSZip = dependencies.JSZip || JSZip;
  }

  /**
   * Create a ZIP archive from personality data directory
   * @param {string} personalityName - Name of the personality
   * @param {string} dataPath - Path to the personality data directory
   * @returns {Promise<Buffer>} ZIP file buffer
   */
  async createPersonalityArchive(personalityName, dataPath) {
    try {
      const zip = new this.JSZip();

      // Add all files from the personality directory
      await this._addDirectoryToZip(zip, dataPath, personalityName);

      // Generate the ZIP file
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9, // Maximum compression
        },
      });

      logger.info(
        `[ZipArchiveService] Created ZIP archive for ${personalityName} (${this.formatBytes(zipBuffer.length)})`
      );
      return zipBuffer;
    } catch (error) {
      logger.error(`[ZipArchiveService] Failed to create archive for ${personalityName}:`, error);
      throw new Error(`Failed to create ZIP archive: ${error.message}`);
    }
  }

  /**
   * Create a ZIP archive from in-memory personality data (for non-persistent backups)
   * @param {string} personalityName - Name of the personality
   * @param {Object} personalityData - In-memory personality data object
   * @param {Object} jobResults - Backup job results to determine what data was included
   * @returns {Promise<Buffer>} ZIP file buffer
   */
  async createPersonalityArchiveFromMemory(personalityName, personalityData, jobResults) {
    try {
      const zip = new this.JSZip();
      const baseFolder = zip.folder(personalityName);

      // DEBUGGING: Log exactly what we received
      logger.debug(`[ZipArchiveService] Creating archive for ${personalityName}`);
      logger.debug(
        `[ZipArchiveService] personalityData.memories: ${personalityData.memories ? personalityData.memories.length : 'undefined'}`
      );
      logger.debug(
        `[ZipArchiveService] personalityData.userPersonalization: ${personalityData.userPersonalization ? Object.keys(personalityData.userPersonalization).length : 'undefined'} keys`
      );
      logger.debug(
        `[ZipArchiveService] personalityData.chatHistory: ${personalityData.chatHistory ? personalityData.chatHistory.length : 'undefined'}`
      );
      logger.debug(
        `[ZipArchiveService] jobResults.memories: ${JSON.stringify(jobResults.memories)}`
      );
      logger.debug(
        `[ZipArchiveService] jobResults.userPersonalization: ${JSON.stringify(jobResults.userPersonalization)}`
      );
      logger.debug(
        `[ZipArchiveService] jobResults.chatHistory: ${JSON.stringify(jobResults.chatHistory)}`
      );

      // Add metadata
      if (personalityData.metadata) {
        baseFolder.file('metadata.json', JSON.stringify(personalityData.metadata, null, 2));
      }

      // Add profile only if it wasn't skipped (i.e., user is owner)
      if (personalityData.profile && jobResults.profile && !jobResults.profile.skipped) {
        baseFolder.file('profile.json', JSON.stringify(personalityData.profile, null, 2));
      }

      // Add memories if available
      if (personalityData.memories && personalityData.memories.length > 0 && jobResults.memories) {
        baseFolder.file('memories.json', JSON.stringify(personalityData.memories, null, 2));
        logger.debug(
          `[ZipArchiveService] Added memories.json with ${personalityData.memories.length} memories`
        );
      } else if (jobResults.memories && jobResults.memories.totalCount > 0) {
        // Log potential mismatch between job results and actual data
        logger.warn(
          `[ZipArchiveService] Job results indicate ${jobResults.memories.totalCount} memories but personalityData.memories has ${personalityData.memories ? personalityData.memories.length : 'undefined'} memories`
        );
      }

      // Add knowledge only if it wasn't skipped (i.e., user is owner)
      if (
        personalityData.knowledge &&
        personalityData.knowledge.length > 0 &&
        jobResults.knowledge &&
        !jobResults.knowledge.skipped
      ) {
        baseFolder.file('knowledge.json', JSON.stringify(personalityData.knowledge, null, 2));
      }

      // Add training only if it wasn't skipped (i.e., user is owner)
      if (
        personalityData.training &&
        personalityData.training.length > 0 &&
        jobResults.training &&
        !jobResults.training.skipped
      ) {
        baseFolder.file('training.json', JSON.stringify(personalityData.training, null, 2));
      }

      // Add user personalization if available
      if (
        personalityData.userPersonalization &&
        Object.keys(personalityData.userPersonalization).length > 0 &&
        jobResults.userPersonalization
      ) {
        baseFolder.file(
          'user_personalization.json',
          JSON.stringify(personalityData.userPersonalization, null, 2)
        );
        logger.debug(
          `[ZipArchiveService] Added user_personalization.json with ${Object.keys(personalityData.userPersonalization).length} keys`
        );
      } else if (jobResults.userPersonalization && jobResults.userPersonalization.updated) {
        // Log potential mismatch between job results and actual data
        logger.warn(
          `[ZipArchiveService] Job results indicate user personalization was updated but personalityData.userPersonalization has ${personalityData.userPersonalization ? Object.keys(personalityData.userPersonalization).length : 'undefined'} keys`
        );
      }

      // Add chat history if available
      if (
        personalityData.chatHistory &&
        personalityData.chatHistory.length > 0 &&
        jobResults.chatHistory
      ) {
        baseFolder.file('chat_history.json', JSON.stringify(personalityData.chatHistory, null, 2));
        logger.debug(
          `[ZipArchiveService] Added chat_history.json with ${personalityData.chatHistory.length} messages`
        );
      } else if (jobResults.chatHistory && jobResults.chatHistory.totalMessages > 0) {
        // Log potential mismatch between job results and actual data
        logger.warn(
          `[ZipArchiveService] Job results indicate ${jobResults.chatHistory.totalMessages} chat messages but personalityData.chatHistory has ${personalityData.chatHistory ? personalityData.chatHistory.length : 'undefined'} messages`
        );
      }

      // DEBUGGING: Log ZIP contents before generation
      logger.debug(`[ZipArchiveService] ZIP contents before generation:`);
      Object.keys(zip.files).forEach(filename => {
        const file = zip.files[filename];
        logger.debug(`[ZipArchiveService] - ${filename} (dir: ${file.dir})`);
      });

      // Generate the ZIP file
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9, // Maximum compression
        },
      });

      // DEBUGGING: Verify ZIP contents after generation
      logger.debug(`[ZipArchiveService] Generated ZIP buffer size: ${zipBuffer.length} bytes`);

      // Quick verification by reloading the ZIP
      const JSZip = require('jszip');
      const verifyZip = new JSZip();
      try {
        const loadedZip = await verifyZip.loadAsync(zipBuffer);
        logger.debug(`[ZipArchiveService] Verification - files in generated ZIP:`);
        Object.keys(loadedZip.files).forEach(filename => {
          const file = loadedZip.files[filename];
          logger.debug(`[ZipArchiveService] - ${filename} (dir: ${file.dir})`);
        });
      } catch (verifyError) {
        logger.error(`[ZipArchiveService] ZIP verification failed: ${verifyError.message}`);
      }

      logger.info(
        `[ZipArchiveService] Created in-memory ZIP archive for ${personalityName} (${this.formatBytes(zipBuffer.length)})`
      );
      return zipBuffer;
    } catch (error) {
      logger.error(
        `[ZipArchiveService] Failed to create in-memory archive for ${personalityName}:`,
        error
      );
      throw new Error(`Failed to create in-memory ZIP archive: ${error.message}`);
    }
  }

  /**
   * Create a bulk archive containing multiple personalities
   * @param {Array<{name: string, path: string}>} personalities - Array of personality data
   * @returns {Promise<Buffer>} ZIP file buffer
   */
  async createBulkArchive(personalities) {
    try {
      const zip = new this.JSZip();

      // Add each personality to the ZIP
      for (const { name, path: personalityPath } of personalities) {
        await this._addDirectoryToZip(zip, personalityPath, name);
      }

      // Generate the ZIP file
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9,
        },
      });

      logger.info(
        `[ZipArchiveService] Created bulk ZIP archive with ${personalities.length} personalities (${this.formatBytes(zipBuffer.length)})`
      );
      return zipBuffer;
    } catch (error) {
      logger.error('[ZipArchiveService] Failed to create bulk archive:', error);
      throw new Error(`Failed to create bulk ZIP archive: ${error.message}`);
    }
  }

  /**
   * Create a bulk archive from in-memory backup job data
   * @param {Array<BackupJob>} jobs - Array of completed backup jobs
   * @returns {Promise<Buffer>} ZIP file buffer
   */
  async createBulkArchiveFromMemory(jobs) {
    try {
      const zip = new this.JSZip();

      // Add each personality to the ZIP
      for (const job of jobs) {
        if (job.personalityData && job.results) {
          const personalityFolder = zip.folder(job.personalityName);

          // Add metadata
          if (job.personalityData.metadata) {
            personalityFolder.file(
              'metadata.json',
              JSON.stringify(job.personalityData.metadata, null, 2)
            );
          }

          // Add profile only if it wasn't skipped (i.e., user is owner)
          if (job.personalityData.profile && job.results.profile && !job.results.profile.skipped) {
            personalityFolder.file(
              'profile.json',
              JSON.stringify(job.personalityData.profile, null, 2)
            );
          }

          // Add memories if available
          if (
            job.personalityData.memories &&
            job.personalityData.memories.length > 0 &&
            job.results.memories
          ) {
            personalityFolder.file(
              'memories.json',
              JSON.stringify(job.personalityData.memories, null, 2)
            );
          }

          // Add knowledge only if it wasn't skipped (i.e., user is owner)
          if (
            job.personalityData.knowledge &&
            job.personalityData.knowledge.length > 0 &&
            job.results.knowledge &&
            !job.results.knowledge.skipped
          ) {
            personalityFolder.file(
              'knowledge.json',
              JSON.stringify(job.personalityData.knowledge, null, 2)
            );
          }

          // Add training only if it wasn't skipped (i.e., user is owner)
          if (
            job.personalityData.training &&
            job.personalityData.training.length > 0 &&
            job.results.training &&
            !job.results.training.skipped
          ) {
            personalityFolder.file(
              'training.json',
              JSON.stringify(job.personalityData.training, null, 2)
            );
          }

          // Add user personalization if available
          if (
            job.personalityData.userPersonalization &&
            Object.keys(job.personalityData.userPersonalization).length > 0 &&
            job.results.userPersonalization
          ) {
            personalityFolder.file(
              'user_personalization.json',
              JSON.stringify(job.personalityData.userPersonalization, null, 2)
            );
          }

          // Add chat history if available
          if (
            job.personalityData.chatHistory &&
            job.personalityData.chatHistory.length > 0 &&
            job.results.chatHistory
          ) {
            personalityFolder.file(
              'chat_history.json',
              JSON.stringify(job.personalityData.chatHistory, null, 2)
            );
          }
        }
      }

      // Generate the ZIP file
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 9,
        },
      });

      logger.info(
        `[ZipArchiveService] Created bulk in-memory ZIP archive with ${jobs.length} personalities (${this.formatBytes(zipBuffer.length)})`
      );
      return zipBuffer;
    } catch (error) {
      logger.error('[ZipArchiveService] Failed to create bulk in-memory archive:', error);
      throw new Error(`Failed to create bulk in-memory ZIP archive: ${error.message}`);
    }
  }

  /**
   * Add a directory and all its contents to a ZIP archive
   * @private
   */
  async _addDirectoryToZip(zip, dirPath, zipPath = '') {
    try {
      const items = await this.fs.readdir(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const zipItemPath = zipPath ? `${zipPath}/${item}` : item;

        const stat = await this.fs.stat(itemPath);

        if (stat.isDirectory()) {
          // Recursively add subdirectories
          await this._addDirectoryToZip(zip, itemPath, zipItemPath);
        } else {
          // Add file to ZIP
          const fileContent = await this.fs.readFile(itemPath);
          zip.file(zipItemPath, fileContent);
          logger.debug(`[ZipArchiveService] Added file: ${zipItemPath}`);
        }
      }
    } catch (error) {
      logger.error(`[ZipArchiveService] Error adding directory ${dirPath} to ZIP:`, error);
      throw error;
    }
  }

  /**
   * Format bytes to human-readable string
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Check if a file size is within Discord's limits
   * @param {number} sizeInBytes - File size in bytes
   * @returns {boolean} True if within limits
   */
  isWithinDiscordLimits(sizeInBytes) {
    // Discord's file upload limit is 8MB for regular servers, 50MB for boosted
    // We'll use 8MB as the safe limit
    const DISCORD_FILE_LIMIT = 8 * 1024 * 1024; // 8MB in bytes
    return sizeInBytes <= DISCORD_FILE_LIMIT;
  }
}

module.exports = {
  ZipArchiveService,
};
