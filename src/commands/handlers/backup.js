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
  usage: 'backup [personality-name] | backup --all | backup --set-cookie <cookie>',
  aliases: [],
  permissions: [PermissionFlagsBits.Administrator],
};

// Configuration
const getApiBaseUrl = () =>
  process.env.SERVICE_WEBSITE ? `${process.env.SERVICE_WEBSITE}/api` : null;
const PROFILE_INFO_PRIVATE_PATH = process.env.PROFILE_INFO_PRIVATE_PATH;
const DELAY_BETWEEN_REQUESTS = 1000; // 1 second between requests to be respectful

// Session storage - in production, this should be encrypted and stored securely
const userSessions = new Map();

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
  return ms => new Promise(resolve => scheduler(resolve, ms));
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
  } catch (_error) {
    // eslint-disable-line no-unused-vars
    // No existing metadata
    return {
      lastBackup: null,
      lastMemoryTimestamp: null,
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
 * Load existing memories from file
 */
async function loadMemories(personalityName) {
  const memoryPath = path.join(getBackupDir(), personalityName, `${personalityName}_memories.json`);
  try {
    const data = await fs.readFile(memoryPath, 'utf8');
    return JSON.parse(data);
  } catch (_error) {
    // eslint-disable-line no-unused-vars
    // No existing memories
    return [];
  }
}

/**
 * Save all memories to a single file
 */
async function saveMemories(personalityName, memories) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });

  const memoryPath = path.join(personalityDir, `${personalityName}_memories.json`);
  await fs.writeFile(memoryPath, JSON.stringify(memories, null, 2));
  logger.info(`[Backup] Saved ${memories.length} memories for ${personalityName}`);
}

/**
 * Backup client for making API requests
 */
class BackupClient {
  constructor(options = {}) {
    this.scheduler = options.scheduler || (globalThis.setTimeout || setTimeout);
    this.clearScheduler = options.clearScheduler || (globalThis.clearTimeout || clearTimeout);
    this.timeout = options.timeout || 30000;
    this.delayFn = options.delayFn || (ms => new Promise(resolve => this.scheduler(resolve, ms)));
  }

  async makeAuthenticatedRequest(url, authData) {
    const controller = new AbortController();
    const timeoutId = this.scheduler(() => controller.abort(), this.timeout);

    try {
      const headers = {
        'User-Agent': 'Tzurot Discord Bot Backup/1.0',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      // If we have a session cookie, use it
      if (authData.cookie) {
        headers['Cookie'] = authData.cookie;
        logger.debug(`[Backup] Using session cookie for authentication`);
      } else if (authData.token) {
        // Otherwise fall back to token auth
        headers['X-App-ID'] = auth.APP_ID;
        headers['X-User-Auth'] = authData.token;
        logger.debug(`[Backup] Using token authentication`);
      }

      const response = await nodeFetch(url, {
        headers,
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
async function fetchPersonalityProfile(personalityName, authData) {
  const url = `${getApiBaseUrl()}/${PROFILE_INFO_PRIVATE_PATH}/${personalityName}`;
  logger.info(`[Backup] Fetching profile from: ${url}`);
  return await getBackupClient().makeAuthenticatedRequest(url, authData);
}

/**
 * Fetch all memories and return them in chronological order
 */
async function fetchAllMemories(personalityId, personalityName, authData) {
  logger.info(`[Backup] Fetching all memories for ${personalityName}...`);

  const allMemories = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${getApiBaseUrl()}/memory/${personalityId}?page=${page}`;
    logger.info(`[Backup] Fetching memory page ${page}...`);
    const response = await getBackupClient().makeAuthenticatedRequest(url, authData);

    // The API returns memories in reverse chronological order (newest first)
    const memories = response.items || [];

    if (memories.length > 0) {
      // Add to beginning to maintain reverse order temporarily
      allMemories.unshift(...memories);
    }

    // Check pagination
    const pagination = response.pagination || response.meta?.pagination;
    if (pagination) {
      totalPages = pagination.total_pages || pagination.totalPages || 1;
    }

    if (page >= totalPages) {
      break;
    }

    page++;
    await getDelayFn()(DELAY_BETWEEN_REQUESTS);
  }

  // Sort memories by created_at timestamp (oldest first)
  allMemories.sort((a, b) => {
    // Handle both timestamp formats: Unix timestamp (number) and ISO string
    const timeA =
      typeof a.created_at === 'number'
        ? a.created_at
        : new Date(a.created_at || a.timestamp || 0).getTime() / 1000;
    const timeB =
      typeof b.created_at === 'number'
        ? b.created_at
        : new Date(b.created_at || b.timestamp || 0).getTime() / 1000;
    return timeA - timeB;
  });

  logger.info(`[Backup] Fetched ${allMemories.length} total memories`);
  return allMemories;
}

/**
 * Sync memories intelligently - only fetch new ones
 */
async function syncMemories(personalityId, personalityName, authData, metadata) {
  logger.info(`[Backup] Syncing memories for ${personalityName}...`);

  // Load existing memories
  const existingMemories = await loadMemories(personalityName);
  const existingMemoryIds = new Set(existingMemories.map(m => m.id));

  // If we have a last sync timestamp, we can optimize by only fetching newer memories
  // For now, we'll fetch all and filter
  const allMemories = await fetchAllMemories(personalityId, personalityName, authData);

  // Find new memories (those not in our existing set)
  const newMemories = allMemories.filter(memory => !existingMemoryIds.has(memory.id));

  if (newMemories.length > 0) {
    // Merge with existing memories (maintaining chronological order)
    const updatedMemories = [...existingMemories, ...newMemories];

    // Save the updated memory list
    await saveMemories(personalityName, updatedMemories);

    // Update metadata
    metadata.totalMemories = updatedMemories.length;
    if (updatedMemories.length > 0) {
      // Store the timestamp of the most recent memory for future syncs
      const mostRecentMemory = updatedMemories[updatedMemories.length - 1];
      // Store as Unix timestamp for consistency
      const timestamp =
        typeof mostRecentMemory.created_at === 'number'
          ? mostRecentMemory.created_at
          : new Date(mostRecentMemory.created_at || mostRecentMemory.timestamp || 0).getTime() /
            1000;
      metadata.lastMemoryTimestamp = timestamp;
    }

    logger.info(
      `[Backup] Added ${newMemories.length} new memories (total: ${updatedMemories.length})`
    );
    return { hasNewMemories: true, newMemoryCount: newMemories.length };
  } else {
    logger.info(`[Backup] No new memories found`);
    return { hasNewMemories: false, newMemoryCount: 0 };
  }
}

/**
 * Backup a single personality
 */
async function backupPersonality(personalityName, authData, directSend) {
  try {
    await directSend(`🔄 Starting backup for **${personalityName}**...`);

    // Load existing metadata
    const metadata = await loadBackupMetadata(personalityName);

    // Fetch profile data
    const profile = await fetchPersonalityProfile(personalityName, authData);
    await savePersonalityProfile(personalityName, profile);

    // Fetch memories if personality has an ID
    if (profile.id) {
      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const { newMemoryCount } = await syncMemories(
        profile.id,
        personalityName,
        authData,
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
async function handleBulkBackup(authData, directSend) {
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
    await backupPersonality(personalityName, authData, directSend);
    successCount++;

    // Delay between personalities
    if (successCount < ownerPersonalities.length) {
      await getDelayFn()(DELAY_BETWEEN_REQUESTS * 2);
    }
  }

  await directSend(`\n✅ Bulk backup complete! Backed up ${successCount} personalities.`);
}

/**
 * Handle setting session cookie
 */
async function handleSetCookie(message, args, directSend) {
  if (args.length < 1) {
    return await directSend(
      '❌ Please provide your session cookie.\n\n' +
        '**How to get your session cookie:**\n' +
        '1. Open the service website in your browser and log in\n' +
        '2. Open Developer Tools (F12)\n' +
        '3. Go to Application/Storage → Cookies\n' +
        '4. Find the `appSession` cookie\n' +
        '5. Copy its value (the long string)\n' +
        '6. Use: `' +
        botPrefix +
        ' backup --set-cookie <cookie-value>`\n\n' +
        '⚠️ **Security Notice:** Only use this in DMs for security!'
    );
  }

  // For security, only accept cookies in DMs
  if (!message.channel.isDMBased()) {
    try {
      await message.delete();
    } catch (_error) {
      // eslint-disable-line no-unused-vars
      // Ignore delete errors
    }
    return await directSend(
      '❌ For security, please set your session cookie via DM, not in a public channel.'
    );
  }

  const cookieValue = args.join(' ').trim();

  // Store the session cookie
  userSessions.set(message.author.id, {
    cookie: `appSession=${cookieValue}`,
    setAt: Date.now(),
  });

  return await directSend(
    '✅ Session cookie saved! You can now use the backup command.\n\n' +
      '⚠️ **Note:** Session cookies expire. You may need to update it periodically.'
  );
}

/**
 * Execute the backup command
 */
async function execute(message, args) {
  const directSend = validator.createDirectSend(message);

  try {
    // Check if API URL is configured
    if (!getApiBaseUrl()) {
      return await directSend(
        '❌ Backup API URL not configured. Please set SERVICE_WEBSITE in environment.'
      );
    }

    await ensureBackupDir();

    // Check for --set-cookie flag
    if (args[0] === '--set-cookie') {
      return await handleSetCookie(message, args.slice(1), directSend);
    }

    // Get authentication data - prefer session cookie, fallback to token
    const authData = {};

    // Check for stored session
    const userSession = userSessions.get(message.author.id);
    if (userSession) {
      authData.cookie = userSession.cookie;
      logger.info(`[Backup] Using stored session cookie for user ${message.author.id}`);
    } else {
      // Fall back to token auth
      const authManager = auth.getAuthManager();
      if (!authManager) {
        return await directSend('❌ Authentication system not available.');
      }

      const userAuth = authManager.getUserToken(message.author.id);
      if (!userAuth) {
        return await directSend(
          '❌ No authentication found. Either:\n' +
            '1. Authenticate with: `' +
            botPrefix +
            ' auth <token>`\n' +
            '2. Set browser session: `' +
            botPrefix +
            ' backup --set-cookie <cookie>`'
        );
      }
      authData.token = userAuth;
    }

    // Parse arguments
    if (args.length === 0) {
      return await directSend(
        `Usage: \`${botPrefix} backup <personality-name>\` or \`${botPrefix} backup --all\`\n\n` +
          `Examples:\n` +
          `• \`${botPrefix} backup <personality-name>\` - Backup a single personality\n` +
          `• \`${botPrefix} backup --all\` - Backup all owner personalities\n` +
          `• \`${botPrefix} backup --set-cookie <cookie>\` - Set browser session cookie`
      );
    }

    if (args[0] === '--all') {
      await handleBulkBackup(authData, directSend);
    } else {
      // Backup single personality
      const personalityName = args[0].toLowerCase();
      await backupPersonality(personalityName, authData, directSend);
    }

    // Return true to indicate successful command execution
    return true;
  } catch (error) {
    logger.error(`[Backup] Command error: ${error.message}`, error);
    return await directSend(`❌ An error occurred during backup: ${error.message}`);
  }
}

module.exports = {
  meta,
  execute,
  BackupClient, // Exported for testing
  // Export internal functions for testing
  loadBackupMetadata,
  saveBackupMetadata,
  savePersonalityProfile,
  loadMemories,
  saveMemories,
  fetchPersonalityProfile,
  fetchAllMemories,
  syncMemories,
  backupPersonality,
  handleBulkBackup,
  handleSetCookie,
  userSessions, // Export for testing
  getDelayFn, // Export for testing
  // Allow injection of delay function for testing
  _setDelayFunction: fn => {
    if (backupClient) {
      backupClient.delayFn = fn;
    }
  },
  _resetDelayFunction: () => {
    if (backupClient) {
      backupClient.delayFn = ms => new Promise(resolve => backupClient.scheduler(resolve, ms));
    }
  },
  // Reset backup client for testing
  _resetBackupClient: () => {
    backupClient = null;
  },
};
