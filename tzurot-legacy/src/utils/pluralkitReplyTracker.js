/**
 * Pluralkit Reply Tracker
 *
 * This module tracks pending replies to personality messages that might be
 * processed by Pluralkit. When a user replies to a personality message,
 * we store that context. When a Pluralkit webhook arrives with similar
 * content, we can restore the reply context.
 */

const logger = require('../logger');

// Map to track pending replies
// Key: channelId, Value: Array of pending reply contexts
const pendingReplies = new Map();

// Cleanup interval
let cleanupInterval = null;

// Expiration time for pending replies (5 seconds)
const EXPIRATION_TIME = 5000;

/**
 * Track a pending reply to a personality message
 * @param {Object} context - Reply context
 * @param {string} context.channelId - Channel ID
 * @param {string} context.userId - Real user ID (not webhook)
 * @param {string} context.content - Original message content
 * @param {Object} context.personality - Personality being replied to
 * @param {string} context.referencedMessageId - ID of the message being replied to
 * @param {string} [context.originalMessageId] - ID of the original message (before Pluralkit processing)
 */
function trackPendingReply(context) {
  const { channelId, userId, content, personality, referencedMessageId, originalMessageId } =
    context;

  if (!pendingReplies.has(channelId)) {
    pendingReplies.set(channelId, []);
  }

  const replies = pendingReplies.get(channelId);
  replies.push({
    userId,
    content,
    personality,
    referencedMessageId,
    originalMessageId,
    timestamp: Date.now(),
  });

  logger.debug(
    `[PluralKitReplyTracker] Tracked pending reply in channel ${channelId} from user ${userId} to personality ${personality.fullName}`
  );

  // Keep array size reasonable
  if (replies.length > 10) {
    replies.shift();
  }
}

/**
 * Find and remove a matching pending reply
 * @param {string} channelId - Channel ID
 * @param {string} webhookContent - Content from the webhook message
 * @returns {Object|null} The pending reply context or null
 */
function findPendingReply(channelId, webhookContent) {
  if (!pendingReplies.has(channelId)) {
    return null;
  }

  const replies = pendingReplies.get(channelId);
  const now = Date.now();

  // Find a reply that:
  // 1. Is recent enough (within expiration time)
  // 2. Has content that could match after Pluralkit processing
  for (let i = 0; i < replies.length; i++) {
    const reply = replies[i];

    // Check if expired
    if (now - reply.timestamp > EXPIRATION_TIME) {
      continue;
    }

    // Check if the webhook content could be from this original message
    // Pluralkit strips proxy tags, so the webhook content should be contained in the original
    if (reply.content.includes(webhookContent)) {
      // Remove this reply from pending
      replies.splice(i, 1);

      logger.info(
        `[PluralKitReplyTracker] Found matching pending reply for webhook content in channel ${channelId}`
      );

      return reply;
    }
  }

  return null;
}

/**
 * Clean up expired pending replies
 */
function cleanup() {
  const now = Date.now();
  let totalCleaned = 0;

  for (const [channelId, replies] of pendingReplies.entries()) {
    const before = replies.length;
    const filtered = replies.filter(reply => now - reply.timestamp < EXPIRATION_TIME);

    if (filtered.length < before) {
      totalCleaned += before - filtered.length;

      if (filtered.length === 0) {
        pendingReplies.delete(channelId);
      } else {
        pendingReplies.set(channelId, filtered);
      }
    }
  }

  if (totalCleaned > 0) {
    logger.debug(`[PluralKitReplyTracker] Cleaned up ${totalCleaned} expired pending replies`);
  }
}

/**
 * Start cleanup interval
 * @param {Function} [intervalFn=setInterval] - Interval function (injectable for testing)
 */
function startCleanup(intervalFn = setInterval) {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  cleanupInterval = intervalFn(cleanup, 10000); // Every 10 seconds
}

/**
 * Stop cleanup interval
 */
function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Clear all pending replies (for testing)
 */
function clear() {
  pendingReplies.clear();
}

// Don't start cleanup automatically - let consuming modules control this
// This prevents test environment issues and follows timer patterns best practices

module.exports = {
  trackPendingReply,
  findPendingReply,
  startCleanup,
  stopCleanup,
  clear,
  cleanup,
};
