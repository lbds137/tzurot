const logger = require('../logger');
const { TIME, DEFAULTS } = require('../constants');

/**
 * Manages pending API requests to prevent duplicates and track request state
 * @module utils/aiRequestManager
 */

// Track in-progress API requests to prevent duplicate processing
const pendingRequests = new Map();

// Track personality-user pairs that should be blocked from generating ANY response
// after experiencing an error - essential to prevent double messages
const errorBlackoutPeriods = new Map();

/**
 * Create a personality-user key for blackout tracking
 *
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {string} A unique key in the format "{personalityName}_{userId}_{channelId}"
 */
function createBlackoutKey(personalityName, context) {
  return `${personalityName}_${context.userId || DEFAULTS.ANONYMOUS_USER}_${context.channelId || DEFAULTS.NO_CHANNEL}`;
}

/**
 * Check if a personality-user combination is currently in a blackout period
 *
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {boolean} True if the combination is in a blackout period
 */
function isInBlackoutPeriod(personalityName, context) {
  const key = createBlackoutKey(personalityName, context);
  if (errorBlackoutPeriods.has(key)) {
    const expirationTime = errorBlackoutPeriods.get(key);
    if (Date.now() < expirationTime) {
      return true;
    } else {
      // Clean up expired entry
      errorBlackoutPeriods.delete(key);
    }
  }
  return false;
}

/**
 * Add a personality-user combination to the blackout list
 *
 * @param {string} personalityName - The AI personality name
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @param {number} [duration] - Custom blackout duration in milliseconds. If not provided, defaults to TIME.ERROR_BLACKOUT_DURATION
 * @returns {void}
 */
function addToBlackoutList(personalityName, context, duration) {
  const key = createBlackoutKey(personalityName, context);
  const blackoutDuration = duration || TIME.ERROR_BLACKOUT_DURATION;
  const expirationTime = Date.now() + blackoutDuration;
  errorBlackoutPeriods.set(key, expirationTime);
}

/**
 * Create a unique request ID for tracking API requests
 *
 * @param {string} personalityName - The AI personality name
 * @param {string|Array} message - The message content or array of content objects for multimodal
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @param {string} [context.messageId] - The Discord message ID for better deduplication
 * @returns {string} A unique request ID that can be used for deduplication
 */
function createRequestId(personalityName, message, context) {
  let messagePrefix;

  try {
    // Include message ID if available for better deduplication
    const messageIdPrefix = context.messageId ? `msg${context.messageId}_` : '';

    if (!message) {
      // Handle undefined or null message
      messagePrefix = 'empty-message';
    } else if (Array.isArray(message)) {
      // For multimodal content, create a prefix based on content
      const textContent = message.find(item => item.type === 'text')?.text || '';
      const imageUrl = message.find(item => item.type === 'image_url')?.image_url?.url || '';
      const audioUrl = message.find(item => item.type === 'audio_url')?.audio_url?.url || '';

      // Create a prefix using text and any media URLs, adding type identifiers to distinguish them
      // Use more of the text content (50 chars) and create a simple hash
      const textHash =
        textContent.length > 0
          ? textContent.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
          : 0;

      messagePrefix =
        textContent.substring(0, 50).replace(/\s+/g, '') +
        '_h' +
        textHash +
        (imageUrl
          ? '_IMG-' +
            imageUrl.substring(imageUrl.lastIndexOf('/') + 1, imageUrl.lastIndexOf('/') + 12)
          : '') +
        (audioUrl
          ? '_AUD-' +
            audioUrl.substring(audioUrl.lastIndexOf('/') + 1, audioUrl.lastIndexOf('/') + 12)
          : '');
    } else if (typeof message === 'string') {
      // For regular string messages, use more content and add a simple hash
      const textHash = message.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      messagePrefix = message.substring(0, 50).replace(/\s+/g, '') + '_h' + textHash;
    } else if (typeof message === 'object' && message.messageContent) {
      // Handle our special reference format
      // Process message content as before
      let contentPrefix = '';
      if (typeof message.messageContent === 'string') {
        const textHash = message.messageContent
          .split('')
          .reduce((acc, char) => acc + char.charCodeAt(0), 0);
        contentPrefix =
          message.messageContent.substring(0, 50).replace(/\s+/g, '') + '_h' + textHash;
      } else if (Array.isArray(message.messageContent)) {
        // Extract text from multimodal content
        const textContent = message.messageContent.find(item => item.type === 'text')?.text || '';
        const imageUrl =
          message.messageContent.find(item => item.type === 'image_url')?.image_url?.url || '';
        const audioUrl =
          message.messageContent.find(item => item.type === 'audio_url')?.audio_url?.url || '';

        const textHash =
          textContent.length > 0
            ? textContent.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
            : 0;

        contentPrefix =
          textContent.substring(0, 40).replace(/\s+/g, '') +
          '_h' +
          textHash +
          (imageUrl
            ? '_IMG-' +
              imageUrl.substring(imageUrl.lastIndexOf('/') + 1, imageUrl.lastIndexOf('/') + 12)
            : '') +
          (audioUrl
            ? '_AUD-' +
              audioUrl.substring(audioUrl.lastIndexOf('/') + 1, audioUrl.lastIndexOf('/') + 12)
            : '');
      } else {
        contentPrefix = 'complex-object';
      }

      // Also check for referenced message with media
      let referencePrefix = '';
      if (message.referencedMessage && message.referencedMessage.content) {
        const refContent = message.referencedMessage.content;
        const refHash = refContent.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        referencePrefix = '_ref' + refHash;

        // Check for media in the referenced message
        if (refContent.includes('[Image:')) {
          const imageMatch = refContent.match(/\[Image: (https?:\/\/[^\s\]]+)\]/);
          if (imageMatch && imageMatch[1]) {
            referencePrefix +=
              '_IMG-' +
              imageMatch[1].substring(imageMatch[1].lastIndexOf('/') + 1).substring(0, 10);
          }
        }

        if (refContent.includes('[Audio:')) {
          const audioMatch = refContent.match(/\[Audio: (https?:\/\/[^\s\]]+)\]/);
          if (audioMatch && audioMatch[1]) {
            referencePrefix +=
              '_AUD-' +
              audioMatch[1].substring(audioMatch[1].lastIndexOf('/') + 1).substring(0, 10);
          }
        }
      }

      // Combine prefixes to create a unique ID that includes both content and reference info
      messagePrefix = contentPrefix + referencePrefix;
    } else {
      // Fallback for any other type
      messagePrefix = `type-${typeof message}`;
    }

    // Add the message ID prefix for better uniqueness
    messagePrefix = messageIdPrefix + messagePrefix;
  } catch (error) {
    // Log the error but continue with a safe fallback
    logger.error(`[AIRequestManager] Error creating request ID: ${error.message}`);
    logger.error(
      `[AIRequestManager] Message type: ${typeof message}, Array? ${Array.isArray(message)}`
    );
    if (message) {
      logger.error(
        `[AIRequestManager] Message structure present but not logging content for privacy`
      );
    }

    // Use a safe fallback with timestamp for uniqueness
    messagePrefix = `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  return `${personalityName}_${context.userId || DEFAULTS.ANONYMOUS_USER}_${context.channelId || DEFAULTS.NO_CHANNEL}_${messagePrefix}`;
}

/**
 * Check if a request is already pending
 *
 * @param {string} requestId - The unique request ID
 * @returns {Object|null} The pending request object with {timestamp, promise} or null if not pending
 */
function getPendingRequest(requestId) {
  if (pendingRequests.has(requestId)) {
    const request = pendingRequests.get(requestId);

    // Check if the request is still valid (within timeout period)
    // Increased timeout to handle slow AI responses (some take 2+ minutes)
    if (Date.now() - request.timestamp < TIME.FIVE_MINUTES) {
      return request;
    } else {
      // Timed out, clean up
      logger.info(`[AIRequestManager] Request ${requestId} timed out after 5 minutes, cleaning up`);
      pendingRequests.delete(requestId);
    }
  }
  return null;
}

/**
 * Store a pending request
 *
 * @param {string} requestId - The unique request ID
 * @param {Promise} promise - The promise representing the pending request
 * @returns {void}
 */
function storePendingRequest(requestId, promise) {
  pendingRequests.set(requestId, {
    timestamp: Date.now(),
    promise: promise,
  });
}

/**
 * Remove a completed request
 *
 * @param {string} requestId - The unique request ID
 * @returns {void}
 */
function removePendingRequest(requestId) {
  pendingRequests.delete(requestId);
}

/**
 * Prepare request headers for the AI API call
 *
 * @param {Object} context - The context object with user and channel information
 * @param {string} [context.userId] - The Discord user ID of the requester
 * @param {string} [context.channelId] - The Discord channel ID where the request originated
 * @returns {Object} Headers object with user and channel IDs if provided
 */
function prepareRequestHeaders(context) {
  const headers = {};

  // Add user/channel ID headers if provided
  if (context.userId) headers['X-User-Id'] = context.userId;
  if (context.channelId) headers['X-Channel-Id'] = context.channelId;

  return headers;
}

/**
 * Clear all pending requests (useful for cleanup)
 * @returns {void}
 */
function clearPendingRequests() {
  pendingRequests.clear();
}

/**
 * Clear all blackout periods (useful for testing)
 * @returns {void}
 */
function clearBlackoutPeriods() {
  errorBlackoutPeriods.clear();
}

/**
 * Get the size of pending requests (useful for monitoring)
 * @returns {number} The number of pending requests
 */
function getPendingRequestsCount() {
  return pendingRequests.size;
}

/**
 * Get the size of blackout periods (useful for monitoring)
 * @returns {number} The number of active blackout periods
 */
function getBlackoutPeriodsCount() {
  return errorBlackoutPeriods.size;
}

module.exports = {
  // Core functionality
  createRequestId,
  getPendingRequest,
  storePendingRequest,
  removePendingRequest,
  prepareRequestHeaders,

  // Blackout period management
  createBlackoutKey,
  isInBlackoutPeriod,
  addToBlackoutList,

  // Utility functions
  clearPendingRequests,
  clearBlackoutPeriods,
  getPendingRequestsCount,
  getBlackoutPeriodsCount,

  // Export internal state for testing
  pendingRequests,
  errorBlackoutPeriods,
};
