// Track ongoing conversations
const activeConversations = new Map();

// Track activated channels (where bot responds to all messages)
const activatedChannels = new Map();

/**
 * Record a message as part of a conversation with a personality
 * @param {string} userId - Discord user ID
 * @param {string} channelId - Discord channel ID
 * @param {string} messageId - ID of the message sent by the webhook
 * @param {string} personalityName - Full name of the personality
 */
function recordConversation(userId, channelId, messageId, personalityName) {
  const key = `${userId}-${channelId}`;

  activeConversations.set(key, {
    personalityName,
    lastMessageId: messageId,
    timestamp: Date.now()
  });
}

/**
 * Get the active personality for a user in a channel
 * @param {string} userId - Discord user ID
 * @param {string} channelId - Discord channel ID
 * @returns {string|null} The personality name or null if no active conversation
 */
function getActivePersonality(userId, channelId) {
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
 * Check if a message ID is from a known conversation
 * @param {string} messageId - Discord message ID
 * @returns {Object|null} The personality name or null if not found
 */
function getPersonalityFromMessage(messageId) {
  for (const conversation of activeConversations.values()) {
    if (conversation.lastMessageId === messageId) {
      return conversation.personalityName;
    }
  }

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
  return activeConversations.delete(key);
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

  for (const [key, conversation] of activeConversations.entries()) {
    // If conversation is older than 30 minutes, remove it
    if (now - conversation.timestamp > 30 * 60 * 1000) {
      activeConversations.delete(key);
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
  getActivatedPersonality
};