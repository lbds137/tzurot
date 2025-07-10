const logger = require('../logger');

/**
 * Formats context metadata for messages sent to the AI service
 * @module utils/contextMetadataFormatter
 */

/**
 * Get the channel path for thread and forum channels
 * @param {Object} channel - Discord channel object
 * @returns {string} - Formatted channel path (e.g., "#general > Thread Name")
 */
function getChannelPath(channel) {
  try {
    // Handle DMs
    if (channel.type === 1) {
      return 'DMs';
    }

    // Handle threads (type 11 = public thread, 12 = private thread)
    if (channel.type === 11 || channel.type === 12) {
      const parentName = channel.parent?.name || 'unknown-channel';
      return `#${parentName} > ${channel.name}`;
    }

    // Handle forum posts (type 15 = forum channel post)
    if (channel.type === 15) {
      const parentName = channel.parent?.name || 'unknown-forum';
      return `#${parentName} > ${channel.name}`;
    }

    // Regular guild channels
    return `#${channel.name || 'unknown-channel'}`;
  } catch (error) {
    logger.error('[ContextMetadataFormatter] Error getting channel path:', error);
    return '#unknown';
  }
}

/**
 * Format a timestamp to ISO string in UTC
 * @param {number|Date} timestamp - Unix timestamp in milliseconds or Date object
 * @returns {string} - ISO formatted timestamp (e.g., "2025-07-10T15:30:45Z")
 */
function formatTimestamp(timestamp) {
  try {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    return date.toISOString();
  } catch (error) {
    logger.error('[ContextMetadataFormatter] Error formatting timestamp:', error);
    // Return current time as fallback
    return new Date().toISOString();
  }
}

/**
 * Format context metadata for a Discord message
 * @param {Object} message - Discord message object
 * @returns {string} - Formatted context string (e.g., "[Server Name | #channel | 2025-07-10T15:30:45Z]")
 */
function formatContextMetadata(message) {
  try {
    // Get server name or "DMs"
    const serverName = message.guild?.name || 'DMs';
    
    // Get channel path
    const channelPath = getChannelPath(message.channel);
    
    // Get timestamp - use createdTimestamp (milliseconds) or fall back to current time
    const timestamp = message.createdTimestamp || Date.now();
    const formattedTime = formatTimestamp(timestamp);
    
    // Combine into context string
    return `[${serverName} | ${channelPath} | ${formattedTime}]`;
  } catch (error) {
    logger.error('[ContextMetadataFormatter] Error formatting context metadata:', error);
    // Return minimal context on error
    return `[Unknown | #unknown | ${new Date().toISOString()}]`;
  }
}

module.exports = {
  formatContextMetadata,
  formatTimestamp,
  getChannelPath,
};