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
