/**
 * Backup Command Handler
 * Pulls complete personality data from the AI service including memories, knowledge, training, and user personalization
 * Supports both bulk backup of owner personalities and single personality backup
 */
const { PermissionFlagsBits } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');
const validator = require('../utils/commandValidator');
const {
  botPrefix,
  getPersonalityJargonTerm,
  getPrivateProfileInfoPath,
} = require('../../../config');
const { USER_CONFIG } = require('../../constants');
const nodeFetch = require('node-fetch');

/**
 * Command metadata
 */
const meta = {
  name: 'backup',
  description:
    'Backup personality data, memories, knowledge, training, and user personalization from the AI service',
  usage: 'backup [personality-name] | backup --all | backup --set-cookie <cookie>',
  aliases: [],
  permissions: [PermissionFlagsBits.Administrator],
};

// Configuration
const getApiBaseUrl = () =>
  process.env.SERVICE_WEBSITE ? `${process.env.SERVICE_WEBSITE}/api` : null;
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
  // eslint-disable-next-line no-restricted-globals
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
      lastKnowledgeSync: null,
      totalKnowledge: 0,
      lastTrainingSync: null,
      totalTraining: 0,
      lastUserPersonalizationSync: null,
      lastChatHistorySync: null,
      totalChatMessages: 0,
      oldestChatMessage: null,
      newestChatMessage: null,
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
 * Load existing knowledge from file
 */
async function loadKnowledge(personalityName) {
  const knowledgePath = path.join(
    getBackupDir(),
    personalityName,
    `${personalityName}_knowledge.json`
  );
  try {
    const data = await fs.readFile(knowledgePath, 'utf8');
    return JSON.parse(data);
  } catch (_error) {
    // eslint-disable-line no-unused-vars
    // No existing knowledge
    return [];
  }
}

/**
 * Save knowledge/story data to a single file
 */
async function saveKnowledge(personalityName, knowledge) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });

  const knowledgePath = path.join(personalityDir, `${personalityName}_knowledge.json`);
  await fs.writeFile(knowledgePath, JSON.stringify(knowledge, null, 2));
  logger.info(`[Backup] Saved knowledge/story data for ${personalityName}`);
}

/**
 * Load existing training from file
 */
async function loadTraining(personalityName) {
  const trainingPath = path.join(
    getBackupDir(),
    personalityName,
    `${personalityName}_training.json`
  );
  try {
    const data = await fs.readFile(trainingPath, 'utf8');
    return JSON.parse(data);
  } catch (_error) {
    // eslint-disable-line no-unused-vars
    // No existing training
    return [];
  }
}

/**
 * Save training data to a single file
 */
async function saveTraining(personalityName, training) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });

  const trainingPath = path.join(personalityDir, `${personalityName}_training.json`);
  await fs.writeFile(trainingPath, JSON.stringify(training, null, 2));
  logger.info(`[Backup] Saved training data for ${personalityName}`);
}

/**
 * Load existing user personalization from file
 */
async function loadUserPersonalization(personalityName) {
  const userPersonalizationPath = path.join(
    getBackupDir(),
    personalityName,
    `${personalityName}_user_personalization.json`
  );
  try {
    const data = await fs.readFile(userPersonalizationPath, 'utf8');
    return JSON.parse(data);
  } catch (_error) {
    // eslint-disable-line no-unused-vars
    // No existing user personalization
    return {};
  }
}

/**
 * Save user personalization data to a single file
 */
async function saveUserPersonalization(personalityName, userPersonalization) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });

  const userPersonalizationPath = path.join(
    personalityDir,
    `${personalityName}_user_personalization.json`
  );
  await fs.writeFile(userPersonalizationPath, JSON.stringify(userPersonalization, null, 2));
  logger.info(`[Backup] Saved user personalization data for ${personalityName}`);
}

/**
 * Load existing chat history from file
 */
async function loadChatHistory(personalityName) {
  const chatPath = path.join(
    getBackupDir(),
    personalityName,
    `${personalityName}_chat_history.json`
  );
  try {
    const data = await fs.readFile(chatPath, 'utf8');
    const chatData = JSON.parse(data);
    return chatData.messages || [];
  } catch (_error) {
    // eslint-disable-line no-unused-vars
    return [];
  }
}

/**
 * Save chat history to file
 */
async function saveChatHistory(personalityName, messages, metadata) {
  const personalityDir = path.join(getBackupDir(), personalityName);
  await fs.mkdir(personalityDir, { recursive: true });

  const chatData = {
    shape_id: metadata.personalityId,
    shape_name: personalityName,
    message_count: messages.length,
    date_range: {
      earliest: messages.length > 0 ? new Date(messages[0].ts * 1000).toISOString() : null,
      latest:
        messages.length > 0
          ? new Date(messages[messages.length - 1].ts * 1000).toISOString()
          : null,
    },
    export_date: new Date().toISOString(),
    messages: messages,
  };

  const chatPath = path.join(personalityDir, `${personalityName}_chat_history.json`);
  await fs.writeFile(chatPath, JSON.stringify(chatData, null, 2));
  logger.info(`[Backup] Saved ${messages.length} chat messages for ${personalityName}`);
}

/**
 * Fetch complete chat history using pagination
 * Returns messages sorted chronologically (oldest first) for easy incremental updates
 */
async function fetchChatHistory(personalityId, personalityName, authData) {
  logger.info(`[Backup] Fetching chat history for ${personalityName}...`);

  const allMessages = [];
  let beforeTs = null;
  let iteration = 0;
  const CHAT_BATCH_SIZE = 50;

  try {
    while (true) {
      iteration++;
      const jargonTerm = getPersonalityJargonTerm();
      if (!jargonTerm) {
        throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
      }
      let url = `${getApiBaseUrl()}/${jargonTerm}/${personalityId}/chat/history?limit=${CHAT_BATCH_SIZE}&shape_id=${personalityId}`;

      if (beforeTs) {
        url += `&before_ts=${beforeTs}`;
      }

      logger.info(
        `[Backup] Fetching chat batch ${iteration}${beforeTs ? ` (before ${new Date(beforeTs * 1000).toISOString()})` : ''}...`
      );

      const messages = await getBackupClient().makeAuthenticatedRequest(url, authData);

      if (!Array.isArray(messages) || messages.length === 0) {
        logger.info(`[Backup] No more messages found`);
        break;
      }

      allMessages.push(...messages);
      logger.info(`[Backup] Retrieved ${messages.length} messages (total: ${allMessages.length})`);

      // Find earliest timestamp for next batch
      beforeTs = Math.min(...messages.map(m => m.ts));

      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
    }

    // Sort by timestamp (oldest first) - consistent with memory storage pattern
    allMessages.sort((a, b) => a.ts - b.ts);

    logger.info(`[Backup] Fetched ${allMessages.length} total chat messages`);
    return allMessages;
  } catch (error) {
    logger.error(`[Backup] Error fetching chat history: ${error.message}`);
    return [];
  }
}

/**
 * Sync chat history intelligently - only fetch new messages
 */
async function syncChatHistory(personalityId, personalityName, authData, metadata) {
  logger.info(`[Backup] Syncing chat history for ${personalityName}...`);

  // Load existing chat history (already sorted oldest to newest)
  const existingMessages = await loadChatHistory(personalityName);

  // Get the timestamp of the newest existing message for efficient fetching
  let newestExistingTimestamp = 0;
  if (existingMessages.length > 0) {
    newestExistingTimestamp = existingMessages[existingMessages.length - 1].ts;
  }

  // Fetch all messages (they come sorted oldest to newest from fetchChatHistory)
  const allMessages = await fetchChatHistory(personalityId, personalityName, authData);

  if (allMessages.length === 0) {
    logger.info(`[Backup] No chat history available`);
    return { hasNewMessages: false, newMessageCount: 0, totalMessages: existingMessages.length };
  }

  // Find new messages (those with timestamp > newest existing)
  const newMessages = allMessages.filter(msg => msg.ts > newestExistingTimestamp);

  if (newMessages.length > 0) {
    // Simply append new messages to existing ones (both are already sorted)
    const updatedMessages = [...existingMessages, ...newMessages];

    // Save updated chat history
    await saveChatHistory(personalityName, updatedMessages, { personalityId });

    // Update metadata
    metadata.totalChatMessages = updatedMessages.length;
    metadata.lastChatHistorySync = new Date().toISOString();

    if (updatedMessages.length > 0) {
      metadata.oldestChatMessage = new Date(updatedMessages[0].ts * 1000).toISOString();
      metadata.newestChatMessage = new Date(
        updatedMessages[updatedMessages.length - 1].ts * 1000
      ).toISOString();
    }

    logger.info(
      `[Backup] Added ${newMessages.length} new messages (total: ${updatedMessages.length})`
    );
    return {
      hasNewMessages: true,
      newMessageCount: newMessages.length,
      totalMessages: updatedMessages.length,
    };
  } else {
    logger.info(`[Backup] No new messages found`);
    return { hasNewMessages: false, newMessageCount: 0, totalMessages: existingMessages.length };
  }
}

/**
 * Backup client for making API requests
 */
class BackupClient {
  constructor(options = {}) {
    this.scheduler = options.scheduler || globalThis.setTimeout || setTimeout;
    this.clearScheduler = options.clearScheduler || globalThis.clearTimeout || clearTimeout;
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

      // Session cookie is required - token auth doesn't work for these APIs
      if (!authData.cookie) {
        throw new Error('Session cookie required for backup operations');
      }

      headers['Cookie'] = authData.cookie;
      logger.debug(`[Backup] Using session cookie for authentication`);

      const response = await nodeFetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new Error(`API error ${response.status}: ${response.statusText}`);
        error.status = response.status;
        throw error;
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
  const privatePath = getPrivateProfileInfoPath();
  const url = `${getApiBaseUrl()}/${privatePath}/${personalityName}`;
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
 * Fetch knowledge/story data for a personality
 */
async function fetchKnowledgeData(personalityId, personalityName, authData) {
  logger.info(`[Backup] Fetching knowledge/story data for ${personalityName}...`);

  try {
    const jargonTerm = getPersonalityJargonTerm();
    if (!jargonTerm) {
      throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
    }
    const url = `${getApiBaseUrl()}/${jargonTerm}/${personalityId}/story`;
    logger.info(`[Backup] Fetching knowledge from: ${url}`);
    const response = await getBackupClient().makeAuthenticatedRequest(url, authData);

    // The knowledge/story endpoint might return different formats
    // Handle both array and object responses
    let knowledge = [];
    if (Array.isArray(response)) {
      knowledge = response;
    } else if (response.items) {
      knowledge = response.items;
    } else if (response.story || response.knowledge) {
      knowledge = response.story || response.knowledge;
    } else if (response && Object.keys(response).length > 0) {
      // If it's a single object, wrap it in an array
      knowledge = [response];
    }

    logger.info(`[Backup] Fetched ${knowledge.length} knowledge/story entries`);
    return knowledge;
  } catch (error) {
    logger.error(`[Backup] Error fetching knowledge for ${personalityName}: ${error.message}`);
    return [];
  }
}

/**
 * Fetch training data for a personality
 */
async function fetchTrainingData(personalityId, personalityName, authData) {
  logger.info(`[Backup] Fetching training data for ${personalityName}...`);

  try {
    const jargonTerm = getPersonalityJargonTerm();
    if (!jargonTerm) {
      throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
    }
    const url = `${getApiBaseUrl()}/${jargonTerm}/${personalityId}/training`;
    logger.info(`[Backup] Fetching training from: ${url}`);
    const response = await getBackupClient().makeAuthenticatedRequest(url, authData);

    // The training endpoint should return an array similar to story
    let training = [];
    if (Array.isArray(response)) {
      training = response;
    } else if (response.items) {
      training = response.items;
    } else if (response.training) {
      training = response.training;
    } else if (response && Object.keys(response).length > 0) {
      // If it's a single object, wrap it in an array
      training = [response];
    }

    logger.info(`[Backup] Fetched ${training.length} training entries`);
    return training;
  } catch (error) {
    logger.error(`[Backup] Error fetching training for ${personalityName}: ${error.message}`);
    return [];
  }
}

/**
 * Fetch user personalization data for a personality
 */
async function fetchUserPersonalizationData(personalityId, personalityName, authData) {
  logger.info(`[Backup] Fetching user personalization data for ${personalityName}...`);

  try {
    const jargonTerm = getPersonalityJargonTerm();
    if (!jargonTerm) {
      throw new Error('PERSONALITY_JARGON_TERM environment variable not configured');
    }
    const url = `${getApiBaseUrl()}/${jargonTerm}/${personalityId}/user`;
    logger.info(`[Backup] Fetching user personalization from: ${url}`);
    const response = await getBackupClient().makeAuthenticatedRequest(url, authData);

    // The user personalization endpoint returns a single object
    if (response && Object.keys(response).length > 0) {
      logger.info(`[Backup] Fetched user personalization data`);
      return response;
    } else {
      logger.info(`[Backup] No user personalization data found for ${personalityName}`);
      return {};
    }
  } catch (error) {
    logger.error(
      `[Backup] Error fetching user personalization for ${personalityName}: ${error.message}`
    );
    return {};
  }
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
 * Sync knowledge intelligently - check for changes
 */
async function syncKnowledge(personalityId, personalityName, authData, metadata) {
  logger.info(`[Backup] Syncing knowledge for ${personalityName}...`);

  try {
    // Fetch current knowledge data
    const currentKnowledge = await fetchKnowledgeData(personalityId, personalityName, authData);

    if (currentKnowledge.length === 0) {
      logger.info(`[Backup] No knowledge data found for ${personalityName}`);
      return { hasNewKnowledge: false, knowledgeCount: 0 };
    }

    // Load existing knowledge
    const existingKnowledge = await loadKnowledge(personalityName);

    // Simple comparison - if different, update
    const currentJson = JSON.stringify(currentKnowledge);
    const existingJson = JSON.stringify(existingKnowledge);

    if (currentJson !== existingJson) {
      await saveKnowledge(personalityName, currentKnowledge);
      metadata.totalKnowledge = currentKnowledge.length;
      metadata.lastKnowledgeSync = new Date().toISOString();

      logger.info(
        `[Backup] Updated knowledge for ${personalityName} (${currentKnowledge.length} entries)`
      );
      return { hasNewKnowledge: true, knowledgeCount: currentKnowledge.length };
    } else {
      logger.info(`[Backup] Knowledge unchanged for ${personalityName}`);
      return { hasNewKnowledge: false, knowledgeCount: currentKnowledge.length };
    }
  } catch (error) {
    logger.error(`[Backup] Error syncing knowledge for ${personalityName}: ${error.message}`);
    return { hasNewKnowledge: false, knowledgeCount: 0 };
  }
}

/**
 * Sync training intelligently - check for changes
 */
async function syncTraining(personalityId, personalityName, authData, metadata) {
  logger.info(`[Backup] Syncing training for ${personalityName}...`);

  try {
    // Fetch current training data
    const currentTraining = await fetchTrainingData(personalityId, personalityName, authData);

    if (currentTraining.length === 0) {
      logger.info(`[Backup] No training data found for ${personalityName}`);
      return { hasNewTraining: false, trainingCount: 0 };
    }

    // Load existing training
    const existingTraining = await loadTraining(personalityName);

    // Simple comparison - if different, update
    const currentJson = JSON.stringify(currentTraining);
    const existingJson = JSON.stringify(existingTraining);

    if (currentJson !== existingJson) {
      await saveTraining(personalityName, currentTraining);
      metadata.totalTraining = currentTraining.length;
      metadata.lastTrainingSync = new Date().toISOString();

      logger.info(
        `[Backup] Updated training for ${personalityName} (${currentTraining.length} entries)`
      );
      return { hasNewTraining: true, trainingCount: currentTraining.length };
    } else {
      logger.info(`[Backup] Training unchanged for ${personalityName}`);
      return { hasNewTraining: false, trainingCount: currentTraining.length };
    }
  } catch (error) {
    logger.error(`[Backup] Error syncing training for ${personalityName}: ${error.message}`);
    return { hasNewTraining: false, trainingCount: 0 };
  }
}

/**
 * Sync user personalization intelligently - check for changes
 */
async function syncUserPersonalization(personalityId, personalityName, authData, metadata) {
  logger.info(`[Backup] Syncing user personalization for ${personalityName}...`);

  try {
    // Fetch current user personalization data
    const currentUserPersonalization = await fetchUserPersonalizationData(
      personalityId,
      personalityName,
      authData
    );

    if (Object.keys(currentUserPersonalization).length === 0) {
      logger.info(`[Backup] No user personalization data found for ${personalityName}`);
      return { hasNewUserPersonalization: false };
    }

    // Load existing user personalization
    const existingUserPersonalization = await loadUserPersonalization(personalityName);

    // Simple comparison - if different, update
    const currentJson = JSON.stringify(currentUserPersonalization);
    const existingJson = JSON.stringify(existingUserPersonalization);

    if (currentJson !== existingJson) {
      await saveUserPersonalization(personalityName, currentUserPersonalization);
      metadata.lastUserPersonalizationSync = new Date().toISOString();

      logger.info(`[Backup] Updated user personalization for ${personalityName}`);
      return { hasNewUserPersonalization: true };
    } else {
      logger.info(`[Backup] User personalization unchanged for ${personalityName}`);
      return { hasNewUserPersonalization: false };
    }
  } catch (error) {
    logger.error(
      `[Backup] Error syncing user personalization for ${personalityName}: ${error.message}`
    );
    return { hasNewUserPersonalization: false };
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

    // Fetch memories and knowledge if personality has an ID
    if (profile.id) {
      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const { newMemoryCount } = await syncMemories(
        profile.id,
        personalityName,
        authData,
        metadata
      );

      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const { hasNewKnowledge, knowledgeCount } = await syncKnowledge(
        profile.id,
        personalityName,
        authData,
        metadata
      );

      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const { hasNewTraining, trainingCount } = await syncTraining(
        profile.id,
        personalityName,
        authData,
        metadata
      );

      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const { hasNewUserPersonalization } = await syncUserPersonalization(
        profile.id,
        personalityName,
        authData,
        metadata
      );

      // Sync chat history
      await getDelayFn()(DELAY_BETWEEN_REQUESTS);
      const chatResult = await syncChatHistory(profile.id, personalityName, authData, metadata);

      // Update metadata
      metadata.lastBackup = new Date().toISOString();
      await saveBackupMetadata(personalityName, metadata);

      let resultMessage =
        `✅ Backup complete for **${personalityName}**\n` +
        `• Profile: Updated\n` +
        `• New memories: ${newMemoryCount}\n` +
        `• Total memories: ${metadata.totalMemories}\n` +
        `• Knowledge: ${hasNewKnowledge ? 'Updated' : 'Unchanged'} (${knowledgeCount} entries)\n` +
        `• Training: ${hasNewTraining ? 'Updated' : 'Unchanged'} (${trainingCount} entries)\n` +
        `• User Personalization: ${hasNewUserPersonalization ? 'Updated' : 'Unchanged'}\n` +
        `• Chat History: ${chatResult.newMessageCount} new messages (total: ${chatResult.totalMessages})`;

      if (metadata.oldestChatMessage && metadata.newestChatMessage) {
        const oldest = new Date(metadata.oldestChatMessage).toLocaleDateString();
        const newest = new Date(metadata.newestChatMessage).toLocaleDateString();
        resultMessage += `\n• Date range: ${oldest} to ${newest}`;
      }

      await directSend(resultMessage);
    } else {
      await directSend(
        `✅ Backup complete for **${personalityName}** (no additional data found - profile only)`
      );
    }
  } catch (error) {
    logger.error(`[Backup] Error backing up ${personalityName}: ${error.message}`);
    await directSend(`❌ Failed to backup **${personalityName}**: ${error.message}`);
    // Re-throw the error so bulk backup can catch it
    throw error;
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
  let shouldContinue = true;

  for (const personalityName of ownerPersonalities) {
    if (!shouldContinue) break;

    try {
      await backupPersonality(personalityName, authData, directSend);
      successCount++;

      // Delay between personalities
      if (successCount < ownerPersonalities.length) {
        await getDelayFn()(DELAY_BETWEEN_REQUESTS * 2);
      }
    } catch (error) {
      // Check if it's a 401 Unauthorized error
      if (error.status === 401 || error.message.includes('401')) {
        await directSend(
          `\n❌ Authentication failed! Your session cookie may have expired.\n` +
            `Successfully backed up ${successCount} of ${ownerPersonalities.length} personalities before failure.\n\n` +
            `Please update your session cookie with: \`${botPrefix} backup --set-cookie <new-cookie>\``
        );
        shouldContinue = false;
      } else {
        // For other errors, log but continue with next personality
        logger.error(`[Backup] Error backing up ${personalityName}: ${error.message}`);
      }
    }
  }

  if (shouldContinue) {
    await directSend(`\n✅ Bulk backup complete! Backed up ${successCount} personalities.`);
  }
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

    // Get authentication data - session cookie is required
    const authData = {};

    // Check for stored session
    const userSession = userSessions.get(message.author.id);
    if (!userSession) {
      return await directSend(
        '❌ Session cookie required for backup operations.\n\n' +
          '**How to set your session cookie:**\n' +
          '1. Open the service website in your browser and log in\n' +
          '2. Open Developer Tools (F12)\n' +
          '3. Go to Application/Storage → Cookies\n' +
          '4. Find the `appSession` cookie\n' +
          '5. Copy its value (the long string)\n' +
          '6. Use: `' +
          botPrefix +
          ' backup --set-cookie <cookie-value>`\n\n' +
          '⚠️ **Note:** Token authentication does not work for these backup APIs.'
      );
    }

    authData.cookie = userSession.cookie;
    logger.info(`[Backup] Using stored session cookie for user ${message.author.id}`);

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
  loadKnowledge,
  saveKnowledge,
  loadTraining,
  saveTraining,
  loadUserPersonalization,
  saveUserPersonalization,
  fetchPersonalityProfile,
  fetchAllMemories,
  fetchKnowledgeData,
  fetchTrainingData,
  fetchUserPersonalizationData,
  syncMemories,
  syncKnowledge,
  syncTraining,
  syncUserPersonalization,
  backupPersonality,
  handleBulkBackup,
  handleSetCookie,
  userSessions, // Export for testing
  getDelayFn, // Export for testing
  // Chat history functions
  loadChatHistory,
  saveChatHistory,
  fetchChatHistory,
  syncChatHistory,
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
