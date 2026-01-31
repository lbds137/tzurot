/**
 * Message formatting utilities for Discord messages
 * Handles preparing message data for sending
 * 
 * Note: Message splitting functions have been moved to messageSplitting.js
 */

const { EmbedBuilder } = require('discord.js');
const logger = require('../logger');


/**
 * Prepare message data for sending via webhook
 * @param {string} content - Message content
 * @param {string} username - Standardized username
 * @param {string} avatarUrl - Avatar URL
 * @param {boolean} isThread - Whether the channel is a thread
 * @param {string} threadId - Thread ID if applicable
 * @param {Object} options - Additional options
 * @returns {Object} Prepared message data
 */
function prepareMessageData(content, username, avatarUrl, isThread, threadId, options = {}) {
  // Enhanced logging for thread troubleshooting
  if (isThread) {
    logger.info(`[MessageFormatter] Preparing message data for thread with ID: ${threadId}`);
    if (!threadId) {
      logger.warn('[MessageFormatter] Thread flagged as true but no threadId provided!');
    }
  }

  // Thread-specific handling
  const threadData = isThread
    ? {
        threadId,
        // Store information about the original channel for recovery attempts
        _isThread: true,
        _originalChannel: options._originalChannel, // Will be set by calling functions
      }
    : {};

  const messageData = {
    content: content,
    username: username,
    avatarURL: avatarUrl || null,
    allowedMentions: { parse: ['users', 'roles'] },
    ...threadData,
  };

  // Double-check threadId was properly set if isThread is true
  if (isThread && !messageData.threadId) {
    logger.error(
      '[MessageFormatter] Error: threadId not set properly in messageData despite isThread=true'
    );
  } else if (isThread) {
    logger.info(
      `[MessageFormatter] Successfully set threadId ${messageData.threadId} in messageData`
    );
  }

  // Add optional embed if provided
  if (options.embed) {
    messageData.embeds = [new EmbedBuilder(options.embed)];
  }

  // Add optional files if provided
  if (options.files) {
    messageData.files = options.files;
  }

  // Add audio attachments if provided
  if (options.attachments && options.attachments.length > 0) {
    // Initialize files array if it doesn't exist
    messageData.files = messageData.files || [];
    // Add attachments to files
    messageData.files.push(...options.attachments);
    logger.debug(
      `[MessageFormatter] Added ${options.attachments.length} audio attachments to message`
    );
  }

  return messageData;
}

module.exports = {
  prepareMessageData,
};