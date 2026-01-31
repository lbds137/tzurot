const logger = require('../../logger');

/**
 * DiscordWebhookAdapter - Manages Discord webhooks for personality messages
 *
 * This adapter encapsulates Discord webhook operations and provides a clean
 * interface for the domain layer to send messages as personalities.
 */
class DiscordWebhookAdapter {
  /**
   * @param {Object} dependencies
   * @param {Object} dependencies.webhookCache - Cache for webhook instances
   * @param {Object} dependencies.discord - Discord.js client
   */
  constructor({ webhookCache, discord }) {
    this.webhookCache = webhookCache;
    this.discord = discord;
  }

  /**
   * Send a message as a personality through a webhook
   * @param {Object} params
   * @param {string} params.channelId - Discord channel ID
   * @param {PersonalityId} params.personalityId - Personality sending the message
   * @param {Object} params.personalityProfile - Personality profile with display info
   * @param {string} params.content - Message content
   * @param {Array} params.attachments - Optional attachments
   * @param {Object} params.reference - Optional message reference for replies
   * @returns {Promise<Object>} Sent message data
   */
  async sendMessage({
    channelId,
    personalityId: _personalityId, // Currently unused but kept for interface consistency
    personalityProfile,
    content,
    attachments = [],
    reference = null,
  }) {
    try {
      const webhook = await this._getOrCreateWebhook(channelId);

      const messageOptions = {
        content: this._formatContent(content),
        username: this._formatUsername(personalityProfile.displayName),
        avatarURL: personalityProfile.avatarUrl,
      };

      // Add attachments if present
      if (attachments.length > 0) {
        messageOptions.files = attachments.map(att => ({
          attachment: att.url,
          name: att.filename || 'attachment',
        }));
      }

      // Add reference for replies
      if (reference) {
        messageOptions.allowedMentions = { repliedUser: true };
        // Discord.js webhook API doesn't support direct reply references
        // We'll need to format the content to indicate it's a reply
        if (reference.messageId) {
          messageOptions.content = `> Reply to message\n${messageOptions.content}`;
        }
      }

      const sentMessage = await webhook.send(messageOptions);

      return {
        id: sentMessage.id,
        channelId: sentMessage.channel_id,
        webhookId: webhook.id,
        timestamp: new Date(sentMessage.timestamp),
      };
    } catch (error) {
      logger.error('[DiscordWebhookAdapter] Failed to send message:', error);
      throw new Error(`Failed to send webhook message: ${error.message}`);
    }
  }

  /**
   * Edit a message sent through a webhook
   * @param {Object} params
   * @param {string} params.messageId - Message ID to edit
   * @param {string} params.channelId - Channel containing the message
   * @param {string} params.content - New content
   * @returns {Promise<void>}
   */
  async editMessage({ messageId, channelId, content }) {
    try {
      const webhook = await this._getWebhook(channelId);
      if (!webhook) {
        throw new Error('No webhook found for channel');
      }

      await webhook.editMessage(messageId, {
        content: this._formatContent(content),
      });
    } catch (error) {
      logger.error('[DiscordWebhookAdapter] Failed to edit message:', error);
      throw new Error(`Failed to edit webhook message: ${error.message}`);
    }
  }

  /**
   * Delete a message sent through a webhook
   * @param {Object} params
   * @param {string} params.messageId - Message ID to delete
   * @param {string} params.channelId - Channel containing the message
   * @returns {Promise<void>}
   */
  async deleteMessage({ messageId, channelId }) {
    try {
      const webhook = await this._getWebhook(channelId);
      if (!webhook) {
        throw new Error('No webhook found for channel');
      }

      await webhook.deleteMessage(messageId);
    } catch (error) {
      logger.error('[DiscordWebhookAdapter] Failed to delete message:', error);
      throw new Error(`Failed to delete webhook message: ${error.message}`);
    }
  }

  /**
   * Check if a channel supports webhooks
   * @param {string} channelId - Channel ID to check
   * @returns {Promise<boolean>}
   */
  async supportsWebhooks(channelId) {
    try {
      const channel = await this.discord.channels.fetch(channelId);

      // Webhooks are supported in guild text channels and voice channels
      // Not supported in DMs, threads, or other channel types
      return (
        channel &&
        (channel.type === 0 || // GUILD_TEXT
          channel.type === 2 || // GUILD_VOICE (can have text)
          channel.type === 5 || // GUILD_NEWS
          channel.type === 13) // GUILD_STAGE_VOICE
      );
    } catch (error) {
      logger.error('[DiscordWebhookAdapter] Failed to check webhook support:', error);
      return false;
    }
  }

  /**
   * Get or create a webhook for a channel
   * @private
   */
  async _getOrCreateWebhook(channelId) {
    // Check cache first
    const cached = this.webhookCache.get(channelId);
    if (cached) {
      return cached;
    }

    try {
      const channel = await this.discord.channels.fetch(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }

      // Get existing webhooks
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find(w => w.name === 'Tzurot' && w.owner?.id === this.discord.user.id);

      // Create if doesn't exist
      if (!webhook) {
        webhook = await channel.createWebhook({
          name: 'Tzurot',
          avatar: this.discord.user.displayAvatarURL(),
          reason: 'Tzurot personality system webhook',
        });
      }

      // Cache it
      this.webhookCache.set(channelId, webhook);

      return webhook;
    } catch (error) {
      logger.error('[DiscordWebhookAdapter] Failed to get/create webhook:', error);
      throw error;
    }
  }

  /**
   * Get existing webhook for a channel
   * @private
   */
  async _getWebhook(channelId) {
    // Check cache first
    const cached = this.webhookCache.get(channelId);
    if (cached) {
      return cached;
    }

    try {
      const channel = await this.discord.channels.fetch(channelId);
      if (!channel) {
        return null;
      }

      const webhooks = await channel.fetchWebhooks();
      const webhook = webhooks.find(
        w => w.name === 'Tzurot' && w.owner?.id === this.discord.user.id
      );

      if (webhook) {
        this.webhookCache.set(channelId, webhook);
      }

      return webhook;
    } catch (error) {
      logger.error('[DiscordWebhookAdapter] Failed to get webhook:', error);
      return null;
    }
  }

  /**
   * Format message content
   * @private
   */
  _formatContent(content) {
    // Ensure content doesn't exceed Discord's limit
    if (content.length > 2000) {
      return content.substring(0, 1997) + '...';
    }
    return content;
  }

  /**
   * Format webhook username
   * @private
   */
  _formatUsername(displayName) {
    // Discord webhook usernames have a 32 character limit
    // and certain characters are not allowed
    let username = displayName.trim();

    // Remove or replace problematic characters
    username = username
      .replace(/[`'"]/g, '') // Remove quotes
      .replace(/[@#]/g, '') // Remove mentions
      .trim();

    // Truncate if too long
    if (username.length > 32) {
      username = username.substring(0, 29) + '...';
    }

    // Fallback if empty
    return username || 'Personality';
  }

  /**
   * Clear webhook cache for a channel
   * @param {string} channelId - Channel ID
   */
  clearCache(channelId) {
    this.webhookCache.delete(channelId);
  }

  /**
   * Clear entire webhook cache
   */
  clearAllCache() {
    this.webhookCache.clear();
  }
}

module.exports = { DiscordWebhookAdapter };
