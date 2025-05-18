const fs = require('fs').promises;
const path = require('path');

// Define the data directory
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Initialize the data storage
 */
async function initStorage() {
  try {
    // Create the data directory if it doesn't exist
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('Data storage initialized');
  } catch (error) {
    console.error('Error initializing data storage:', error);
    throw error;
  }
}

/**
 * Save data to a file
 * @param {string} filename - The name of the file
 * @param {Object} data - The data to save
 */
async function saveData(filename, data) {
  try {
    const filePath = path.join(DATA_DIR, `${filename}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error saving data to ${filename}:`, error);
    throw error;
  }
}

/**
 * Load data from a file
 * @param {string} filename - The name of the file
 * @returns {Object|null} The loaded data or null if the file doesn't exist
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
    console.error(`Error loading data from ${filename}:`, error);
    throw error;
  }
}

module.exports = {
  initStorage,
  saveData,
  loadData,
};
