/**
 * Thread Handler Module
 *
 * Handles thread-specific functionality for Discord messages.
 * This includes:
 * - Thread detection (native and forced)
 * - Thread-specific webhook options
 * - Forum channel handling
 * - Thread message delivery with fallback strategies
 */

const logger = require('../logger');

/**
 * Channel types that should be treated as threads
 */
const THREAD_CHANNEL_TYPES = [
  'GUILD_PUBLIC_THREAD',
  'GUILD_PRIVATE_THREAD',
  'PUBLIC_THREAD',
  'PRIVATE_THREAD',
  'FORUM',
  11, // ChannelType.GuildPublicThread
  12, // ChannelType.GuildPrivateThread
  15, // ChannelType.GuildForum
  16, // ChannelType.GuildMediaForum
];

/**
 * Forum channel types
 */
const FORUM_CHANNEL_TYPES = ['FORUM', 15, 16];

/**
 * Detect if a channel is a thread
 * @param {Object} channel - Discord channel object
 * @returns {Object} Thread detection result
 */
function detectThread(channel) {
  // Native thread detection
  const isNativeThread = channel.isThread?.() || false;

  // Force thread detection for certain channel types
  const isThreadType = THREAD_CHANNEL_TYPES.includes(channel.type);

  // Final determination
  const isThread = isNativeThread || isThreadType;

  // Log detailed information for debugging
  if (isThread) {
    logger.info(`[ThreadHandler] Thread detected! ID: ${channel.id}, Type: ${channel.type}`);

    if (channel.parent) {
      logger.info(
        `[ThreadHandler] Parent channel - ID: ${channel.parent.id}, Name: ${channel.parent.name}, Type: ${channel.parent.type}`
      );
    } else if (isThreadType && !isNativeThread) {
      logger.warn(
        `[ThreadHandler] Thread type detected but parent unavailable - this might cause issues!`
      );
    }
  }

  // Log if detection was forced
  if (isThreadType && !isNativeThread) {
    logger.info(
      `[ThreadHandler] Thread detection was forced based on channel type (${channel.type}), native isThread() returned false`
    );
  }

  return {
    isThread,
    isNativeThread,
    isForcedThread: isThreadType && !isNativeThread,
    channelType: channel.type,
  };
}

/**
 * Check if a channel is a forum or forum thread
 * @param {Object} channel - Discord channel object
 * @returns {boolean} True if forum-related
 */
function isForumChannel(channel) {
  // Direct forum channel check
  if (FORUM_CHANNEL_TYPES.includes(channel.type)) {
    return true;
  }

  // Check if parent is a forum
  if (channel.parent && FORUM_CHANNEL_TYPES.includes(channel.parent.type)) {
    return true;
  }

  return false;
}

/**
 * Build webhook options for thread messages
 * @param {Object} channel - Discord channel object
 * @param {string} userId - User ID for tracking
 * @param {Object} threadInfo - Thread detection info
 * @param {boolean} isReplyToDMFormattedMessage - Special DM reply flag
 * @returns {Object} Webhook options
 */
function buildThreadWebhookOptions(
  channel,
  userId,
  threadInfo,
  isReplyToDMFormattedMessage = false
) {
  const options = {
    userId,
    channelType: channel.type,
    isReplyToDMFormattedMessage,
  };

  // Add thread-specific options
  if (threadInfo.isThread) {
    options.threadId = channel.id;

    // Validate thread ID
    if (!options.threadId) {
      logger.error(
        '[ThreadHandler] Error: Thread detected but threadId is not set in webhookOptions'
      );
      options.threadId = channel.id; // Force set as fallback
    }
  }

  // Add forum-specific options
  if (isForumChannel(channel)) {
    options.isForum = true;
    options.forum = true;
    options.forumThreadId = channel.id;
    logger.info(`[ThreadHandler] Forum channel detected - added forum-specific options`);
  }

  logger.info(`[ThreadHandler] Built webhook options: ${JSON.stringify(options)}`);
  return options;
}

/**
 * Send a message in a thread with fallback strategies
 * @param {Object} webhookManager - Webhook manager instance
 * @param {Object} channel - Discord channel object
 * @param {string} content - Message content
 * @param {Object} personality - Personality data
 * @param {Object} webhookOptions - Webhook options
 * @param {Object} originalMessage - Original message for context
 * @returns {Promise<Object>} Result with message IDs
 */
async function sendThreadMessage(
  webhookManager,
  channel,
  content,
  personality,
  webhookOptions,
  originalMessage
) {
  let result;

  try {
    // First, try specialized direct thread message function
    logger.info('[ThreadHandler] Attempting sendDirectThreadMessage');
    result = await webhookManager.sendDirectThreadMessage(
      channel,
      content,
      personality,
      webhookOptions
    );

    logger.info(
      `[ThreadHandler] Direct thread message sent successfully with ID: ${result.messageIds?.[0] || 'unknown'}`
    );
    return result;
  } catch (threadError) {
    logger.error(`[ThreadHandler] Direct thread message approach failed: ${threadError.message}`);
    logger.info('[ThreadHandler] Falling back to standard webhook approach');

    // Fallback to regular webhook approach
    try {
      result = await webhookManager.sendWebhookMessage(
        channel,
        content,
        personality,
        webhookOptions,
        originalMessage
      );
      return result;
    } catch (webhookError) {
      logger.error(
        `[ThreadHandler] Both thread delivery approaches failed! Error: ${webhookError.message}`
      );

      // Final fallback - use the channel's send method directly
      try {
        logger.info('[ThreadHandler] Attempting last resort direct channel.send');
        const formattedContent = `**${personality.displayName || personality.fullName}:** ${content}`;
        const directMessage = await channel.send(formattedContent);

        // Create a result object mimicking webhook result
        result = {
          message: directMessage,
          messageIds: [directMessage.id],
          isEmergencyFallback: true,
        };

        logger.info(`[ThreadHandler] Emergency direct send succeeded: ${directMessage.id}`);
        return result;
      } catch (finalError) {
        logger.error(`[ThreadHandler] ALL message delivery methods failed: ${finalError.message}`);
        throw finalError; // Re-throw the error if all approaches fail
      }
    }
  }
}

/**
 * Get detailed thread information for logging
 * @param {Object} channel - Discord channel object
 * @returns {Object} Thread information
 */
function getThreadInfo(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    isThread: channel.isThread?.(),
    parentId: channel.parentId || channel.parent?.id,
    parentName: channel.parent?.name,
    parentType: channel.parent?.type,
    isTextBased: channel.isTextBased?.(),
    isVoiceBased: channel.isVoiceBased?.(),
    isDMBased: channel.isDMBased?.(),
  };
}

module.exports = {
  detectThread,
  isForumChannel,
  buildThreadWebhookOptions,
  sendThreadMessage,
  getThreadInfo,
  THREAD_CHANNEL_TYPES,
  FORUM_CHANNEL_TYPES,
};
