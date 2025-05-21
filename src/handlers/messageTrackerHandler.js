/**
 * Handles message tracking and similarity checking to prevent duplicate processing
 */
const logger = require('../logger');
const contentSimilarity = require('../utils/contentSimilarity');

// Map to track recent messages by content to detect proxy duplicates
// Format: Map<channelId, Array<{content: string, timestamp: number, handled: boolean, messageId: string}>>
const recentMessagesByChannel = new Map();

/**
 * Cleanup function for recent messages map
 * Removes messages older than the proxy delay time
 */
function cleanupRecentMessages() {
  const now = Date.now();
  const channelsToDelete = [];

  for (const [channelId, messages] of recentMessagesByChannel.entries()) {
    // Remove messages older than the proxy delay time + buffer
    const newMessages = messages.filter(msg => {
      return now - msg.timestamp < contentSimilarity.getProxyDelayTime() + 5000; // 5 second buffer
    });

    if (newMessages.length === 0) {
      channelsToDelete.push(channelId);
    } else {
      recentMessagesByChannel.set(channelId, newMessages);
    }
  }

  // Delete empty channel entries
  for (const channelId of channelsToDelete) {
    recentMessagesByChannel.delete(channelId);
  }
}

// Initialize cleanup interval
let cleanupInterval = null;

/**
 * Start the periodic cleanup of recent messages
 * @param {number} interval - Cleanup interval in milliseconds (default: 30000)
 * @returns {NodeJS.Timeout} - The interval ID
 */
function startCleanupInterval(interval = 30000) {
  // Clear existing interval if there is one
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  // Start a new interval
  cleanupInterval = setInterval(cleanupRecentMessages, interval);
  return cleanupInterval;
}

/**
 * Stop the periodic cleanup of recent messages
 */
function stopCleanupInterval() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Track a new message in the channel's recent messages list
 * @param {Object} message - Discord message object
 * @returns {void}
 */
function trackMessageInChannel(message) {
  if (!message || !message.content) return;

  const channelId = message.channel.id;
  const content = message.content;
  const messageId = message.id;

  // Initialize array for this channel if it doesn't exist
  if (!recentMessagesByChannel.has(channelId)) {
    recentMessagesByChannel.set(channelId, []);
  }

  // Add this message to the channel's recent messages
  const messages = recentMessagesByChannel.get(channelId);
  messages.push({
    content,
    timestamp: Date.now(),
    handled: false,
    messageId,
  });

  // Keep array from growing too large
  if (messages.length > 50) {
    messages.shift(); // Remove oldest message
  }

  recentMessagesByChannel.set(channelId, messages);
}

/**
 * Check if a message has similar content to recent messages in the channel that have been handled
 * Only returns true if the similar message was also marked as handled
 * @param {Object} message - Discord message object
 * @returns {boolean} - true if a similar message was recently seen AND handled
 */
function hasSimilarRecentMessage(message) {
  if (!message || !message.content) return false;

  const channelId = message.channel.id;
  const content = message.content;

  // If no recent messages for this channel, return false
  if (!recentMessagesByChannel.has(channelId)) return false;

  const messages = recentMessagesByChannel.get(channelId);
  const now = Date.now();

  // Only check messages that are recent enough to be from a proxy service
  const recentEnoughMessages = messages.filter(msg => {
    // Only consider messages from the last few seconds
    return now - msg.timestamp < contentSimilarity.getProxyDelayTime();
  });

  // Check if any recent messages have similar content AND have been handled
  for (const msg of recentEnoughMessages) {
    // Skip comparing with the exact same message ID
    if (msg.messageId === message.id) continue;

    // Only consider similar messages that have been handled
    if (contentSimilarity.areContentsSimilar(content, msg.content)) {
      // Return true ONLY if the message has been handled
      if (msg.handled) {
        logger.info(
          `[MessageTracker] Found similar recent message (${msg.messageId}) to current message (${message.id}) - similarity detected and message was handled`
        );
        return true;
      }
    }
  }

  return false;
}

/**
 * Mark a message as handled to prevent duplicates
 * @param {Object} message - Discord message object
 */
function markMessageAsHandled(message) {
  if (!message) return;

  const channelId = message.channel.id;
  if (!recentMessagesByChannel.has(channelId)) return;

  const messages = recentMessagesByChannel.get(channelId);
  for (const msg of messages) {
    if (msg.messageId === message.id) {
      msg.handled = true;
      break;
    }
  }

  recentMessagesByChannel.set(channelId, messages);
}

/**
 * Add a delay and process the message with personality handler
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality object
 * @param {string|null} triggeringMention - The mention text that triggered this interaction, if any
 * @param {Object} client - Discord.js client instance
 * @param {Function} handlerFunction - The function to call after the delay
 * @returns {Promise<void>}
 */
async function delayedProcessing(message, personality, triggeringMention, client, handlerFunction) {
  // Track this message in the channel's recent messages
  trackMessageInChannel(message);

  // Check if this message is similar to a recently processed message
  if (hasSimilarRecentMessage(message)) {
    logger.info(`[MessageTracker] Skipping message processing - likely duplicate: ${message.id}`);
    return;
  }

  // Add a short delay to allow proxy systems to process the message
  logger.info(`[MessageTracker] Adding delay for message ${message.id}`);

  return new Promise(resolve => {
    setTimeout(async () => {
      try {
        // Re-fetch the message to ensure it still exists
        let messageToProcess = null;
        try {
          messageToProcess = await message.channel.messages.fetch(message.id);
        } catch (fetchErr) {
          logger.info(
            `[MessageTracker] Message ${message.id} no longer exists, likely deleted by proxy system`
          );
          resolve(); // Message was deleted, don't process
          return;
        }

        // Mark the message as handled
        markMessageAsHandled(messageToProcess);

        // Process the message with the provided handler function
        await handlerFunction(messageToProcess, personality, triggeringMention, client);
        resolve();
      } catch (err) {
        logger.error(`[MessageTracker] Error in delayed processing: ${err.message}`);
        resolve();
      }
    }, contentSimilarity.getProxyDelayTime());
  });
}

// Start the cleanup interval when the module is loaded
startCleanupInterval();

module.exports = {
  trackMessageInChannel,
  hasSimilarRecentMessage,
  markMessageAsHandled,
  delayedProcessing,
  startCleanupInterval,
  stopCleanupInterval,
};
