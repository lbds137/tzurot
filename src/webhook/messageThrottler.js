/**
 * Message Throttler
 *
 * Handles message throttling and rate limiting for webhooks:
 * - Tracks pending messages per personality/channel
 * - Prevents fast error/slow success issues
 * - Manages channel message timing
 */

const logger = require('../logger');
const { TIME } = require('../constants');

// Map to track personality+channel combinations with pending messages
// This is critical to prevent the fast error/slow success issue
const pendingPersonalityMessages = new Map();

// Map to track timeouts for automatic cleanup
const pendingTimeouts = new Map();

// Track the last time a webhook message was sent to each channel
const channelLastMessageTime = new Map();

// Maximum time to wait for a real response before allowing error message (from constants)
const MAX_ERROR_WAIT_TIME = TIME.MAX_ERROR_WAIT_TIME;

// Minimum delay between sending messages to ensure proper order (from constants)
const MIN_MESSAGE_DELAY = TIME.MIN_MESSAGE_DELAY;

// Injectable timer functions for testability
let timerFunctions = {
  setTimeout: (callback, delay, ...args) => setTimeout(callback, delay, ...args),
  clearTimeout: id => clearTimeout(id),
};

/**
 * Configure timer functions (for testing)
 * @param {Object} customTimers - Custom timer implementations
 */
function configureTimers(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

/**
 * Create a unique key for a personality+channel combination
 * @param {string} personalityName - Name of the personality
 * @param {string} channelId - ID of the channel
 * @returns {string} A unique key
 */
function createPersonalityChannelKey(personalityName, channelId) {
  return `${personalityName}_${channelId}`;
}

/**
 * Check if a personality has a pending message in a channel
 * @param {string} personalityName - Name of the personality
 * @param {string} channelId - ID of the channel
 * @returns {boolean} True if there's a pending message
 */
function hasPersonalityPendingMessage(personalityName, channelId) {
  const key = createPersonalityChannelKey(personalityName, channelId);
  const pending = pendingPersonalityMessages.get(key);

  if (!pending) {
    return false;
  }

  // Check if the pending message has expired
  const elapsed = Date.now() - pending.timestamp;
  if (elapsed > MAX_ERROR_WAIT_TIME) {
    // Clean up expired entry
    pendingPersonalityMessages.delete(key);
    return false;
  }

  return true;
}

/**
 * Register that a personality has a pending message in a channel
 * @param {string} personalityName - Name of the personality
 * @param {string} channelId - ID of the channel
 * @param {string} requestId - Unique ID for this request
 */
function registerPendingMessage(personalityName, channelId, requestId) {
  const key = createPersonalityChannelKey(personalityName, channelId);

  // Clear any existing timeout for this key
  if (pendingTimeouts.has(key)) {
    timerFunctions.clearTimeout(pendingTimeouts.get(key));
  }

  pendingPersonalityMessages.set(key, {
    timestamp: Date.now(),
    requestId,
  });

  // Schedule automatic cleanup after MAX_ERROR_WAIT_TIME
  const timeoutId = timerFunctions.setTimeout(() => {
    if (pendingPersonalityMessages.has(key)) {
      pendingPersonalityMessages.delete(key);
      pendingTimeouts.delete(key);
      logger.debug(
        `[MessageThrottler] Pending message for ${key} timed out after ${MAX_ERROR_WAIT_TIME}ms`
      );
    }
  }, MAX_ERROR_WAIT_TIME);

  pendingTimeouts.set(key, timeoutId);

  logger.debug(`[MessageThrottler] Registered pending message for ${key} with ID ${requestId}`);
}

/**
 * Clear a pending message registration
 * @param {string} personalityName - Name of the personality
 * @param {string} channelId - ID of the channel
 * @param {string} requestId - The request ID to clear (optional, for validation)
 */
function clearPendingMessage(personalityName, channelId, requestId = null) {
  const key = createPersonalityChannelKey(personalityName, channelId);
  const pending = pendingPersonalityMessages.get(key);

  // Only clear if requestId matches (or no requestId provided)
  if (pending && (!requestId || pending.requestId === requestId)) {
    pendingPersonalityMessages.delete(key);

    // Clear the timeout if it exists
    if (pendingTimeouts.has(key)) {
      timerFunctions.clearTimeout(pendingTimeouts.get(key));
      pendingTimeouts.delete(key);
    }

    logger.debug(`[MessageThrottler] Cleared pending message for ${key}`);
  }
}

/**
 * Calculate the delay needed before sending the next message to a channel
 * @param {string} channelId - The channel ID
 * @returns {number} Milliseconds to delay (0 if no delay needed)
 */
function calculateMessageDelay(channelId) {
  const lastTime = channelLastMessageTime.get(channelId);

  if (lastTime) {
    const elapsed = Date.now() - lastTime;
    if (elapsed < MIN_MESSAGE_DELAY) {
      const delayNeeded = MIN_MESSAGE_DELAY - elapsed;
      logger.debug(
        `[MessageThrottler] Channel ${channelId} needs ${delayNeeded}ms delay before next message`
      );
      return delayNeeded;
    }
  }
  return 0;
}

/**
 * Update the last message time for a channel
 * @param {string} channelId - The channel ID
 */
function updateChannelLastMessageTime(channelId) {
  channelLastMessageTime.set(channelId, Date.now());
}

/**
 * Clear all pending messages (useful for cleanup/testing)
 */
function clearAllPendingMessages() {
  // Clear all timeouts first
  for (const timeoutId of pendingTimeouts.values()) {
    timerFunctions.clearTimeout(timeoutId);
  }
  pendingTimeouts.clear();

  pendingPersonalityMessages.clear();
  channelLastMessageTime.clear();
}

/**
 * Get current state for debugging
 * @returns {Object} Current throttler state
 */
function getThrottlerState() {
  return {
    pendingMessages: pendingPersonalityMessages.size,
    trackedChannels: channelLastMessageTime.size,
  };
}

module.exports = {
  createPersonalityChannelKey,
  hasPersonalityPendingMessage,
  registerPendingMessage,
  clearPendingMessage,
  calculateMessageDelay,
  updateChannelLastMessageTime,
  clearAllPendingMessages,
  getThrottlerState,
  configureTimers,
  MAX_ERROR_WAIT_TIME,
  MIN_MESSAGE_DELAY,
};
