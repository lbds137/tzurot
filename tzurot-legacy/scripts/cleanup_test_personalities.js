/**
 * Cleanup Test Personalities Script
 * 
 * This script removes test personalities from the production data
 * that were accidentally created during testing.
 */
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/logger');

// Path to personalities file
const DATA_DIR = path.join(__dirname, '..', 'data');
const PERSONALITIES_FILE = path.join(DATA_DIR, 'personalities.json');
const ALIASES_FILE = path.join(DATA_DIR, 'aliases.json');

async function cleanupTestPersonalities() {
  try {
    logger.info('Starting test personality cleanup...');
    
    // Load personalities
    logger.info('Loading personalities file...');
    const personalitiesContent = await fs.readFile(PERSONALITIES_FILE, 'utf8');
    const personalities = JSON.parse(personalitiesContent);
    
    // Count personalities before cleanup
    const originalCount = Object.keys(personalities).length;
    logger.info(`Found ${originalCount} personalities`);
    
    // Load aliases
    logger.info('Loading aliases file...');
    let aliases = {};
    try {
      const aliasesContent = await fs.readFile(ALIASES_FILE, 'utf8');
      aliases = JSON.parse(aliasesContent);
      logger.info(`Found ${Object.keys(aliases).length} aliases`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No aliases file found');
      } else {
        throw error;
      }
    }

    // Identify test personalities
    const testPersonalityNames = [];
    const testUserIds = ['test-user-id', 'user-123', 'user1', 'user2'];
    
    for (const [name, personality] of Object.entries(personalities)) {
      if (testUserIds.includes(personality.createdBy) || 
          name.startsWith('test-personality') || 
          name.includes('test-')) {
        testPersonalityNames.push(name);
        logger.info(`Found test personality: ${name} (created by ${personality.createdBy})`);
      }
    }
    
    // Create a backup of the original files
    await fs.copyFile(PERSONALITIES_FILE, `${PERSONALITIES_FILE}.backup`);
    logger.info(`Created backup at ${PERSONALITIES_FILE}.backup`);
    
    if (await fileExists(ALIASES_FILE)) {
      await fs.copyFile(ALIASES_FILE, `${ALIASES_FILE}.backup`);
      logger.info(`Created backup at ${ALIASES_FILE}.backup`);
    }
    
    // Remove test personalities
    for (const name of testPersonalityNames) {
      delete personalities[name];
    }
    
    // Remove any aliases that point to test personalities
    for (const [alias, targetName] of Object.entries(aliases)) {
      if (testPersonalityNames.includes(targetName)) {
        delete aliases[alias];
        logger.info(`Removed alias ${alias} pointing to test personality ${targetName}`);
      }
    }
    
    // Save updated personalities
    const newCount = Object.keys(personalities).length;
    logger.info(`Removed ${originalCount - newCount} test personalities`);
    await fs.writeFile(PERSONALITIES_FILE, JSON.stringify(personalities, null, 2));
    logger.info(`Saved cleaned personalities file with ${newCount} personalities`);
    
    // Save updated aliases
    await fs.writeFile(ALIASES_FILE, JSON.stringify(aliases, null, 2));
    logger.info(`Saved cleaned aliases file with ${Object.keys(aliases).length} aliases`);
    
    logger.info('Test personality cleanup completed successfully');
  } catch (error) {
    logger.error(`Error during cleanup: ${error.message}`);
    logger.error(error.stack);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Run the cleanup
cleanupTestPersonalities();