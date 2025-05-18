// Track ongoing conversations
const activeConversations = new Map();

// Track activated channels (where bot responds to all messages)
const activatedChannels = new Map();

// Track users with auto-response enabled
const autoResponseUsers = new Set();

// Map message IDs to conversations for quicker lookup
const messageIdMap = new Map();

/**
 * Record a message as part of a conversation with a personality
 * @param {string} userId - Discord user ID
 * @param {string} channelId - Discord channel ID
 * @param {string|string[]} messageIds - ID or array of IDs of messages sent by the webhook
 * @param {string} personalityName - Full name of the personality
 */
function recordConversation(userId, channelId, messageIds, personalityName) {
  const key = `${userId}-${channelId}`;
  const timestamp = Date.now();

  console.log(`Recording conversation - USER: ${userId}, CHANNEL: ${channelId}, PERSONALITY: ${personalityName}`);
  console.log(`Message IDs format: ${typeof messageIds}, isArray: ${Array.isArray(messageIds)}, value:`, messageIds);

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
    console.log(`[ConversationManager] Mapping message ID ${msgId} to personality ${personalityName}`);
    messageIdMap.set(msgId, {
      userId,
      channelId,
      personalityName,
      timestamp
    });
  });
  
  // Debug check: Verify the message IDs were stored correctly
  messageIdArray.forEach(msgId => {
    const data = messageIdMap.get(msgId);
    console.log(`[ConversationManager] Verification - Message ID ${msgId} maps to: ${data ? data.personalityName : 'NOT FOUND!'}`);
  });
  
  console.log(`Recorded conversation for user ${userId} in channel ${channelId} with ${messageIdArray.length} messages from ${personalityName}`);
  console.log(`Active conversations map size: ${activeConversations.size}, Message ID map size: ${messageIdMap.size}`);
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
  return true;
}

/**
 * Disable auto-response for a user
 * @param {string} userId - Discord user ID
 * @returns {boolean} Success status
 */
function disableAutoResponse(userId) {
  return autoResponseUsers.delete(userId);
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
 * @returns {string|null} The personality name or null if not found
 */
function getPersonalityFromMessage(messageId) {
  console.log(`Looking up personality for message ID: ${messageId}`);
  console.log(`Current message ID map size: ${messageIdMap.size}`);
  
  // Use the message ID map for a quick lookup
  const conversationData = messageIdMap.get(messageId);
  
  if (conversationData) {
    console.log(`Found personality in message ID map: ${conversationData.personalityName}`);
    return conversationData.personalityName;
  } else {
    console.log(`Message ID not found in direct map lookup: ${messageId}`);
  }
  
  console.log(`Falling back to active conversations search (${activeConversations.size} conversations)`);
  
  // Fallback to searching through all active conversations (for backward compatibility)
  for (const [convKey, conversation] of activeConversations.entries()) {
    console.log(`Checking conversation ${convKey} with personality ${conversation.personalityName}`);
    
    if (conversation.messageIds && Array.isArray(conversation.messageIds)) {
      console.log(`Conversation has ${conversation.messageIds.length} message IDs:`, conversation.messageIds);
      
      if (conversation.messageIds.includes(messageId)) {
        console.log(`Found message ID in conversation's messageIds array!`);
        return conversation.personalityName;
      }
    } else {
      console.log(`Conversation has no messageIds array or it's not an array`);
    }
    
    // Legacy support for older conversations
    if (conversation.lastMessageId === messageId) {
      console.log(`Found message ID in conversation's lastMessageId!`);
      return conversation.personalityName;
    }
  }

  console.log(`No personality found for message ID: ${messageId}`);
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
    return activeConversations.delete(key);
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
  return true;
}

/**
 * Deactivate personality in a channel
 * @param {string} channelId - Discord channel ID
 * @returns {boolean} Success status (true if there was a personality to deactivate)
 */
function deactivatePersonality(channelId) {
  return activatedChannels.delete(channelId);
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
setInterval(() => {
  const now = Date.now();
  const CONVERSATION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

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
    }
  }
  
  // Additional cleanup for any orphaned message ID mappings
  for (const [msgId, data] of messageIdMap.entries()) {
    if (now - data.timestamp > CONVERSATION_TIMEOUT) {
      messageIdMap.delete(msgId);
      console.log(`Cleaned up orphaned message ID mapping: ${msgId}`);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

module.exports = {
  recordConversation,
  getActivePersonality,
  getPersonalityFromMessage,
  clearConversation,
  activatePersonality,
  deactivatePersonality,
  getActivatedPersonality,
  enableAutoResponse,
  disableAutoResponse,
  isAutoResponseEnabled
};