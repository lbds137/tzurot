/**
 * Utility for processing media in messages
 * 
 * This module handles media processing for both webhook and DM messages:
 * - Processes audio URLs and files
 * - Processes image URLs and files
 * - Extracts media from message content
 * - Creates appropriate attachments
 * 
 * This centralizes media handling to ensure consistent behavior
 * between webhook messages and DM messages.
 */

const logger = require('../logger');
const audioHandler = require('./audioHandler');
const imageHandler = require('./imageHandler');

/**
 * Process media URLs in content and create appropriate attachments
 * @param {string} content - Message content to process
 * @returns {Promise<Object>} - Object with processed content and attachments
 */
async function processMediaUrls(content) {
  if (!content || typeof content !== 'string') {
    return { content, attachments: [] };
  }

  try {
    // First check for audio URLs (audio takes priority over images)
    logger.debug(`[MediaHandler] Checking for audio URLs in message content`);
    const { content: audioProcessedContent, attachments: audioAttachments } =
      await audioHandler.processAudioUrls(content);
    
    if (audioAttachments.length > 0) {
      // If we found audio, use that
      logger.info(`[MediaHandler] Processed ${audioAttachments.length} audio URLs into attachments`);
      return {
        content: audioProcessedContent,
        attachments: audioAttachments,
      };
    }
    
    // If no audio found, check for image URLs
    logger.debug(`[MediaHandler] Checking for image URLs in message content`);
    const { content: imageProcessedContent, attachments: imageAttachments } =
      await imageHandler.processImageUrls(content);
    
    if (imageAttachments.length > 0) {
      logger.info(`[MediaHandler] Processed ${imageAttachments.length} image URLs into attachments`);
      return {
        content: imageProcessedContent,
        attachments: imageAttachments,
      };
    }

    // No media found, return original content
    return { content, attachments: [] };
  } catch (error) {
    logger.error(`[MediaHandler] Error processing media URLs: ${error.message}`);
    // Continue with original content if there's an error
    return { content, attachments: [] };
  }
}

/**
 * Converts Discord.js attachment options into Discord.js MessagePayload options
 * @param {Array<Object>} attachments - Array of attachment objects
 * @returns {Object} Discord.js message options with files
 */
function prepareAttachmentOptions(attachments) {
  if (!attachments || attachments.length === 0) {
    return {};
  }

  return {
    files: attachments.map(attachment => ({
      attachment: attachment.attachment,
      name: attachment.name,
      contentType: attachment.contentType
    }))
  };
}

module.exports = {
  processMediaUrls,
  prepareAttachmentOptions
};