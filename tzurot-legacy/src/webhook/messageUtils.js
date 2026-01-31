/**
 * Webhook Message Utilities
 *
 * Helper functions for message preparation and tracking
 */

const logger = require('../logger');
const crypto = require('crypto');
const avatarStorage = require('../utils/avatarStorage');

/**
 * Get a standardized username for webhook display
 * Ensures consistent formatting and removes special suffixes
 * @param {Object} personality - Personality object
 * @returns {string} Standardized username
 */
function getStandardizedUsername(personality) {
  if (!personality) {
    return 'Bot';
  }

  try {
    // Log the full personality object to diagnose issues
    logger.debug(
      `[WebhookManager] getStandardizedUsername called with personality: ${JSON.stringify({
        fullName: personality.fullName || 'N/A',
        displayName: personality.displayName || 'N/A',
        hasAvatar: !!personality.profile?.avatarUrl,
      })}`
    );

    // Get bot name suffix if available
    let botSuffix = '';
    // Access the client through the global variable set in bot.js
    if (global.tzurotClient && global.tzurotClient.user && global.tzurotClient.user.tag) {
      const botTag = global.tzurotClient.user.tag;
      logger.debug(`[WebhookManager] Bot tag: ${botTag}`);
      // Split the tag on " | " and get the second part if it exists
      const tagParts = botTag.split(' | ');
      if (tagParts.length > 1) {
        // Remove Discord discriminator (e.g. "#9971") if present
        // Discriminators are exactly 4 digits and are primarily used by bots
        // Handle cases with or without a space before the discriminator
        const suffix = tagParts[1].replace(/\s*#\d{4}$/, '').trim();
        botSuffix = ` | ${suffix}`;
        // Ensure proper spacing in the suffix
        botSuffix = botSuffix.replace(/\|\s+/, '| ');
        logger.debug(`[WebhookManager] Using bot suffix: "${botSuffix}"`);
      }
    }

    // DDD personalities have displayName in profile.displayName
    let displayName = null;

    // Get displayName from the DDD structure
    if (personality.profile && personality.profile.displayName) {
      displayName = personality.profile.displayName;
    } else if (personality.getDisplayName && typeof personality.getDisplayName === 'function') {
      // Use the getDisplayName method as a fallback (which itself checks profile.displayName)
      displayName = personality.getDisplayName();
    }

    // ALWAYS prioritize displayName over any other field
    if (displayName && typeof displayName === 'string' && displayName.trim().length > 0) {
      const name = displayName.trim();
      logger.debug(`[WebhookManager] Using displayName: ${name}`);

      // Create the full name with the suffix
      const fullNameWithSuffix = `${name}${botSuffix}`;

      // Discord has a 32 character limit for webhook usernames
      if (fullNameWithSuffix.length > 32) {
        // If the name with suffix is too long, truncate the name part
        const maxNameLength = 29 - botSuffix.length;
        if (maxNameLength > 0) {
          return name.slice(0, maxNameLength) + '...' + botSuffix;
        } else {
          // If suffix is very long, just use the original name truncated
          return name.slice(0, 29) + '...';
        }
      }

      return fullNameWithSuffix;
    } else {
      // Log when displayName is missing to help diagnose the issue
      logger.warn(
        `[WebhookManager] displayName missing for personality: ${personality.fullName || 'unknown'}`
      );
    }

    // Fallback: Extract name from fullName
    if (personality.fullName && typeof personality.fullName === 'string') {
      // If fullName has hyphens, use first part as display name
      const parts = personality.fullName.split('-');
      if (parts.length > 0 && parts[0].length > 0) {
        // Capitalize first letter for nicer display
        const extracted = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        logger.debug(`[WebhookManager] Using extracted name from fullName: ${extracted}`);

        // Create the full name with the suffix
        const extractedWithSuffix = `${extracted}${botSuffix}`;

        // Discord has a 32 character limit
        if (extractedWithSuffix.length > 32) {
          // If the name with suffix is too long, truncate the name part
          const maxExtractedLength = 29 - botSuffix.length;
          if (maxExtractedLength > 0) {
            return extracted.slice(0, maxExtractedLength) + '...' + botSuffix;
          } else {
            // If suffix is very long, just use the extracted name truncated
            return extracted.slice(0, 29) + '...';
          }
        }

        return extractedWithSuffix;
      }

      // If no hyphens, use the full name (capitalized) with suffix
      const capitalizedName =
        personality.fullName.charAt(0).toUpperCase() + personality.fullName.slice(1);
      const fullNameWithSuffix = `${capitalizedName}${botSuffix}`;
      if (fullNameWithSuffix.length <= 32) {
        logger.debug(`[WebhookManager] Using fullName with suffix: ${fullNameWithSuffix}`);
        return fullNameWithSuffix;
      }

      // Truncate long names while preserving the suffix
      const maxFullNameLength = 29 - botSuffix.length;
      if (maxFullNameLength > 0) {
        return capitalizedName.slice(0, maxFullNameLength) + '...' + botSuffix;
      } else {
        // If suffix is very long, just use the full name truncated
        return capitalizedName.slice(0, 29) + '...';
      }
    }

    // Final fallback with suffix
    const fallbackWithSuffix = `Bot${botSuffix}`;
    if (fallbackWithSuffix.length <= 32) {
      return fallbackWithSuffix;
    }
    return 'Bot';
  } catch (error) {
    logger.error(`[WebhookManager] Error in getStandardizedUsername: ${error.message}`);
    return 'Bot';
  }
}

/**
 * Generate a unique message tracking ID
 * @param {Object} personality - Personality object
 * @param {string} channelId - Channel ID
 * @returns {string} Unique tracking ID
 */
function generateMessageTrackingId(personality, channelId) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const personalityName = personality?.fullName || 'unknown';

  return `${personalityName}-${channelId}-${timestamp}-${random}`;
}

/**
 * Prepare message data for sending
 * @param {string} content - Message content
 * @param {string} username - Username to display
 * @param {Object} personality - Personality object (or null)
 * @param {boolean} isThread - Whether this is a thread message
 * @param {string} channelId - Channel ID
 * @param {Object} additionalOptions - Additional options
 * @returns {Object} Prepared message data
 */
function prepareMessageData(
  content,
  username,
  personality,
  isThread,
  channelId,
  additionalOptions = {}
) {
  const messageData = {
    content,
    username,
    // We'll resolve the avatar URL later in sendMessageChunk
    _personality: personality, // Store for later use
  };

  // Add thread-specific options
  if (isThread) {
    messageData.threadId = channelId;
  }

  // Handle legacy embed format
  if (additionalOptions.embed) {
    messageData.embeds = [additionalOptions.embed];
  }

  // Add any other additional options (except embed which we handled above)
  const { embed, ...otherOptions } = additionalOptions;
  Object.assign(messageData, otherOptions);

  return messageData;
}

/**
 * Create a virtual result for when no actual message is sent
 * Used when all messages were filtered as duplicates
 * @param {Object} personality - Personality object
 * @param {string} channelId - Channel ID
 * @returns {Object} Virtual result object
 */
function createVirtualResult(personality, channelId) {
  const virtualId = `virtual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  return {
    message: {
      id: virtualId,
      channelId,
      author: {
        id: 'webhook',
        username: getStandardizedUsername(personality),
        bot: true,
      },
      content: '[Message filtered as duplicate]',
      createdTimestamp: Date.now(),
    },
    messageIds: [virtualId],
    isVirtual: true,
    isDuplicate: true,
    personalityName: personality ? personality.fullName : 'unknown',
  };
}

/**
 * Send a message chunk using webhook
 * @param {Object} webhook - Webhook client
 * @param {Object} messageData - Message data to send
 * @param {number} chunkIndex - Current chunk index
 * @param {number} totalChunks - Total number of chunks
 * @returns {Promise<Object>} Sent message
 */
async function sendMessageChunk(webhook, messageData, chunkIndex, totalChunks) {
  try {
    logger.info(`[MessageUtils] Sending chunk ${chunkIndex + 1}/${totalChunks} via webhook`);

    // Extract personality and prepare final message data
    const { _personality, ...baseMessageData } = messageData;

    // Resolve avatar URL if personality is provided
    let avatarUrl = null;
    let personalityAvatarUrl = null;

    // DDD personalities have avatarUrl in profile.avatarUrl
    if (_personality && _personality.profile && _personality.profile.avatarUrl) {
      personalityAvatarUrl = _personality.profile.avatarUrl;
    }

    if (_personality && personalityAvatarUrl) {
      try {
        const localAvatarUrl = await avatarStorage.getLocalAvatarUrl(
          _personality.fullName,
          personalityAvatarUrl
        );
        avatarUrl = localAvatarUrl || personalityAvatarUrl;
        logger.info(
          `[MessageUtils] Avatar URL for ${_personality.fullName}: ${avatarUrl} (original: ${personalityAvatarUrl})`
        );
      } catch (error) {
        logger.error(`[MessageUtils] Failed to get local avatar URL: ${error.message}`);
        avatarUrl = personalityAvatarUrl; // Fallback to original
        logger.info(`[MessageUtils] Using fallback avatar URL: ${avatarUrl}`);
      }
    }

    // Prepare final message data with resolved avatar URL
    const finalMessageData = {
      ...baseMessageData,
      avatarURL: avatarUrl,
    };

    const sentMessage = await webhook.send(finalMessageData);

    logger.info(`[MessageUtils] Successfully sent chunk ${chunkIndex + 1}/${totalChunks}`);

    return sentMessage;
  } catch (error) {
    logger.error(
      `[MessageUtils] Failed to send chunk ${chunkIndex + 1}/${totalChunks}: ${error.message}`
    );

    // If thread_id is not accepted, retry without it
    if (error.message && error.message.includes('thread_id')) {
      logger.info(`[MessageUtils] Retrying without thread_id parameter`);
      const { thread_id, threadId, ...cleanData } = messageData;
      return await webhook.send(cleanData);
    }

    // For form body errors, just throw the error
    // Don't try to send the error message via webhook as it might also be too long
    // or cause confusion by appearing as a message from the personality
    throw error;
  }
}

/**
 * Console output utilities (legacy, kept for compatibility)
 */
function minimizeConsoleOutput() {
  // With structured logging in place, we don't need to silence anything
  // This function is kept for backwards compatibility
  return {};
}

function restoreConsoleOutput() {
  // With structured logging in place, we don't need to restore anything
  // This function is kept for backwards compatibility
}

module.exports = {
  getStandardizedUsername,
  generateMessageTrackingId,
  prepareMessageData,
  createVirtualResult,
  sendMessageChunk,
  minimizeConsoleOutput,
  restoreConsoleOutput,
};
