/**
 * Webhook Manager
 *
 * This module handles all interaction with Discord webhooks, including:
 * - Creating and caching webhook clients
 * - Formatting and sending messages via webhooks
 * - Error handling and recovery
 * - Rate limiting and message ordering
 * - Avatar URL validation and caching
 *
 * TODO: Future improvements
 * - Implement retry mechanism for transient webhook failures
 * - Add more robust rate limiting to prevent Discord API throttling
 * - Enhance error classification for better debugging
 * - Consider implementing webhook rotation for high-volume channels
 */

const logger = require('./logger');
const {
  processMediaForWebhook,
  prepareAttachmentOptions,
} = require('./utils/media');
const webhookCache = require('./utils/webhookCache');
const messageDeduplication = require('./utils/messageDeduplication');
const avatarManager = require('./utils/avatarManager');
const messageFormatter = require('./utils/messageFormatter');
const { prepareAndSplitMessage, chunkHelpers } = require('./utils/messageSplitting');

// Import extracted modules
const webhookModules = require('./webhook');

// Map to track active webhook messages (channel id -> message info)
const activeWebhookMessages = new Map();

// We no longer use a fallback avatar URL - Discord will handle this automatically

// Discord message size limits are now handled by messageFormatter module

// Injectable delay function for testability
let delayFn = ms => {
  // Use global timer - can be overridden for testing
  const timer = globalThis.setTimeout || setTimeout;
  return new Promise(resolve => timer(resolve, ms));
};

// Injectable scheduler function for testability
let schedulerFn = globalThis.setTimeout || setTimeout;

// Function to override the delay for testing
function setDelayFunction(fn) {
  delayFn = fn;
}

// Function to override the scheduler for testing
function setSchedulerFunction(fn) {
  schedulerFn = fn;
}

// Re-export functions from extracted modules for backward compatibility
const {
  // Thread handling
  sendDirectThreadMessage: _sendDirectThreadMessage,

  // Message throttling
  createPersonalityChannelKey,
  hasPersonalityPendingMessage,
  registerPendingMessage,
  clearPendingMessage,
  calculateMessageDelay,
  updateChannelLastMessageTime,

  // DM handling
  sendFormattedMessageInDM: _sendFormattedMessageInDM,

  // Message utilities
  getStandardizedUsername,
  generateMessageTrackingId: _generateMessageTrackingId,
  prepareMessageData,
  createVirtualResult,
  sendMessageChunk: _sendMessageChunk,
  minimizeConsoleOutput,
  restoreConsoleOutput,

  // Constants
  MAX_ERROR_WAIT_TIME: _MAX_ERROR_WAIT_TIME,
  MIN_MESSAGE_DELAY: _MIN_MESSAGE_DELAY,
} = webhookModules;

// Avatar URL validation moved to avatarManager module
const validateAvatarUrl = avatarManager.validateAvatarUrl;

// Get valid avatar URL function moved to avatarManager module
const getValidAvatarUrl = avatarManager.getValidAvatarUrl;

// Avatar warmup function moved to avatarManager module
const warmupAvatarUrl = avatarManager.warmupAvatarUrl;

/**
 * Get or create a webhook for a specific channel
 * This function now delegates to the webhookCache module
 * @param {Object} channel - Discord.js channel object
 * @returns {Promise<WebhookClient>} The webhook client
 */
async function getOrCreateWebhook(channel) {
  return webhookCache.getOrCreateWebhook(channel);
}

/**
 * Wrapper for sendDirectThreadMessage that includes injected dependencies
 */
async function sendDirectThreadMessage(channel, content, personality, options = {}) {
  return _sendDirectThreadMessage(
    channel,
    content,
    personality,
    options,
    getStandardizedUsername,
    createVirtualResult,
    delayFn
  );
}

/**
 * Wrapper for sendFormattedMessageInDM that includes injected dependencies
 */
async function sendFormattedMessageInDM(channel, content, personality, options = {}) {
  return _sendFormattedMessageInDM(channel, content, personality, options, delayFn);
}

/**
 * Generate a unique message tracking ID
 * Wrapper that maintains backward compatibility
 */
function generateMessageTrackingId(channelId) {
  // For backward compatibility, create a fake personality object
  return _generateMessageTrackingId(null, channelId);
}

/**
 * Send a message chunk using webhook
 * Wrapper that maintains the original interface
 */
async function sendMessageChunk(webhook, messageData, chunkIndex, totalChunks) {
  return _sendMessageChunk(webhook, messageData, chunkIndex, totalChunks);
}

/**
 * Hash a message content to create a unique identifier
 * This function now delegates to the messageDeduplication module
 * @param {string} content - The message content
 * @param {string} username - The username sending the message
 * @param {string} channelId - The channel ID
 * @returns {string} - A hash representing this message
 */
function hashMessage(content, username, channelId) {
  return messageDeduplication.hashMessage(content, username, channelId);
}

/**
 * Check if a message is a duplicate of recently sent messages
 * This function now delegates to the messageDeduplication module
 * @param {string} content - Message content
 * @param {string} username - Username sending the message
 * @param {string} channelId - Channel ID
 * @returns {boolean} - True if this appears to be a duplicate
 */
function isDuplicateMessage(content, username, channelId) {
  return messageDeduplication.isDuplicateMessage(content, username, channelId);
}

/**
 * Find channel ID for a webhook (utility function)
 * @param {Object} webhook - The webhook client
 * @returns {string|null} - The channel ID if found
 */
function _findChannelIdForWebhook(webhook) {
  // Search through the webhook cache using the exposed cache for testing
  const cache = webhookCache._webhookCache || new Map();
  for (const [channelId, cachedWebhook] of cache.entries()) {
    if (cachedWebhook === webhook) {
      return channelId;
    }
  }
  return null;
}

/**
 * Send a webhook message with all the proper handling
 * @param {Object} channel - Discord channel object
 * @param {string} content - Message content
 * @param {Object} personality - Personality object with name and avatar
 * @param {Object} options - Additional options (embeds, files, etc.)
 * @param {Object} message - Original message object (optional)
 * @returns {Promise<Object>} The sent message
 */
async function sendWebhookMessage(channel, content, personality, options = {}, message = null) {
  // If this is a DM channel, use formatted message approach
  if (channel.isDMBased && channel.isDMBased()) {
    return await sendFormattedMessageInDM(channel, content, personality, options);
  }

  // If this is a thread, use direct thread message approach for better reliability
  if (channel.isThread && channel.isThread()) {
    logger.info(`[WebhookManager] Using optimized thread approach for thread ${channel.id}`);
    return await sendDirectThreadMessage(channel, content, personality, options);
  }

  const originalFunctions = minimizeConsoleOutput();

  try {
    const messageTrackingId = generateMessageTrackingId(channel.id);

    // Check if this personality already has a pending message in this channel
    if (personality && personality.fullName) {
      if (hasPersonalityPendingMessage(personality.fullName, channel.id)) {
        logger.warn(
          `[Webhook] Personality ${personality.fullName} already has pending message in channel ${channel.id}`
        );
        // Return a virtual result to prevent hanging promises
        return createVirtualResult(personality, channel.id);
      }

      // Register this as a pending message
      registerPendingMessage(personality.fullName, channel.id, messageTrackingId);
    }

    // Wait based on channel throttling to maintain message order
    const delayNeeded = calculateMessageDelay(channel.id);
    if (delayNeeded > 0) {
      logger.info(`[Webhook] Waiting ${delayNeeded}ms before sending to maintain message order`);
      await delayFn(delayNeeded);
    }

    // Update the last message time for this channel
    updateChannelLastMessageTime(channel.id);

    // Get or create webhook
    const webhook = await getOrCreateWebhook(channel);

    // Get the standardized username for consistent display
    const standardizedName = getStandardizedUsername(personality);

    logger.info(
      `[Webhook] Preparing to send message as ${standardizedName} to ${channel.name || channel.id}`
    );

    try {
      // Track that we're sending a message
      activeWebhookMessages.set(messageTrackingId, {
        channelId: channel.id,
        personality: personality.fullName,
        timestamp: Date.now(),
      });

      // Process any media URLs in the content using the shared mediaHandler
      let processedContent = content;
      let mediaAttachments = [];
      let isMultimodalContent = false;
      let multimodalTextContent = '';
      let multimodalImageUrl = null;
      let multimodalAudioUrl = null;

      // Check if content is a multimodal array
      if (Array.isArray(content) && content.length > 0) {
        isMultimodalContent = true;
        logger.info(`[Webhook] Detected multimodal content array with ${content.length} items`);

        // Extract text content and media URLs from multimodal array
        content.forEach(item => {
          if (item.type === 'text') {
            multimodalTextContent += item.text + '\n';
          } else if (item.type === 'image_url' && item.image_url?.url) {
            multimodalImageUrl = item.image_url.url;
            logger.info(`[Webhook] Found image URL in multimodal content: ${multimodalImageUrl}`);
          } else if (item.type === 'audio_url' && item.audio_url?.url) {
            multimodalAudioUrl = item.audio_url.url;
            logger.info(`[Webhook] Found audio URL in multimodal content: ${multimodalAudioUrl}`);
          }
        });

        // Use the text content for the main message
        processedContent = multimodalTextContent.trim() || "Here's the media you requested:";
        logger.info(
          `[Webhook] Extracted text content from multimodal array: ${processedContent.substring(0, 50)}...`
        );
      } else {
        try {
          // Process media URLs (images, audio, etc.)
          if (typeof content === 'string') {
            logger.debug(`[Webhook] Processing media in message content`);
            const mediaResult = await processMediaForWebhook(content);
            processedContent = mediaResult.content;
            mediaAttachments = mediaResult.attachments;

            if (mediaAttachments.length > 0) {
              logger.info(`[Webhook] Processed ${mediaAttachments.length} media URLs`);
            }
          }
        } catch (error) {
          logger.error(`[Webhook] Error processing media: ${error.message}`);
          // Continue with original content if media processing fails
          processedContent = content;
          mediaAttachments = [];
        }
      }

      // Use common splitting utility
      const contentChunks = prepareAndSplitMessage(processedContent, options, 'Webhook');

      const sentMessageIds = [];
      let firstSentMessage = null;

      // Send each chunk as a separate message
      for (let i = 0; i < contentChunks.length; i++) {
        const isFirstChunk = chunkHelpers.isFirstChunk(i);
        const isLastChunk = chunkHelpers.isLastChunk(i, contentChunks.length);
        const finalContent = contentChunks[i];

        // Skip if this exact message was recently sent
        if (isDuplicateMessage(finalContent, standardizedName, channel.id)) {
          logger.info(`[Webhook] Skipping duplicate message chunk ${i + 1}`);
          continue;
        }

        // Add delay between chunks to maintain order
        if (i > 0) {
          const delay = chunkHelpers.getChunkDelay();
          logger.info(`[Webhook] Waiting ${delay}ms between chunks`);
          await delayFn(delay);
        }

        // Prepare the send options
        const sendOptions = {};

        // Only include embeds and attachments in the last chunk for non-multimodal content
        if (isLastChunk && !isMultimodalContent) {
          if (options.embeds) {
            sendOptions.embeds = options.embeds;
          }

          // Add files from options if provided
          if (options.files) {
            sendOptions.files = options.files;
          }

          // Add media attachments to the last chunk
          if (mediaAttachments.length > 0) {
            const attachmentOptions = prepareAttachmentOptions(mediaAttachments);
            Object.assign(sendOptions, attachmentOptions);
          }
        }

        // Add the original channel reference if available (for error tracking)
        if (channel) {
          sendOptions._originalChannel = channel;
        }

        // Prepare message data for sending
        const messageData = prepareMessageData(
          finalContent,
          standardizedName,
          personality,
          channel.isThread(),
          channel.id,
          sendOptions
        );

        try {
          // Send the message chunk
          const sentMessage = await sendMessageChunk(webhook, messageData, i, contentChunks.length);

          // Track the message ID
          sentMessageIds.push(sentMessage.id);

          // Keep track of the first message
          if (isFirstChunk) {
            firstSentMessage = sentMessage;
          }
        } catch (error) {
          // Handle thread-specific errors with special recovery
          if (channel.isThread() && error.message.includes('thread')) {
            logger.error(`[Webhook] Thread-specific error detected: ${error.message}`);

            // Clear all webhook cache entries related to this thread
            logger.info(`[Webhook] Clearing thread webhook cache for thread ${channel.id}`);
            clearWebhookCache(channel.id);
            // Also clear the thread-specific cache entry
            if (webhookCache._webhookCache) {
              webhookCache._webhookCache.delete(`thread-${channel.id}`);
            }

            // Try to recreate the webhook immediately for the next chunk
            try {
              logger.info(`[Webhook] Attempting immediate webhook recreation for thread`);
              await getOrCreateWebhook(channel);
              logger.info(`[Webhook] Successfully recreated webhook for thread`);
            } catch (recreateError) {
              logger.error(`[Webhook] Failed to recreate webhook: ${recreateError.message}`);
            }
          }

          // If this is the first chunk and it failed, propagate the error
          if (isFirstChunk) {
            throw error;
          }
          // Otherwise, continue with the remaining chunks
        }
      }

      // For multimodal content, send media as separate messages
      if (isMultimodalContent) {
        logger.info(`[Webhook] Sending multimodal media as separate messages`);
        const mediaDelay = 750; // Delay between text and media messages to prevent Discord issues

        // Send audio if present (always send audio first due to API limitations)
        if (multimodalAudioUrl) {
          try {
            // Add a small delay
            await delayFn(mediaDelay);

            // Use the audio URL
            const audioUrl = multimodalAudioUrl;

            // Create message data for audio
            const audioMessageData = prepareMessageData(
              `[Audio: ${audioUrl}]`, // Use special format that our media handler detects
              standardizedName,
              personality,
              channel.isThread(),
              channel.id,
              { _originalChannel: channel }
            );

            // Send the audio message
            logger.info(`[Webhook] Sending audio as separate message: ${audioUrl}`);
            const audioMessage = await sendMessageChunk(webhook, audioMessageData, 0, 1);
            sentMessageIds.push(audioMessage.id);
            logger.info(`[Webhook] Successfully sent audio message with ID: ${audioMessage.id}`);
          } catch (error) {
            logger.error(`[Webhook] Error sending audio message: ${error.message}`);
            // Continue even if audio message fails
          }
        }

        // Send image if present and no audio (to ensure we don't overwhelm the user with media)
        if (multimodalImageUrl && !multimodalAudioUrl) {
          try {
            // Add a small delay
            await delayFn(mediaDelay);

            // Use the image URL
            const imageUrl = multimodalImageUrl;

            // Create message data for image
            const imageMessageData = prepareMessageData(
              `[Image: ${imageUrl}]`, // Use special format that our media handler detects
              standardizedName,
              personality,
              channel.isThread(),
              channel.id,
              { _originalChannel: channel }
            );

            // Send the image message
            logger.info(`[Webhook] Sending image as separate message: ${imageUrl}`);
            const imageMessage = await sendMessageChunk(webhook, imageMessageData, 0, 1);
            sentMessageIds.push(imageMessage.id);
            logger.info(`[Webhook] Successfully sent image message with ID: ${imageMessage.id}`);
          } catch (error) {
            logger.error(`[Webhook] Error sending image message: ${error.message}`);
            // Continue even if image message fails
          }
        }
      }

      // Clean up tracking after a short delay
      schedulerFn(() => {
        activeWebhookMessages.delete(messageTrackingId);
      }, 5000);

      // Clear pending message
      if (personality && personality.fullName) {
        clearPendingMessage(personality.fullName, channel.id);
      }

      // Log result information
      logger.info(`[Webhook] Returning result with: ${sentMessageIds.length} message IDs:`);
      sentMessageIds.forEach(id => logger.debug(`[Webhook] Message ID: ${id}`));

      // Return results or create a virtual result if needed
      if (sentMessageIds.length > 0) {
        return {
          message: firstSentMessage,
          messageIds: sentMessageIds,
        };
      } else {
        return createVirtualResult(personality, channel.id);
      }
    } catch (error) {
      // Clean up on error
      activeWebhookMessages.delete(messageTrackingId);
      throw error;
    }
  } catch (error) {
    logger.error(`Webhook error: ${error.message}`);

    // If webhook is invalid, remove from cache
    if (error.code === 10015) {
      // Unknown Webhook
      clearWebhookCache(channel.id);
    }

    // Clear pending message to prevent hanging states
    if (personality && personality.fullName) {
      clearPendingMessage(personality.fullName, channel.id);
    }

    // Restore console functions
    restoreConsoleOutput(originalFunctions);

    throw error;
  } finally {
    // Always restore console functions
    restoreConsoleOutput(originalFunctions);
  }
}

/**
 * Clear webhook cache for a specific channel
 * This function now delegates to the webhookCache module
 * @param {string} channelId - Discord channel ID
 */
function clearWebhookCache(channelId) {
  return webhookCache.clearWebhookCache(channelId);
}

/**
 * Clear all webhook caches
 * This function now delegates to the webhookCache module
 */
function clearAllWebhookCaches() {
  return webhookCache.clearAllWebhookCaches();
}

/**
 * Register event listeners for Discord client
 * @param {Object} discordClient - The Discord.js client
 */
function registerEventListeners(discordClient) {
  // Channel deletion handling moved to webhookCache module
  webhookCache.registerEventListeners(discordClient);
}

/**
 * Preload a personality's avatar URL to ensure it's valid and cached
 * This is useful to call after registering a new personality
 * @param {Object} personality - Personality object with avatarUrl
 */
async function preloadPersonalityAvatar(personality) {
  return avatarManager.preloadPersonalityAvatar(personality);
}

module.exports = {
  // Main webhook API functions
  getOrCreateWebhook,
  sendWebhookMessage,
  clearWebhookCache,
  clearAllWebhookCaches,
  registerEventListeners,
  preloadPersonalityAvatar,
  sendFormattedMessageInDM,
  sendDirectThreadMessage,

  // Testing utilities
  setDelayFunction,
  setSchedulerFunction,

  // Helper functions for usernames and messages
  getStandardizedUsername,
  isDuplicateMessage,
  hashMessage,

  // Console handling functions
  minimizeConsoleOutput,
  restoreConsoleOutput,

  // Message content processing
  prepareMessageData,
  sendMessageChunk,
  createVirtualResult,
  generateMessageTrackingId,

  // Message throttling functions
  hasPersonalityPendingMessage,
  registerPendingMessage,
  clearPendingMessage,
  calculateMessageDelay,
  updateChannelLastMessageTime,
  createPersonalityChannelKey,

  // Avatar URL handling
  validateAvatarUrl,
  getValidAvatarUrl,
  warmupAvatarUrl,
};
