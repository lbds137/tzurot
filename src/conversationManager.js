const fs = require('fs').promises;
const path = require('path');

// File paths for storing data
const DATA_DIR = path.join(process.cwd(), 'data');
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');
const CHANNEL_ACTIVATIONS_FILE = path.join(DATA_DIR, 'channel_activations.json');
const AUTO_RESPONSE_FILE = path.join(DATA_DIR, 'auto_response.json');
const MESSAGE_MAP_FILE = path.join(DATA_DIR, 'message_map.json');

// Track ongoing conversations
const activeConversations = new Map();

// Track activated channels (where bot responds to all messages)
const activatedChannels = new Map();

// Track users with auto-response enabled
const autoResponseUsers = new Set();

// Map message IDs to conversations for quicker lookup
const messageIdMap = new Map();

/**
 * Ensure the data directory exists
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error(`Error creating data directory: ${error.message}`);
  }
}

/**
 * Save all conversation data to files
 */
async function saveAllData() {
  try {
    await ensureDataDir();
    
    // Save active conversations
    const conversationsData = {};
    for (const [key, value] of activeConversations.entries()) {
      conversationsData[key] = value;
    }
    await fs.writeFile(CONVERSATIONS_FILE, JSON.stringify(conversationsData, null, 2));
    
    // Save activated channels
    const activatedChannelsData = {};
    for (const [key, value] of activatedChannels.entries()) {
      activatedChannelsData[key] = value;
    }
    await fs.writeFile(CHANNEL_ACTIVATIONS_FILE, JSON.stringify(activatedChannelsData, null, 2));
    
    // Save auto-response users
    const autoResponseData = Array.from(autoResponseUsers);
    await fs.writeFile(AUTO_RESPONSE_FILE, JSON.stringify(autoResponseData, null, 2));
    
    // Save message ID map
    const messageMapData = {};
    for (const [key, value] of messageIdMap.entries()) {
      messageMapData[key] = value;
    }
    await fs.writeFile(MESSAGE_MAP_FILE, JSON.stringify(messageMapData, null, 2));
    
    console.log('Conversation data saved');
  } catch (error) {
    console.error(`Error saving conversation data: ${error.message}`);
  }
}

/**
 * Load all conversation data from files
 */
async function loadAllData() {
  try {
    await ensureDataDir();
    
    // Load active conversations
    try {
      const conversationsData = JSON.parse(await fs.readFile(CONVERSATIONS_FILE, 'utf8'));
      for (const [key, value] of Object.entries(conversationsData)) {
        activeConversations.set(key, value);
      }
      console.log(`[ConversationManager] Loaded ${activeConversations.size} active conversations`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Error loading conversations: ${error.message}`);
      }
    }
    
    // Load activated channels
    try {
      const activatedChannelsData = JSON.parse(await fs.readFile(CHANNEL_ACTIVATIONS_FILE, 'utf8'));
      for (const [key, value] of Object.entries(activatedChannelsData)) {
        activatedChannels.set(key, value);
      }
      console.log(`[ConversationManager] Loaded ${activatedChannels.size} activated channels`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Error loading activated channels: ${error.message}`);
      }
    }
    
    // Load auto-response users
    try {
      const autoResponseData = JSON.parse(await fs.readFile(AUTO_RESPONSE_FILE, 'utf8'));
      for (const userId of autoResponseData) {
        autoResponseUsers.add(userId);
      }
      console.log(`[ConversationManager] Loaded ${autoResponseUsers.size} auto-response users`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Error loading auto-response users: ${error.message}`);
      }
    }
    
    // Load message ID map
    try {
      const messageMapData = JSON.parse(await fs.readFile(MESSAGE_MAP_FILE, 'utf8'));
      for (const [key, value] of Object.entries(messageMapData)) {
        messageIdMap.set(key, value);
      }
      console.log(`[ConversationManager] Loaded ${messageIdMap.size} message ID mappings`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Error loading message ID map: ${error.message}`);
      }
    }
    
    console.log('[ConversationManager] All data loaded successfully');
  } catch (error) {
    console.error(`Error loading conversation data: ${error.message}`);
  }
}

/**
 * Record a message as part of a conversation with a personality
 * @param {string} userId - Discord user ID
 * @param {string} channelId - Discord channel ID
 * @param {string|string[]} messageIds - ID or array of IDs of messages sent by the webhook
 * @param {string} personalityName - Full name of the personality
 */
function recordConversation(userId, channelId, messageIds, personalityName) {
  // Minimize logging during conversation recording
  const originalConsoleLog = console.log;
  console.log = () => {}; // Temporarily disable logging
  
  const key = `${userId}-${channelId}`;
  const timestamp = Date.now();

  // Convert single message ID to array if needed
  const messageIdArray = Array.isArray(messageIds) ? messageIds : [messageIds];

  // Store conversation information
  activeConversations.set(key, {
    personalityName,
    messageIds: messageIdArray,
    timestamp: timestamp
  });

  // Map each message ID to this conversation for quick lookup
  messageIdArray.forEach(msgId => {
    messageIdMap.set(msgId, {
      userId,
      channelId,
      personalityName,
      timestamp
    });
  });
  
  // Save to persistent storage
  try {
    saveAllData();
  } catch (error) {
    console.error(`[ConversationManager] Error saving: ${error.message}`);
  }
  
  // Restore console output
  console.log = originalConsoleLog;
}

/**
 * Get the active personality for a user in a channel
 * @param {string} userId - Discord user ID
 * @param {string} channelId - Discord channel ID
 * @returns {string|null} The personality name or null if no active conversation
 */
function getActivePersonality(userId, channelId) {
  // Only check for active conversation if auto-response is enabled for this user
  if (!isAutoResponseEnabled(userId)) {
    return null;
  }

  const key = `${userId}-${channelId}`;

  const conversation = activeConversations.get(key);
  if (!conversation) {
    return null;
  }

  // Check if the conversation is still "fresh" (within the last 30 minutes)
  const isStale = (Date.now() - conversation.timestamp) > 30 * 60 * 1000;
  if (isStale) {
    activeConversations.delete(key);
    return null;
  }

  return conversation.personalityName;
}

/**
 * Enable auto-response for a user
 * @param {string} userId - Discord user ID
 * @returns {boolean} Success status
 */
function enableAutoResponse(userId) {
  autoResponseUsers.add(userId);
  
  // Save to persistent storage
  saveAllData();
  
  return true;
}

/**
 * Disable auto-response for a user
 * @param {string} userId - Discord user ID
 * @returns {boolean} Success status
 */
function disableAutoResponse(userId) {
  const result = autoResponseUsers.delete(userId);
  
  // Save to persistent storage
  if (result) {
    saveAllData();
  }
  
  return result;
}

/**
 * Check if auto-response is enabled for a user
 * @param {string} userId - Discord user ID
 * @returns {boolean} Whether auto-response is enabled
 */
function isAutoResponseEnabled(userId) {
  return autoResponseUsers.has(userId);
}

/**
 * Check if a message ID is from a known conversation
 * @param {string} messageId - Discord message ID
 * @param {Object} [options] - Additional options
 * @param {string} [options.webhookUsername] - Username of the webhook for fallback detection
 * @returns {string|null} The personality name or null if not found
 */
function getPersonalityFromMessage(messageId, options = {}) {
  // Don't log "Looking up personality" here since bot.js already logs it
  console.log(`[ConversationManager] Searching for message ID: ${messageId} (map size: ${messageIdMap.size})`);
  
  // Use the message ID map for a quick lookup
  const conversationData = messageIdMap.get(messageId);
  
  if (conversationData) {
    console.log(`[ConversationManager] Found personality in message ID map: ${conversationData.personalityName}`);
    return conversationData.personalityName;
  } else {
    console.log(`[ConversationManager] Message ID not found in direct map lookup: ${messageId}`);
  }
  
  console.log(`[ConversationManager] Falling back to active conversations search (${activeConversations.size} conversations)`);
  
  // Fallback to searching through all active conversations (for backward compatibility)
  for (const [convKey, conversation] of activeConversations.entries()) {
    console.log(`[ConversationManager] Checking conversation ${convKey} with personality ${conversation.personalityName}`);
    
    if (conversation.messageIds && Array.isArray(conversation.messageIds)) {
      if (conversation.messageIds.includes(messageId)) {
        console.log(`[ConversationManager] Found message ID in conversation's messageIds array!`);
        return conversation.personalityName;
      }
    }
    
    // Legacy support for older conversations
    if (conversation.lastMessageId === messageId) {
      console.log(`[ConversationManager] Found message ID in conversation's lastMessageId!`);
      return conversation.personalityName;
    }
  }
  
  // Final fallback: check by webhook username if provided
  if (options.webhookUsername) {
    console.log(`[ConversationManager] Attempting to identify personality by webhook username: "${options.webhookUsername}"`);
    
    // Helper function to safely get lowercase version of a string
    const safeToLowerCase = (str) => {
      if (!str) return '';
      return String(str).toLowerCase();
    };
    
    // We're now just using displayName for webhook usernames (no more full-name in parentheses)
    // So we'll skip this part and go straight to matching by display name
    
    // If no match from the formatted name, fall back to the old method
    try {
      const { listPersonalitiesForUser } = require('./personalityManager');
      const allPersonalities = listPersonalitiesForUser();
      
      if (!allPersonalities || !Array.isArray(allPersonalities)) {
        console.error(`[ConversationManager] listPersonalitiesForUser returned invalid data:`, allPersonalities);
        return null;
      }
      
      console.log(`[ConversationManager] Checking ${allPersonalities.length} personalities for match with: ${options.webhookUsername}`);
      
      // Look for a personality with matching display name
      for (const personality of allPersonalities) {
        if (!personality) continue;
        
        // Exact match first
        if (personality.displayName && personality.displayName === options.webhookUsername) {
          console.log(`[ConversationManager] Found personality match by display name: ${personality.fullName}`);
          return personality.fullName;
        }
      }
      
      // No direct match, try case-insensitive
      const webhookUsernameLower = safeToLowerCase(options.webhookUsername);
      for (const personality of allPersonalities) {
        if (!personality || !personality.displayName) continue;
        
        const displayNameLower = safeToLowerCase(personality.displayName);
        if (displayNameLower === webhookUsernameLower) {
          console.log(`[ConversationManager] Found personality match by case-insensitive display name: ${personality.fullName}`);
          return personality.fullName;
        }
      }
      
      // Try partial match as last resort
      if (webhookUsernameLower.length > 3) { // Only try if username is substantial
        for (const personality of allPersonalities) {
          if (!personality || !personality.displayName) continue;
          
          const displayNameLower = safeToLowerCase(personality.displayName);
          if (displayNameLower.includes(webhookUsernameLower) || 
              webhookUsernameLower.includes(displayNameLower)) {
            console.log(`[ConversationManager] Found personality match by partial name: ${personality.fullName}`);
            return personality.fullName;
          }
        }
      }
      
      console.log(`[ConversationManager] No personality found matching webhook username: "${options.webhookUsername}"`);
    } catch (error) {
      console.error(`[ConversationManager] Error looking up personality by webhook username: ${error.message}`);
    }
  }

  console.log(`[ConversationManager] No personality found for message ID: ${messageId}`);
  return null;
}

/**
 * Clear conversation history
 * @param {string} userId - Discord user ID
 * @param {string} channelId - Discord channel ID
 * @returns {boolean} Whether a conversation was cleared
 */
function clearConversation(userId, channelId) {
  const key = `${userId}-${channelId}`;
  
  // Get the conversation before deleting it
  const conversation = activeConversations.get(key);
  
  if (conversation) {
    // Clean up the message ID mappings
    if (conversation.messageIds) {
      conversation.messageIds.forEach(msgId => {
        messageIdMap.delete(msgId);
      });
    }
    
    // Legacy support
    if (conversation.lastMessageId) {
      messageIdMap.delete(conversation.lastMessageId);
    }
    
    // Remove the conversation
    const result = activeConversations.delete(key);
    
    // Save changes to persistent storage
    saveAllData();
    
    return result;
  }
  
  return false;
}

/**
 * Activate a personality in a channel (will respond to all messages)
 * @param {string} channelId - Discord channel ID
 * @param {string} personalityName - Full name of the personality
 * @param {string} userId - Discord user ID who activated
 * @returns {boolean} Success status
 */
function activatePersonality(channelId, personalityName, userId) {
  activatedChannels.set(channelId, {
    personalityName,
    activatedBy: userId,
    timestamp: Date.now()
  });
  
  // Save to persistent storage
  saveAllData();
  
  return true;
}

/**
 * Deactivate personality in a channel
 * @param {string} channelId - Discord channel ID
 * @returns {boolean} Success status (true if there was a personality to deactivate)
 */
function deactivatePersonality(channelId) {
  const result = activatedChannels.delete(channelId);
  
  // Save to persistent storage
  if (result) {
    saveAllData();
  }
  
  return result;
}

/**
 * Check if a channel has an activated personality
 * @param {string} channelId - Discord channel ID
 * @returns {string|null} The personality name or null if none activated
 */
function getActivatedPersonality(channelId) {
  const activated = activatedChannels.get(channelId);
  if (!activated) {
    return null;
  }

  return activated.personalityName;
}

// Periodically clean up stale conversations
const CONVERSATION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  const now = Date.now();
  let didCleanup = false;

  for (const [key, conversation] of activeConversations.entries()) {
    // If conversation is older than 30 minutes, remove it
    if (now - conversation.timestamp > CONVERSATION_TIMEOUT) {
      // Clean up the message ID mappings
      if (conversation.messageIds) {
        conversation.messageIds.forEach(msgId => {
          messageIdMap.delete(msgId);
        });
      }
      
      // Legacy support
      if (conversation.lastMessageId) {
        messageIdMap.delete(conversation.lastMessageId);
      }
      
      // Delete the conversation
      activeConversations.delete(key);
      console.log(`Cleaned up stale conversation for key: ${key}`);
      didCleanup = true;
    }
  }
  
  // Additional cleanup for any orphaned message ID mappings
  for (const [msgId, data] of messageIdMap.entries()) {
    if (now - data.timestamp > CONVERSATION_TIMEOUT) {
      messageIdMap.delete(msgId);
      console.log(`Cleaned up orphaned message ID mapping: ${msgId}`);
      didCleanup = true;
    }
  }
  
  // Save data if we did any cleanup
  if (didCleanup) {
    saveAllData();
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// Periodically save data
setInterval(() => {
  console.log('[ConversationManager] Running periodic data save...');
  saveAllData();
}, 5 * 60 * 1000); // Save every 5 minutes

/**
 * Initialize the conversation manager
 */
async function initConversationManager() {
  try {
    await loadAllData();
    console.log('[ConversationManager] Initialization complete');
  } catch (error) {
    console.error(`[ConversationManager] Error initializing: ${error.message}`);
  }
}

module.exports = {
  initConversationManager,
  recordConversation,
  getActivePersonality,
  getPersonalityFromMessage,
  clearConversation,
  activatePersonality,
  deactivatePersonality,
  getActivatedPersonality,
  enableAutoResponse,
  disableAutoResponse,
  isAutoResponseEnabled,
  saveAllData
};