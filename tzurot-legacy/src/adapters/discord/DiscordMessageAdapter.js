const { Message } = require('../../domain/conversation');
const { ConversationId } = require('../../domain/conversation');
const logger = require('../../logger');

/**
 * DiscordMessageAdapter - Maps between Discord.js messages and domain objects
 *
 * This adapter serves as a bridge between the Discord.js library and our domain model,
 * ensuring that the domain remains free of infrastructure concerns.
 */
class DiscordMessageAdapter {
  /**
   * Maps a Discord.js message to a domain Message entity
   * @param {Object} discordMessage - Discord.js message object
   * @param {PersonalityId} personalityId - The personality this message is for
   * @param {boolean} isFromPersonality - Whether this message is from the personality
   * @returns {Message} Domain message entity
   */
  static toDomainMessage(discordMessage, personalityId = null, isFromPersonality = false) {
    try {
      const content = this.extractContent(discordMessage);
      const attachments = this.extractAttachments(discordMessage);
      const reference = this.extractReferences(discordMessage);
      const mentions = this.extractMentions(discordMessage);
      const isForwarded = this.isForwardedMessage(discordMessage);

      // Extract forwarded content if this is a forwarded message
      let forwardedContent = null;
      if (isForwarded && discordMessage.messageSnapshots) {
        forwardedContent = discordMessage.messageSnapshots.map(snapshot => ({
          messageId: snapshot.message.id,
          authorUsername: snapshot.message.author.username,
          content: snapshot.message.content,
          timestamp: snapshot.message.timestamp,
        }));
      }

      return new Message({
        id: discordMessage.id,
        authorId: discordMessage.author.id,
        content,
        timestamp: new Date(discordMessage.createdTimestamp),
        personalityId: personalityId ? personalityId.value : null,
        isFromPersonality,
        channelId: discordMessage.channel.id,
        guildId: discordMessage.guild?.id || null,
        attachments,
        reference,
        mentions,
        isForwarded,
        forwardedContent,
      });
    } catch (error) {
      logger.error('Failed to map Discord message to domain:', error);
      throw new Error(`Failed to create domain message: ${error.message}`);
    }
  }

  /**
   * Extracts extended metadata from Discord message
   * @param {Object} discordMessage - Discord.js message object
   * @returns {Object} Extended message metadata
   */
  static extractMetadata(discordMessage) {
    return {
      channelId: discordMessage.channel.id,
      guildId: discordMessage.guild?.id || null,
      authorTag: discordMessage.author.tag,
      authorUsername: discordMessage.author.username,
      channelName: discordMessage.channel.name || 'DM',
      guildName: discordMessage.guild?.name || null,
      attachments: this.extractAttachments(discordMessage),
      references: this.extractReferences(discordMessage),
      isFromWebhook: !!discordMessage.webhookId,
      mentions: this.extractMentions(discordMessage),
    };
  }

  /**
   * Creates a ConversationId from a Discord message
   * @param {Object} discordMessage - Discord.js message object
   * @param {string} userId - The user ID for this conversation
   * @returns {ConversationId} Domain conversation ID
   */
  static toConversationId(discordMessage, userId) {
    const channelId = discordMessage.channel.id;
    return new ConversationId(userId, channelId);
  }

  /**
   * Extracts content from Discord message, handling embeds and forwarded content
   * @private
   */
  static extractContent(discordMessage) {
    let content = discordMessage.content || '';

    // Include embed content if present
    if (discordMessage.embeds && discordMessage.embeds.length > 0) {
      const embedTexts = discordMessage.embeds
        .map(embed => {
          const parts = [];
          if (embed.title) parts.push(embed.title);
          if (embed.description) parts.push(embed.description);
          if (embed.fields) {
            embed.fields.forEach(field => {
              parts.push(`${field.name}: ${field.value}`);
            });
          }
          return parts.join('\n');
        })
        .filter(text => text);

      if (embedTexts.length > 0) {
        content = content ? `${content}\n\n${embedTexts.join('\n\n')}` : embedTexts.join('\n\n');
      }
    }

    // Include forwarded message content if this is a forwarded message
    if (discordMessage.messageSnapshots && discordMessage.messageSnapshots.length > 0) {
      const forwardedTexts = discordMessage.messageSnapshots.map(snapshot => {
        const msg = snapshot.message;
        const header = `[Forwarded from ${msg.author.username}]`;
        return `${header}\n${msg.content || '[No content]'}`;
      });

      if (forwardedTexts.length > 0) {
        const forwardedSection = `\n\n--- Forwarded Messages ---\n${forwardedTexts.join('\n\n')}`;
        content = content ? `${content}${forwardedSection}` : forwardedSection.trim();
      }
    }

    return content;
  }

  /**
   * Extracts attachments from Discord message
   * @private
   */
  static extractAttachments(discordMessage) {
    const attachments = [];

    if (discordMessage.attachments && discordMessage.attachments.size > 0) {
      discordMessage.attachments.forEach(attachment => {
        attachments.push({
          id: attachment.id,
          url: attachment.url,
          proxyUrl: attachment.proxyURL,
          filename: attachment.name,
          size: attachment.size,
          contentType: attachment.contentType,
          width: attachment.width,
          height: attachment.height,
          ephemeral: attachment.ephemeral || false,
        });
      });
    }

    return attachments;
  }

  /**
   * Extracts reference information from Discord message
   * @private
   */
  static extractReferences(discordMessage) {
    const references = {};

    if (discordMessage.reference) {
      references.messageId = discordMessage.reference.messageId;
      references.channelId = discordMessage.reference.channelId;
      references.guildId = discordMessage.reference.guildId;

      // Check if this is a forwarded message (type 1) vs a reply (type 0)
      if (discordMessage.reference.type !== undefined) {
        references.type = discordMessage.reference.type;
        references.isForwarded = discordMessage.reference.type === 1;
      }
    }

    // Check for stickers
    if (discordMessage.stickers && discordMessage.stickers.size > 0) {
      references.stickers = [];
      discordMessage.stickers.forEach(sticker => {
        references.stickers.push({
          id: sticker.id,
          name: sticker.name,
          format: sticker.format,
        });
      });
    }

    // Extract forwarded message snapshots if available
    if (discordMessage.messageSnapshots && discordMessage.messageSnapshots.length > 0) {
      references.forwardedSnapshots = discordMessage.messageSnapshots.map(snapshot => ({
        messageId: snapshot.message.id,
        channelId: snapshot.message.channel_id,
        guildId: snapshot.message.guild_id,
        content: snapshot.message.content,
        authorId: snapshot.message.author.id,
        authorUsername: snapshot.message.author.username,
        timestamp: snapshot.message.timestamp,
        attachments: snapshot.message.attachments || [],
      }));
    }

    return Object.keys(references).length > 0 ? references : null;
  }

  /**
   * Extracts mentions from Discord message
   * @private
   */
  static extractMentions(discordMessage) {
    const mentions = {};

    if (discordMessage.mentions.users && discordMessage.mentions.users.size > 0) {
      mentions.users = Array.from(discordMessage.mentions.users.values()).map(user => ({
        id: user.id,
        username: user.username,
        tag: user.tag,
      }));
    }

    if (discordMessage.mentions.roles && discordMessage.mentions.roles.size > 0) {
      mentions.roles = Array.from(discordMessage.mentions.roles.values()).map(role => ({
        id: role.id,
        name: role.name,
      }));
    }

    if (discordMessage.mentions.everyone) {
      mentions.everyone = true;
    }

    return Object.keys(mentions).length > 0 ? mentions : null;
  }

  /**
   * Checks if a message is a forwarded message
   * @param {Object} discordMessage - Discord.js message object
   * @returns {boolean} True if the message is forwarded
   */
  static isForwardedMessage(discordMessage) {
    return !!(
      discordMessage.reference?.type === 1 ||
      (discordMessage.messageSnapshots && discordMessage.messageSnapshots.length > 0)
    );
  }

  /**
   * Extracts context for AI processing
   * @param {Object} discordMessage - Discord.js message object
   * @returns {Object} Context object for AI processing
   */
  static extractAIContext(discordMessage) {
    const isForwarded = this.isForwardedMessage(discordMessage);
    const isReply = !!discordMessage.reference && !isForwarded;

    return {
      isDM: !discordMessage.guild,
      isReply,
      isForwarded,
      hasAttachments: discordMessage.attachments.size > 0,
      mentionsEveryone: discordMessage.mentions.everyone,
      mentionedUsers: Array.from(discordMessage.mentions.users.keys()),
      mentionedRoles: discordMessage.guild ? Array.from(discordMessage.mentions.roles.keys()) : [],
      channelType: discordMessage.channel.type,
      messageType: discordMessage.type,
      isPinned: discordMessage.pinned,
      isSystemMessage: discordMessage.system,
      forwardedMessageCount: discordMessage.messageSnapshots?.length || 0,
    };
  }

  /**
   * Determines if a message should be processed based on domain rules
   * @param {Object} discordMessage - Discord.js message object
   * @param {Object} options - Processing options
   * @returns {boolean} Whether the message should be processed
   */
  static shouldProcess(discordMessage, options = {}) {
    // Skip bot messages unless they're from webhooks we care about
    if (discordMessage.author.bot && !options.allowWebhooks) {
      return false;
    }

    // Skip system messages
    if (discordMessage.system) {
      return false;
    }

    // Skip empty messages without attachments
    if (!discordMessage.content && discordMessage.attachments.size === 0) {
      return false;
    }

    // Apply any custom filters
    if (options.filter && typeof options.filter === 'function') {
      return options.filter(discordMessage);
    }

    return true;
  }
}

module.exports = { DiscordMessageAdapter };
