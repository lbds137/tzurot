/**
 * Data Storage Module
 *
 * @module dataStorage
 * @description
 * Provides functions for managing persistent data storage for the bot.
 * Data is stored as JSON files in the /data directory.
 *
 * This module handles:
 * - Creating the data directory if it doesn't exist
 * - Serializing and deserializing JSON data
 * - Writing data to the filesystem
 * - Loading data from the filesystem
 * - Error handling for file operations
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

/**
 * Get the appropriate data directory path for the current environment
 * @returns {string} The data directory path
 */
function getDataDirectory() {
  return process.env.RAILWAY_ENVIRONMENT
    ? '/app/data' // Use Railway persistent volume when deployed
    : path.join(__dirname, '..', 'data'); // Use local data directory in development
}

/**
 * Path to the data storage directory
 * @constant {string}
 */
const DATA_DIR = getDataDirectory();

/**
 * Initialize the data storage
 *
 * @async
 * @function initStorage
 * @returns {Promise<void>} Resolves when initialization is complete
 * @throws {Error} If the data directory cannot be created
 *
 * @description
 * Creates the data directory if it doesn't exist yet.
 * This should be called when the bot starts up to ensure
 * the storage is ready before trying to save or load data.
 */
async function initStorage() {
  try {
    // Create the data directory if it doesn't exist
    await fs.mkdir(DATA_DIR, { recursive: true });

    // Check if we're on Railway with a persistent volume
    if (process.env.RAILWAY_ENVIRONMENT) {
      const stats = await fs.stat(DATA_DIR);
      logger.info(`[DataStorage] Railway environment detected - Data directory: ${DATA_DIR}`);
      logger.info(
        `[DataStorage] Directory exists: ${stats.isDirectory()}, Path: ${path.resolve(DATA_DIR)}`
      );

      // Check if any data files exist (indicating persistence is working)
      try {
        const files = await fs.readdir(DATA_DIR);
        logger.info(
          `[DataStorage] Found ${files.length} files in data directory: ${files.join(', ')}`
        );
      } catch (readError) {
        logger.info(
          '[DataStorage] No existing files in data directory (fresh volume or first run)'
        );
      }
    }

    logger.info('[DataStorage] Data storage initialized');
  } catch (error) {
    logger.error(`[DataStorage] Error initializing data storage: ${error.message}`);
    throw error;
  }
}

/**
 * Save data to a file
 *
 * @async
 * @function saveData
 * @param {string} filename - The name of the file (without .json extension)
 * @param {Object} data - The data to save (will be converted to JSON)
 * @returns {Promise<boolean>} Returns true when the data is saved successfully
 * @throws {Error} If the data cannot be saved
 *
 * @description
 * Serializes the provided data object to JSON and writes it to a file
 * in the data directory. The .json extension is automatically added to the filename.
 * Data is pretty-printed with 2-space indentation for better readability.
 */
async function saveData(filename, data) {
  try {
    const filePath = path.join(DATA_DIR, `${filename}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    logger.error(`[DataStorage] Error saving data to ${filename}: ${error.message}`);
    throw error;
  }
}

/**
 * Load data from a file
 *
 * @async
 * @function loadData
 * @param {string} filename - The name of the file (without .json extension)
 * @returns {Promise<Object|null>} The loaded data or null if the file doesn't exist
 * @throws {Error} If the file exists but cannot be read or parsed
 *
 * @description
 * Loads and parses JSON data from a file in the data directory.
 * The .json extension is automatically added to the filename.
 * If the file doesn't exist, null is returned instead of throwing an error,
 * allowing for easy handling of first-run scenarios.
 * However, other errors (like permission issues or invalid JSON) will be thrown.
 */
async function loadData(filename) {
  try {
    const filePath = path.join(DATA_DIR, `${filename}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return null
      return null;
    }
    logger.error(`[DataStorage] Error loading data from ${filename}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  initStorage,
  saveData,
  loadData,
  getDataDirectory,
};
