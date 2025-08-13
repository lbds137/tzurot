/**
 * AddContextMetadataStep
 * 
 * Adds Discord context metadata to messages.
 * Format: [Discord: ServerName > #channel | timestamp]
 */

const FormattingStep = require('../FormattingStep');

class AddContextMetadataStep extends FormattingStep {
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
    // Option to prepend or append metadata
    this.position = options.position || 'prepend'; // 'prepend' or 'append'
  }

  /**
   * Execute context metadata addition
   * @param {string} content - The message content
   * @param {Object} context - The formatting context
   * @returns {string} Content with context metadata
   */
  execute(content, context) {
    if (!context || !context.message) {
      return content || '';
    }

    const message = context.message;
    const metadata = this.formatContextMetadata(message);
    
    if (!metadata) {
      return content || '';
    }

    const currentContent = content || '';
    
    if (this.position === 'append') {
      return currentContent + (currentContent ? '\n' : '') + metadata;
    } else {
      return metadata + (currentContent ? '\n' : '') + currentContent;
    }
  }

  /**
   * Format context metadata from a Discord message
   * @param {Object} message - Discord message object
   * @returns {string|null} Formatted metadata or null
   */
  formatContextMetadata(message) {
    try {
      if (!message || !message.channel) {
        return null;
      }

      const parts = ['[Discord:'];
      
      // Add server/guild name for guild messages
      if (message.guild) {
        parts.push(` ${message.guild.name} >`);
      }
      
      // Add channel information
      const channelPath = this.getChannelPath(message.channel);
      if (channelPath) {
        parts.push(` ${channelPath}`);
      } else {
        parts.push(' Unknown Channel');
      }
      
      // Add timestamp
      const timestamp = this.formatTimestamp(message.createdTimestamp || Date.now());
      parts.push(` | ${timestamp}`);
      
      parts.push(']');
      
      return parts.join('');
    } catch (error) {
      this.logger.error('[AddContextMetadataStep] Error formatting metadata:', error);
      return null;
    }
  }

  /**
   * Get the channel path for different Discord channel types
   * @param {Object} channel - Discord channel object
   * @returns {string} Channel path
   */
  getChannelPath(channel) {
    try {
      // Direct Messages
      if (channel.isDMBased?.() || channel.type === 1) {
        return 'Direct Messages';
      }

      // Thread channels
      if (channel.isThread?.() || [10, 11, 12].includes(channel.type)) {
        const parentName = channel.parent?.name || 'Unknown';
        const threadName = channel.name || 'Thread';
        return `#${parentName} > ${threadName}`;
      }

      // Forum posts (type 15 is GUILD_FORUM)
      if (channel.parent?.type === 15) {
        const forumName = channel.parent.name || 'Forum';
        const postName = channel.name || 'Post';
        return `#${forumName} > ${postName}`;
      }

      // Regular text channels
      return `#${channel.name || 'unknown'}`;
    } catch (error) {
      this.logger.error('[AddContextMetadataStep] Error getting channel path:', error);
      return 'Unknown';
    }
  }

  /**
   * Format timestamp to ISO string
   * @param {number|Date} timestamp - Timestamp to format
   * @returns {string} ISO formatted timestamp
   */
  formatTimestamp(timestamp) {
    try {
      if (!timestamp) {
        return new Date().toISOString();
      }
      
      const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
      
      if (isNaN(date.getTime())) {
        return new Date().toISOString();
      }
      
      return date.toISOString();
    } catch (error) {
      this.logger.error('[AddContextMetadataStep] Error formatting timestamp:', error);
      return new Date().toISOString();
    }
  }

  /**
   * Check if this step should execute
   * @param {Object} context - The formatting context
   * @returns {boolean}
   */
  shouldExecute(context) {
    // Skip if context metadata is disabled for this personality
    if (context && context.personality && context.personality.disableContextMetadata) {
      return false;
    }
    
    // Skip for DM channels if configured
    if (context && context.message && context.skipDMContext) {
      const channel = context.message.channel;
      if (channel && (channel.isDMBased?.() || channel.type === 1)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get the name of this step
   * @returns {string}
   */
  getName() {
    return 'AddContextMetadataStep';
  }
}

module.exports = AddContextMetadataStep;