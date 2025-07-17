/**
 * Migration script to move blacklist data from auth domain to global blacklist
 * @module migrations/migrateBlacklistData
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../logger');

/**
 * Migrate blacklist data from auth.json to blacklist.json
 * @param {string} dataPath - Path to data directory
 * @returns {Promise<void>}
 */
async function migrateBlacklistData(dataPath = './data') {
  logger.info('[BlacklistMigration] Starting blacklist data migration...');
  
  try {
    // Read authentication data
    const authPath = path.join(dataPath, 'auth.json');
    const authData = JSON.parse(await fs.readFile(authPath, 'utf8'));
    
    // Prepare blacklist data
    const blacklistData = {};
    let migratedCount = 0;
    
    // Iterate through auth data to find blacklisted users
    for (const [userId, userData] of Object.entries(authData)) {
      if (userData.blacklisted) {
        blacklistData[userId] = {
          userId: userId,
          reason: userData.blacklistReason || 'Migrated from auth system',
          blacklistedBy: 'system', // We don't have this info in old system
          blacklistedAt: new Date().toISOString() // Use current time as we don't have original
        };
        migratedCount++;
        
        logger.info(`[BlacklistMigration] Migrating blacklisted user: ${userId}`);
      }
    }
    
    // Write blacklist data
    const blacklistPath = path.join(dataPath, 'blacklist.json');
    await fs.writeFile(blacklistPath, JSON.stringify(blacklistData, null, 2), 'utf8');
    
    logger.info(`[BlacklistMigration] Successfully migrated ${migratedCount} blacklisted users`);
    
    // Clean up auth data (remove blacklist fields)
    let cleanedCount = 0;
    for (const [userId, userData] of Object.entries(authData)) {
      if ('blacklisted' in userData || 'blacklistReason' in userData) {
        delete userData.blacklisted;
        delete userData.blacklistReason;
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      // Backup original auth file
      const backupPath = path.join(dataPath, 'auth.json.pre-blacklist-migration');
      await fs.copyFile(authPath, backupPath);
      logger.info(`[BlacklistMigration] Created backup at: ${backupPath}`);
      
      // Write cleaned auth data
      await fs.writeFile(authPath, JSON.stringify(authData, null, 2), 'utf8');
      logger.info(`[BlacklistMigration] Cleaned blacklist fields from ${cleanedCount} auth records`);
    }
    
    logger.info('[BlacklistMigration] Migration completed successfully');
    
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('[BlacklistMigration] No auth.json found, skipping migration');
    } else {
      logger.error('[BlacklistMigration] Migration failed:', error);
      throw error;
    }
  }
}

// Export for use in ApplicationBootstrap or as standalone script
module.exports = { migrateBlacklistData };

// Allow running as standalone script
if (require.main === module) {
  migrateBlacklistData()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}