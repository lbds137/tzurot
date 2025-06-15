/**
 * Backup Command Handler
 * Pulls complete personality data from the AI service including memories
 * Supports both bulk backup of owner personalities and single personality backup
 */
const { PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const { botPrefix } = require('../../../config');
const { USER_CONFIG } = require('../../constants');
const auth = require('../../auth');
const nodeFetch = require('node-fetch');

/**
 * Command metadata
 */
const meta = {
  name: 'backup',
  description: 'Backup personality data and memories from the AI service',
  usage: 'backup [personality-name] | backup --all',
  aliases: [],
  permissions: [PermissionFlagsBits.Administrator],
};

// Configuration
const API_BASE_URL = 'https://shapes.inc/api';
const DELAY_BETWEEN_REQUESTS = 1000; // 1 second between requests to be respectful

// Lazy initialization to avoid path resolution at module load time
let BACKUP_DIR = null;
function getBackupDir() {
  if (!BACKUP_DIR) {
    BACKUP_DIR = path.join(__dirname, '..', '..', '..', 'data', 'personalities');
  }
  return BACKUP_DIR;
}

/**
 * Helper to delay between requests - injectable for testing
 */
function getDelayFn() {
  // Return the delay function - can be overridden for testing
  if (backupClient && backupClient.delayFn) {
    return backupClient.delayFn;
  }
  // Default implementation using injectable scheduler
  const scheduler = (backupClient && backupClient.scheduler) || setTimeout;
  return (ms) => new Promise(resolve => scheduler(resolve, ms));
}

/**
 * Ensure backup directory exists
 */
async function ensureBackupDir() {
  await fs.mkdir(getBackupDir(), { recursive: true });
}

/**
 * Load existing backup metadata to track what we've already saved
 */
async function loadBackupMetadata(personalityName) {
  const metadataPath = path.join(getBackupDir(), personalityName, '.backup-metadata.json');
  try {
    const data = await fs.readFile(metadataPath, 'utf8');
    return JSON.parse(data);
  } catch (_error) { // eslint-disable-line no-unused-vars
    // No existing metadata
    return {
      lastBackup: null,
      lastMemoryId: null,
      totalMemories: 0,
    };
  }
}

/**
 * Save backup metadata
 */
async function saveBackupMetadata(personalityName, metadata) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });
  
  const metadataPath = path.join(personalityDir, '.backup-metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
}

/**
 * Save personality profile data
 */
async function savePersonalityProfile(personalityName, profileData) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });
  
  const profilePath = path.join(personalityDir, `${personalityName}.json`);
  await fs.writeFile(profilePath, JSON.stringify(profileData, null, 2));
  logger.info(`[Backup] Saved profile for ${personalityName}`);
}

/**
 * Save memory data
 */
async function saveMemoryPage(personalityName, memories, pageNum) {
  const memoryDir = path.join(getBackupDir(), personalityName, 'memory');
  await fs.mkdir(memoryDir, { recursive: true });
  
  const memoryPath = path.join(memoryDir, `${personalityName}_memory_${pageNum}.json`);
  await fs.writeFile(memoryPath, JSON.stringify(memories, null, 2));
  logger.info(`[Backup] Saved memory page ${pageNum} for ${personalityName}`);
}

/**
 * Backup client for making API requests
 */
class BackupClient {
  constructor(options = {}) {
    this.scheduler = options.scheduler || setTimeout;
    this.clearScheduler = options.clearScheduler || clearTimeout;
    this.timeout = options.timeout || 30000;
    this.delayFn = options.delayFn || ((ms) => new Promise(resolve => this.scheduler(resolve, ms)));
  }

  async makeAuthenticatedRequest(url, userAuth) {
    const controller = new AbortController();
    const timeoutId = this.scheduler(() => controller.abort(), this.timeout);
    
    try {
      const response = await nodeFetch(url, {
        headers: {
          'X-User-Auth': userAuth,
          'User-Agent': 'Tzurot Discord Bot Backup/1.0',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      if (!response.ok) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      this.clearScheduler(timeoutId);
    }
  }
}

// Lazy initialization for BackupClient to avoid module-level side effects
let backupClient = null;

/**
 * Get or create the BackupClient instance
 */
function getBackupClient() {
  if (!backupClient) {
    backupClient = new BackupClient();
  }
  return backupClient;
}

/**
 * Fetch personality profile data
 */
async function fetchPersonalityProfile(personalityName, userAuth) {
  const url = `${API_BASE_URL}/shapes/username/${personalityName}`;
  return await getBackupClient().makeAuthenticatedRequest(url, userAuth);
}

/**
 * Process a single page of memories
 */
async function processMemoryPage(memories, stopAtMemoryId, seenMemoryIds) {
  const newMemories = [];
  let foundStopMemory = false;
  
  for (const memory of memories) {
    if (memory.id === stopAtMemoryId) {
      foundStopMemory = true;
      break;
    }
    
    if (!seenMemoryIds.has(memory.id)) {
      seenMemoryIds.add(memory.id);
      newMemories.push(memory);
    }
  }
  
  return { newMemories, foundStopMemory };
}

/**
 * Fetch memories with smart syncing
 */
async function fetchMemoriesSmartSync(personalityId, personalityName, userAuth, metadata) {
  logger.info(`[Backup] Fetching memories for ${personalityName}...`);
  
  let page = 1;
  let newMemoryCount = 0;
  const seenMemoryIds = new Set();
  const stopAtMemoryId = metadata.lastMemoryId;
  
  while (true) {
    const url = `${API_BASE_URL}/memory/${personalityId}?page=${page}`;
    const response = await getBackupClient().makeAuthenticatedRequest(url, userAuth);
    
    if (!response.memories || response.memories.length === 0) {
      break;
    }
    
    const { newMemories, foundStopMemory } = await processMemoryPage(
      response.memories,
      stopAtMemoryId,
      seenMemoryIds
    );
    
    // Save this page if it has new memories
    if (newMemories.length > 0) {
      await saveMemoryPage(personalityName, {
        ...response,
        memories: newMemories,
      }, page);
      newMemoryCount += newMemories.length;
    }
    
    // If we found our stop point, we're done
    if (foundStopMemory) {
      logger.info(`[Backup] Found previous sync point at page ${page}`);
      break;
    }
    
    // Check if there are more pages
    if (!response.pagination || page >= response.pagination.total_pages) {
      break;
    }
    
    page++;
    await getDelayFn()(DELAY_BETWEEN_REQUESTS);
  }
  
  // Update metadata with the most recent memory ID
  if (newMemoryCount > 0 && seenMemoryIds.size > 0) {
    const mostRecentMemoryId = Array.from(seenMemoryIds)[0];
    metadata.lastMemoryId = mostRecentMemoryId;
    metadata.totalMemories += newMemoryCount;
  }
  
  logger.info(`[Backup] Synced ${newMemoryCount} new memories for ${personalityName}`);
  return { hasNewMemories: newMemoryCount > 0, newMemoryCount };
}

/**
 * Backup a single personality
 */
async function backupPersonality(personalityName, userAuth, directSend) {
  try {
    await directSend(`🔄 Starting backup for **${personalityName}**...`);
    
    // Load existing metadata
    const metadata = await loadBackupMetadata(personalityName);
    
    // Fetch profile data
    const profile = await fetchPersonalityProfile(personalityName, userAuth);
    await savePersonalityProfile(personalityName, profile);
    
    // Fetch memories if personality has an ID
    if (profile.id) {
      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const { newMemoryCount } = await fetchMemoriesSmartSync(
        profile.id,
        personalityName,
        userAuth,
        metadata
      );
      
      // Update metadata
      metadata.lastBackup = new Date().toISOString();
      await saveBackupMetadata(personalityName, metadata);
      
      await directSend(
        `✅ Backup complete for **${personalityName}**\n` +
        `• Profile: Updated\n` +
        `• New memories: ${newMemoryCount}\n` +
        `• Total memories: ${metadata.totalMemories}`
      );
    } else {
      await directSend(`✅ Backup complete for **${personalityName}** (no memories found)`);
    }
    
  } catch (error) {
    logger.error(`[Backup] Error backing up ${personalityName}: ${error.message}`);
    await directSend(`❌ Failed to backup **${personalityName}**: ${error.message}`);
  }
}

/**
 * Handle bulk backup of owner personalities
 */
async function handleBulkBackup(userAuth, directSend) {
  const ownerPersonalities = USER_CONFIG.OWNER_PERSONALITIES_LIST.split(',')
    .map(p => p.trim())
    .filter(p => p);
  
  if (ownerPersonalities.length === 0) {
    return await directSend('❌ No owner personalities configured.');
  }
  
  await directSend(
    `📦 Starting bulk backup of ${ownerPersonalities.length} personalities...\n` +
    `This may take a few minutes.`
  );
  
  let successCount = 0;
  for (const personalityName of ownerPersonalities) {
    await backupPersonality(personalityName, userAuth, directSend);
    successCount++;
    
    // Delay between personalities
    if (successCount < ownerPersonalities.length) {
      await getDelayFn()(DELAY_BETWEEN_REQUESTS * 2);
    }
  }
  
  await directSend(`\n✅ Bulk backup complete! Backed up ${successCount} personalities.`);
}

/**
 * Execute the backup command
 */
async function execute(message, args) {
  const directSend = validator.createDirectSend(message);
  
  try {
    await ensureBackupDir();
    
    // Get user auth
    const authManager = auth.getAuthManager();
    if (!authManager) {
      return await directSend('❌ Authentication system not available.');
    }
    
    const userAuth = authManager.getUserToken(message.author.id);
    if (!userAuth) {
      return await directSend(
        '❌ You need to authenticate first. Use `' + botPrefix + ' auth <token>` to authenticate.'
      );
    }
    
    // Parse arguments
    if (args.length === 0) {
      return await directSend(
        `Usage: \`${botPrefix} backup <personality-name>\` or \`${botPrefix} backup --all\`\n\n` +
        `Examples:\n` +
        `• \`${botPrefix} backup lilith-tzel-shani\` - Backup a single personality\n` +
        `• \`${botPrefix} backup --all\` - Backup all owner personalities`
      );
    }
    
    if (args[0] === '--all') {
      await handleBulkBackup(userAuth, directSend);
    } else {
      // Backup single personality
      const personalityName = args[0].toLowerCase();
      await backupPersonality(personalityName, userAuth, directSend);
    }
    
  } catch (error) {
    logger.error(`[Backup] Command error: ${error.message}`, error);
    return await directSend(`❌ An error occurred during backup: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
  BackupClient, // Exported for testing
  // Allow injection of delay function for testing
  _setDelayFunction: (fn) => {
    if (backupClient) {
      backupClient.delayFn = fn;
    }
  },
  _resetDelayFunction: () => {
    if (backupClient) {
      backupClient.delayFn = (ms) => new Promise(resolve => backupClient.scheduler(resolve, ms));
    }
  },
  // Reset backup client for testing
  _resetBackupClient: () => {
    backupClient = null;
  },
};