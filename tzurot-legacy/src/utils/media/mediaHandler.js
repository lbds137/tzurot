/**
 * Media Handling System
 *
 * This module provides a unified approach to media handling in the application:
 * - Detects media in user messages (images, audio)
 * - Processes media for AI requests (multimodal content)
 * - Processes media for webhook messages (attachments)
 * - Handles media in referenced messages
 *
 * The system maintains a clear separation between:
 * 1. Media detection (finding media in messages)
 * 2. Media processing (preparing media for different contexts)
 * 3. Media attachment creation (converting URLs to Discord attachments)
 */

const logger = require('../../logger');
const audioHandler = require('./audioHandler');
const imageHandler = require('./imageHandler');

/**
 * Detect and process media in a Discord message
 * This function centralizes all the media detection logic
 *
 * @param {Object} message - Discord.js message object
 * @param {string|Array} messageContent - Message content (string or multimodal array)
 * @param {Object} options - Additional options
 * @param {boolean} options.referencedAudioUrl - URL of audio in referenced message
 * @param {boolean} options.referencedImageUrl - URL of image in referenced message
 * @param {string} options.personalityName - Name of the personality handling the message
 * @param {string} options.userName - User's display name and username e.g. "Display Name (username)"
 * @returns {Promise<Object>} - Object with processed content and media info
 */
async function detectMedia(message, messageContent, options = {}) {
  // Initialize variables
  let hasFoundImage = false;
  let hasFoundAudio = false;
  let audioUrl = null;
  let imageUrl = null;
  let updatedMessageContent = messageContent;

  // Check if we have content with [Audio: url] pattern first
  if (typeof updatedMessageContent === 'string' && updatedMessageContent.includes('[Audio:')) {
    const audioMatch = updatedMessageContent.match(/\[Audio: (https?:\/\/[^\s\]]+)\]/);
    if (audioMatch && audioMatch[1]) {
      audioUrl = audioMatch[1];
      hasFoundAudio = true;
      logger.info(`[MediaHandler] Found audio URL in message content: ${audioUrl}`);

      // Remove the audio URL from the message content
      updatedMessageContent = updatedMessageContent.replace(audioMatch[0], '').trim();
    }
  }

  // Then check for [Image: url] pattern if no audio found
  if (
    !hasFoundAudio &&
    typeof updatedMessageContent === 'string' &&
    updatedMessageContent.includes('[Image:')
  ) {
    const imageMatch = updatedMessageContent.match(/\[Image: (https?:\/\/[^\s\]]+)\]/);
    if (imageMatch && imageMatch[1]) {
      imageUrl = imageMatch[1];
      hasFoundImage = true;
      logger.info(`[MediaHandler] Found image URL in message content: ${imageUrl}`);

      // Remove the image URL from the message content
      updatedMessageContent = updatedMessageContent.replace(imageMatch[0], '').trim();
    }
  }

  // Check message attachments if no media found yet
  if (!hasFoundImage && !hasFoundAudio && message.attachments && message.attachments.size > 0) {
    const attachments = Array.from(message.attachments.values());

    // Check for audio attachments first (priority over images)
    const audioAttachment = attachments.find(
      attachment =>
        (attachment.contentType && attachment.contentType.startsWith('audio/')) ||
        attachment.url?.endsWith('.mp3') ||
        attachment.url?.endsWith('.wav') ||
        attachment.url?.endsWith('.ogg')
    );

    if (audioAttachment) {
      audioUrl = audioAttachment.url;
      hasFoundAudio = true;
      logger.info(`[MediaHandler] Found audio attachment: ${audioUrl}`);
    } else {
      // Check for image attachments if no audio
      const imageAttachment = attachments.find(
        attachment => attachment.contentType && attachment.contentType.startsWith('image/')
      );

      if (imageAttachment) {
        imageUrl = imageAttachment.url;
        hasFoundImage = true;
        logger.info(`[MediaHandler] Found image attachment: ${imageUrl}`);
      }
    }
  }

  // Check message embeds if no media found yet
  if (!hasFoundImage && !hasFoundAudio && message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      // Check for audio URLs in description or fields - audio has priority
      const checkForAudioUrl = text => {
        if (!text) return null;
        const audioUrlRegex = /https?:\/\/\S+\.(mp3|wav|ogg|m4a)(\?\S*)?/i;
        const match = text.match(audioUrlRegex);
        return match ? match[0] : null;
      };

      // Check description for audio URL
      if (embed.description) {
        const foundAudioUrl = checkForAudioUrl(embed.description);
        if (foundAudioUrl) {
          audioUrl = foundAudioUrl;
          hasFoundAudio = true;
          logger.info(`[MediaHandler] Found audio URL in embed description: ${audioUrl}`);
          break;
        }
      }

      // Check fields for audio URL
      if (embed.fields && embed.fields.length > 0) {
        let foundAudio = false;
        for (const field of embed.fields) {
          const foundAudioUrl = checkForAudioUrl(field.value);
          if (foundAudioUrl) {
            audioUrl = foundAudioUrl;
            hasFoundAudio = true;
            logger.info(
              `[MediaHandler] Found audio URL in embed field '${field.name}': ${audioUrl}`
            );
            foundAudio = true;
            break;
          }
        }
        if (foundAudio) break;
      }

      // Next, check for image if no audio was found
      if (embed.image && embed.image.url) {
        imageUrl = embed.image.url;
        hasFoundImage = true;
        logger.info(`[MediaHandler] Found image in embed: ${imageUrl}`);
        break;
      }

      // If no image, check for thumbnail
      if (embed.thumbnail && embed.thumbnail.url) {
        imageUrl = embed.thumbnail.url;
        hasFoundImage = true;
        logger.info(`[MediaHandler] Found thumbnail in embed: ${imageUrl}`);
        break;
      }
    }
  }

  // Referenced media should be handled separately by aiService, not included in current message
  const useReferencedMedia = false;
  const referencedAudioUrl = options.referencedAudioUrl;
  const referencedImageUrl = options.referencedImageUrl;

  // Note: We no longer automatically include referenced media in the current message
  // Referenced media is handled separately in the aiService formatApiMessages function
  // This prevents duplication where both the current message and referenced message
  // would include the same media content

  // Create final multimodal content if we found media
  let finalContent = updatedMessageContent;

  if (hasFoundImage || hasFoundAudio) {
    // Create a multimodal content array
    const multimodalContent = [];

    // Add the text content if it exists
    if (typeof updatedMessageContent === 'string' && updatedMessageContent) {
      multimodalContent.push({
        type: 'text',
        text: updatedMessageContent,
      });
    } else if (
      !updatedMessageContent ||
      (Array.isArray(updatedMessageContent) && updatedMessageContent.length === 0)
    ) {
      // Default prompt based on media type
      if (hasFoundAudio) {
        const userName = options.userName || 'a user';

        // Simpler, cleaner voice message prompt
        const voicePrompt = `Voice message from ${userName}:`;

        multimodalContent.push({
          type: 'text',
          text: voicePrompt,
        });
      } else if (hasFoundImage) {
        multimodalContent.push({
          type: 'text',
          text: useReferencedMedia
            ? "What's in this image from the referenced message?"
            : "What's in this image?",
        });
      }
    } else if (Array.isArray(updatedMessageContent)) {
      // Copy any existing text elements from the multimodal array
      updatedMessageContent.forEach(item => {
        if (item.type === 'text') {
          multimodalContent.push(item);
        }
      });

      // If we didn't find any text elements, add default prompt
      if (!multimodalContent.some(item => item.type === 'text')) {
        multimodalContent.push({
          type: 'text',
          text: useReferencedMedia
            ? 'Please analyze this media from the referenced message'
            : 'Please analyze this media',
        });
      }
    }

    // Add the media content - prioritize audio over image if both are present
    // (per API limitation: only one media type is processed, with audio taking precedence)
    if (hasFoundAudio) {
      logger.info(`[MediaHandler] Processing audio with URL: ${audioUrl}`);
      multimodalContent.push({
        type: 'audio_url',
        audio_url: {
          url: audioUrl,
        },
      });
      logger.debug(`[MediaHandler] Added audio to multimodal content: ${audioUrl}`);

      // If we also found an image, log that we're ignoring it due to API limitation
      if (hasFoundImage) {
        logger.warn(
          `[MediaHandler] Ignoring image (${imageUrl}) - API only processes one media type per request, and audio takes precedence`
        );
      }
    } else if (hasFoundImage) {
      logger.info(`[MediaHandler] Processing image with URL: ${imageUrl}`);
      multimodalContent.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
        },
      });
      logger.debug(`[MediaHandler] Added image to multimodal content: ${imageUrl}`);
    }

    // Replace the message content with the multimodal array
    finalContent = multimodalContent;
    logger.info(`[MediaHandler] Created multimodal content with ${multimodalContent.length} items`);
  }

  return {
    messageContent: finalContent,
    hasFoundAudio,
    hasFoundImage,
    audioUrl,
    imageUrl,
    useReferencedMedia,
  };
}

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
      logger.info(
        `[MediaHandler] Processed ${audioAttachments.length} audio URLs into attachments`
      );
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
      logger.info(
        `[MediaHandler] Processed ${imageAttachments.length} image URLs into attachments`
      );
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
 * Process media URLs in message content for webhook sending
 * This leverages the existing processMediaUrls function which is optimized for webhook processing
 *
 * @param {string} content - Message content to process
 * @returns {Promise<Object>} - Object with processed content and attachments
 */
async function processMediaForWebhook(content) {
  return await processMediaUrls(content);
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
      contentType: attachment.contentType,
    })),
  };
}

module.exports = {
  detectMedia,
  processMediaUrls,
  processMediaForWebhook,
  prepareAttachmentOptions,
};
