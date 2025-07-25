/**
 * Webhook Thread Handler
 *
 * Handles all thread-specific webhook operations including:
 * - Creating thread-specific webhook clients
 * - Sending messages to threads with proper webhook aesthetics
 * - Managing thread-specific caching
 */

const logger = require('../logger');
const { isDuplicateMessage } = require('../utils/messageDeduplication');
const { processMediaForWebhook } = require('../utils/media');
const avatarStorage = require('../utils/avatarStorage');
const { prepareAndSplitMessage, chunkHelpers } = require('../utils/messageSplitting');
const config = require('../../config');

// Store references to global timer functions
const globalSetTimeout = setTimeout;

// Injectable timer functions for testability
let timerFunctions = {
  setTimeout: (callback, delay, ...args) => globalSetTimeout(callback, delay, ...args),
};

/**
 * Override timer functions for testing
 * @param {Object} customTimers - Custom timer implementations
 */
function setTimerFunctions(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

// Default delay function using injectable timers
const defaultDelay = ms => new Promise(resolve => timerFunctions.setTimeout(resolve, ms));

/**
 * Send a message to a thread, using optimized thread-specific webhook approach
 * This implements specialized thread handling that prioritizes webhook aesthetics
 *
 * @param {Object} channel - The thread channel to send to
 * @param {string} content - Message content
 * @param {Object} personality - Personality data (name, avatar)
 * @param {Object} options - Additional options
 * @param {Function} getStandardizedUsername - Function to get standardized username
 * @param {Function} createVirtualResult - Function to create virtual result
 * @param {Function} delayFn - Delay function for testing
 * @returns {Promise<Object>} The sent message info
 */
async function sendDirectThreadMessage(
  channel,
  content,
  personality,
  options = {},
  getStandardizedUsername,
  createVirtualResult,
  delayFn = defaultDelay
) {
  if (!channel || !channel.isThread()) {
    logger.error(
      `[WebhookManager] Called sendDirectThreadMessage on non-thread channel: ${channel?.id}`
    );
    throw new Error('Cannot send direct thread message to non-thread channel');
  }

  logger.info(
    `[WebhookManager] OPTIMIZED THREAD MESSAGE: Sending to thread ${channel.id} as ${personality.displayName || personality.fullName}`
  );

  try {
    // Use webhookCache to get or create webhook - this ensures consistency
    // and prevents the webhook URL corruption issue
    logger.info(
      `[WebhookManager] Thread optimized approach - getting webhook for thread ${channel.id} via webhookCache`
    );

    // Import webhookCache here to avoid circular dependencies
    const webhookCache = require('../utils/webhookCache');

    // Use the same webhook creation/caching logic as the main system
    const webhookClient = await webhookCache.getOrCreateWebhook(channel);

    // Get standardized username for consistent display
    const standardName = getStandardizedUsername(personality);

    // Process any media in the content
    let processedContent = content;
    let mediaAttachments = [];

    try {
      if (typeof content === 'string') {
        const mediaResult = await processMediaForWebhook(content);
        processedContent = mediaResult.content;
        mediaAttachments = mediaResult.attachments;

        if (mediaAttachments.length > 0) {
          logger.info(
            `[WebhookManager] Processed ${mediaAttachments.length} media attachments for thread message`
          );
        }
      }
    } catch (mediaError) {
      logger.error(
        `[WebhookManager] Error processing media for thread message: ${mediaError.message}`
      );
      // Continue with original content
      processedContent = content;
      mediaAttachments = [];
    }

    // Use common splitting utility
    const contentChunks = prepareAndSplitMessage(processedContent, options, 'Thread');

    // Track sent messages
    const sentMessageIds = [];
    let firstSentMessage = null;

    // Try multiple approaches in sequence (best webhook approach first)
    for (let i = 0; i < contentChunks.length; i++) {
      const isFirstChunk = chunkHelpers.isFirstChunk(i);
      const isLastChunk = chunkHelpers.isLastChunk(i, contentChunks.length);
      const chunkContent = contentChunks[i];

      // Add a delay between chunks to prevent Discord from merging/replacing them
      if (i > 0) {
        await delayFn(chunkHelpers.getChunkDelay());
      }

      // Skip duplicate messages
      if (isDuplicateMessage(chunkContent, standardName, channel.id)) {
        logger.info(`[WebhookManager] Skipping thread chunk ${i + 1} due to duplicate detection`);
        continue;
      }

      // Only include files in last chunk
      const files = isLastChunk ? [...mediaAttachments, ...(options.files || [])] : [];

      // Only include embeds in last chunk
      const embeds = isLastChunk && options.embeds ? options.embeds : [];

      // Use chunk content directly (model indicator already included)
      const finalChunkContent = chunkContent;

      // Resolve avatar URL through storage system
      let avatarUrl = null;
      let personalityAvatarUrl = null;

      // DDD personalities have avatarUrl in profile.avatarUrl
      if (personality && personality.profile && personality.profile.avatarUrl) {
        personalityAvatarUrl = personality.profile.avatarUrl;
      }

      if (personality && personalityAvatarUrl) {
        try {
          const localAvatarUrl = await avatarStorage.getLocalAvatarUrl(
            personality.fullName,
            personalityAvatarUrl
          );
          avatarUrl = localAvatarUrl || personalityAvatarUrl;
          logger.info(
            `[ThreadHandler] Avatar URL for ${personality.fullName}: ${avatarUrl} (original: ${personalityAvatarUrl})`
          );
        } catch (error) {
          logger.error(`[ThreadHandler] Failed to get local avatar URL: ${error.message}`);
          avatarUrl = personalityAvatarUrl; // Fallback to original
          logger.info(`[ThreadHandler] Using fallback avatar URL: ${avatarUrl}`);
        }
      }

      // Prepare base webhook options
      const baseOptions = {
        content: finalChunkContent,
        username: standardName,
        avatarURL: avatarUrl,
        threadId: channel.id,
        files,
        embeds,
      };

      // Send using multiple approaches in sequence until one works
      try {
        let sentMessage = null;

        // APPROACH 1: Use webhook with thread_id parameter (most compatible)
        try {
          logger.info(`[WebhookManager] THREAD APPROACH 1: Using direct thread_id parameter`);
          sentMessage = await webhookClient.send({
            ...baseOptions,
            thread_id: channel.id,
          });
          logger.info(
            `[WebhookManager] Successfully sent thread message using thread_id parameter`
          );
        } catch (approach1Error) {
          logger.error(`[WebhookManager] Thread approach 1 failed: ${approach1Error.message}`);

          // APPROACH 2: Use webhook.thread() method if available
          if (typeof webhookClient.thread === 'function') {
            try {
              logger.info(`[WebhookManager] THREAD APPROACH 2: Using webhook.thread() method`);
              const threadWebhook = webhookClient.thread(channel.id);
              // Don't pass threadId in the options since we're using thread-specific client
              const { threadId: _threadId, ...threadOptions } = baseOptions;
              sentMessage = await threadWebhook.send(threadOptions);
              logger.info(
                `[WebhookManager] Successfully sent thread message using thread() method`
              );
            } catch (approach2Error) {
              logger.error(`[WebhookManager] Thread approach 2 failed: ${approach2Error.message}`);
              throw approach2Error; // Let the outer catch handle the fallback
            }
          } else {
            throw approach1Error; // Re-throw to fall through to the fallback
          }
        }

        // If we got here, message was sent successfully
        sentMessageIds.push(sentMessage.id);

        if (isFirstChunk) {
          firstSentMessage = sentMessage;
        }

        logger.info(
          `[WebhookManager] Successfully sent thread message chunk ${i + 1}/${contentChunks.length}`
        );
      } catch (error) {
        // All webhook approaches failed, fall back to direct channel.send()
        logger.error(`[WebhookManager] All webhook approaches failed: ${error.message}`);
        logger.info(`[WebhookManager] Falling back to direct channel.send()`);

        try {
          // Format the content with the personality name for direct sending
          const formattedContent = `**${standardName}:** ${finalChunkContent}`;

          // Create send options
          const sendOptions = {
            content: formattedContent,
          };

          // Add files/embeds if this is the last chunk
          if (isLastChunk) {
            if (files.length > 0) sendOptions.files = files;
            if (embeds.length > 0) sendOptions.embeds = embeds;
          }

          // Send using direct approach
          const sentMessage = await channel.send(sendOptions);

          // Track message
          sentMessageIds.push(sentMessage.id);

          if (isFirstChunk) {
            firstSentMessage = sentMessage;
          }

          logger.info(
            `[WebhookManager] Successfully sent direct fallback message for chunk ${i + 1}/${contentChunks.length}`
          );
        } catch (fallbackError) {
          logger.error(`[WebhookManager] Even direct send failed: ${fallbackError.message}`);

          if (isFirstChunk) {
            // If first chunk fails with all approaches, propagate the error
            throw fallbackError;
          }
          // Otherwise continue with remaining chunks
        }
      }
    }

    // Return result
    if (sentMessageIds.length > 0) {
      return {
        message: firstSentMessage,
        messageIds: sentMessageIds,
        isThreadMessage: true,
        personalityName: personality.fullName,
      };
    } else {
      // If no messages were sent (all were duplicates), create a virtual result
      return createVirtualResult(personality, channel.id);
    }
  } catch (error) {
    logger.error(`[WebhookManager] Failed to send thread message: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendDirectThreadMessage,
  setTimerFunctions,
};
