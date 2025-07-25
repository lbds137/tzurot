/**
 * DM Message Handler
 *
 * Handles direct message formatting and sending for AI personalities
 * DMs don't support webhooks, so we format messages manually
 */

const logger = require('../logger');
const { processMediaForWebhook, prepareAttachmentOptions } = require('../utils/media');
const { prepareAndSplitMessage, chunkHelpers } = require('../utils/messageSplitting');

// Default delay function using global timer
const defaultDelay = ms => {
  const timer = globalThis.setTimeout || setTimeout;
  return new Promise(resolve => timer(resolve, ms));
};

/**
 * Send a formatted message in a DM channel
 * @param {Object} channel - Discord DM channel
 * @param {string|Array} content - Message content (string or multimodal array)
 * @param {Object} personality - Personality data
 * @param {Object} options - Additional options (embeds, etc.)
 * @param {Function} delayFn - Delay function for testing
 * @returns {Promise<Object>} Result with message and messageIds
 */
async function sendFormattedMessageInDM(
  channel,
  content,
  personality,
  options = {},
  delayFn = defaultDelay
) {
  try {
    // For DMs, use just the personality name without the suffix
    // This creates a cleaner experience in DMs
    let displayName;
    if (personality.displayName) {
      displayName = personality.displayName;
    } else if (personality.fullName) {
      // Extract name from fullName if needed
      const parts = personality.fullName.split('-');
      if (parts.length > 0 && parts[0].length > 0) {
        // Capitalize first letter for nicer display
        displayName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      } else {
        displayName = personality.fullName;
      }
    } else {
      displayName = 'Bot';
    }

    // Process any media URLs in the content using the shared mediaHandler
    let processedContent = content;
    let mediaAttachments = [];
    let isMultimodalContent = false;
    let multimodalTextContent = '';
    let multimodalImageUrl = null;
    let multimodalAudioUrl = null;

    // Check for referenced media markers in the text content
    // Updated to use a more robust marker extraction method
    let _hasReferencedMedia = false;
    let referencedMediaType = null;
    let referencedMediaUrl = null;

    if (typeof content === 'string' && content.includes('[REFERENCE_MEDIA:')) {
      const startMarker = content.indexOf('[REFERENCE_MEDIA:');
      if (startMarker !== -1) {
        const endMarker = content.indexOf(']', startMarker);
        if (endMarker !== -1) {
          // Extract the whole marker
          const fullMarker = content.substring(startMarker, endMarker + 1);

          // Parse the marker
          const markerParts = fullMarker.substring(17, fullMarker.length - 1).split(':');
          if (markerParts.length >= 2) {
            _hasReferencedMedia = true;
            referencedMediaType = markerParts[0]; // 'image' or 'audio'
            referencedMediaUrl = markerParts.slice(1).join(':'); // Rejoin to handle URLs with colons

            logger.info(
              `[DM Handler] Found referenced media marker: ${referencedMediaType} at ${referencedMediaUrl}`
            );

            // Remove the marker from the content
            processedContent = content.replace(fullMarker, '').trim();
            logger.info(
              `[DM Handler] After removing marker, content is now: "${processedContent.substring(0, 100)}..."`
            );

            // Set multimodal flags for consistent handling
            isMultimodalContent = true;
            if (referencedMediaType === 'image') {
              multimodalImageUrl = referencedMediaUrl;
              logger.info(`[DM Handler] Set multimodalImageUrl=${referencedMediaUrl}`);
            } else if (referencedMediaType === 'audio') {
              multimodalAudioUrl = referencedMediaUrl;
              logger.info(`[DM Handler] Set multimodalAudioUrl=${referencedMediaUrl}`);
            }
          }
        }
      }
    }
    // Check if content is a multimodal array
    else if (Array.isArray(content) && content.length > 0) {
      isMultimodalContent = true;
      logger.info(`[DM Handler] Detected multimodal content array with ${content.length} items`);

      // Extract text content and media URLs from multimodal array
      content.forEach(item => {
        if (item.type === 'text') {
          multimodalTextContent += item.text + '\n';
        } else if (item.type === 'image_url' && item.image_url?.url) {
          multimodalImageUrl = item.image_url.url;
          logger.info(`[DM Handler] Found image URL in multimodal content: ${multimodalImageUrl}`);
        } else if (item.type === 'audio_url' && item.audio_url?.url) {
          multimodalAudioUrl = item.audio_url.url;
          logger.info(`[DM Handler] Found audio URL in multimodal content: ${multimodalAudioUrl}`);
        }
      });

      // Use the text content for the main message
      processedContent = multimodalTextContent.trim() || "Here's the media you requested:";
      logger.info(
        `[DM Handler] Extracted text content from multimodal array: ${processedContent.substring(0, 50)}...`
      );
    } else {
      try {
        // Process media URLs (images, audio, etc.)
        if (typeof content === 'string') {
          logger.debug(`[DM Handler] Processing media in message content`);
          const mediaResult = await processMediaForWebhook(content);
          processedContent = mediaResult.content;
          mediaAttachments = mediaResult.attachments;

          if (mediaAttachments.length > 0) {
            logger.info(`[DM Handler] Processed ${mediaAttachments.length} media URLs`);
          }
        }
      } catch (error) {
        logger.error(`[DM Handler] Error processing media: ${error.message}`);
        // Continue with original content if media processing fails
        processedContent = content;
        mediaAttachments = [];
      }
    }

    // Prepare the formatted content with name prefix
    const formattedContent = `**${displayName}:** ${processedContent}`;

    // Use common splitting utility
    const contentChunks = prepareAndSplitMessage(formattedContent, options, 'DM Handler');

    const sentMessageIds = [];
    let firstSentMessage = null;

    // Send each chunk as a separate message
    for (let i = 0; i < contentChunks.length; i++) {
      const isFirstChunk = chunkHelpers.isFirstChunk(i);
      const isLastChunk = chunkHelpers.isLastChunk(i, contentChunks.length);
      const chunkContent = contentChunks[i];

      // Add a delay between chunks to prevent Discord from merging/replacing them
      if (i > 0) {
        await delayFn(chunkHelpers.getChunkDelay());
      }

      // Prepare options for the message
      const sendOptions = {};

      // Only include embeds and attachments in the last chunk for non-multimodal content
      if (isLastChunk && !isMultimodalContent) {
        if (options.embeds) {
          sendOptions.embeds = options.embeds;
        }

        // Add media attachments to the last chunk
        if (mediaAttachments.length > 0) {
          const attachmentOptions = prepareAttachmentOptions(mediaAttachments);
          Object.assign(sendOptions, attachmentOptions);
        }
      }

      // Send the message to the DM channel
      const sentMessage = await channel.send({
        content: chunkContent,
        ...sendOptions,
      });

      // Track sent messages
      sentMessageIds.push(sentMessage.id);

      // Keep first message for return value
      if (isFirstChunk) {
        firstSentMessage = sentMessage;
      }
    }

    // For multimodal content, send media as separate messages in DMs
    if (isMultimodalContent) {
      logger.info(`[DM Handler] Sending multimodal media as separate messages`);
      const mediaDelay = 750; // Delay between text and media messages to prevent Discord issues

      // Send audio if present (always prioritize audio over image)
      if (multimodalAudioUrl) {
        try {
          // Add a small delay
          await delayFn(mediaDelay);

          // Send the audio message with the personality name prefix
          const audioContent = `**${displayName}:** [Audio: ${multimodalAudioUrl}]`;
          logger.info(`[DM Handler] Sending audio as separate message: ${multimodalAudioUrl}`);

          const audioMessage = await channel.send({
            content: audioContent,
          });

          sentMessageIds.push(audioMessage.id);
          logger.info(`[DM Handler] Successfully sent audio message with ID: ${audioMessage.id}`);
        } catch (error) {
          logger.error(`[DM Handler] Error sending audio message: ${error.message}`);
          // Continue even if audio message fails
        }
      }

      // Send image if present and no audio (to ensure we don't overwhelm the user with media)
      if (multimodalImageUrl && !multimodalAudioUrl) {
        try {
          // Add a small delay
          await delayFn(mediaDelay);

          // Send the image message with the personality name prefix
          const imageContent = `**${displayName}:** [Image: ${multimodalImageUrl}]`;
          logger.info(`[DM Handler] Sending image as separate message: ${multimodalImageUrl}`);

          const imageMessage = await channel.send({
            content: imageContent,
          });

          sentMessageIds.push(imageMessage.id);
          logger.info(`[DM Handler] Successfully sent image message with ID: ${imageMessage.id}`);
        } catch (error) {
          logger.error(`[DM Handler] Error sending image message: ${error.message}`);
          // Continue even if image message fails
        }
      }
    }

    logger.info(`[DM Handler] Successfully sent DM with ${sentMessageIds.length} messages`);

    // Return result
    return {
      message: firstSentMessage,
      messageIds: sentMessageIds,
      isDM: true,
      personalityName: personality.fullName,
    };
  } catch (error) {
    logger.error(`[DM Handler] Failed to send formatted DM: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendFormattedMessageInDM,
};
