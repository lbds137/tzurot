/**
 * Message Factory
 * Fluent builder pattern for creating Discord Message mocks
 */

const {
  createMockUser,
  createMockMember,
  createMockGuild,
  createMockTextChannel,
  createMockDMChannel,
  createMockThreadChannel,
  createMockAttachment,
  createMockEmbed,
  createMockCollection
} = require('./discord.factory');

class MessageFactory {
  constructor() {
    // Set up default message structure
    const defaultUser = createMockUser();
    const defaultGuild = createMockGuild();
    const defaultChannel = createMockTextChannel({ guild: defaultGuild });
    const defaultMember = createMockMember({ user: defaultUser, guild: defaultGuild });

    this.message = {
      id: '999999999999999999',
      content: 'default test message',
      author: defaultUser,
      member: defaultMember,
      guild: defaultGuild,
      channel: defaultChannel,
      channelId: defaultChannel.id,
      guildId: defaultGuild.id,
      createdAt: new Date('2024-01-15T12:00:00Z'),
      createdTimestamp: new Date('2024-01-15T12:00:00Z').getTime(),
      editedAt: null,
      editedTimestamp: null,
      attachments: createMockCollection(),
      embeds: [],
      mentions: {
        users: createMockCollection(),
        members: createMockCollection(),
        roles: createMockCollection(),
        channels: createMockCollection(),
        everyone: false
      },
      reference: null,
      webhookId: null,
      type: 'DEFAULT',
      system: false,
      pinned: false,
      tts: false,
      nonce: null,
      stickers: createMockCollection(),
      components: [],
      
      // Mock methods
      reply: jest.fn().mockResolvedValue({ id: 'reply_message_id' }),
      delete: jest.fn().mockResolvedValue(true),
      edit: jest.fn().mockResolvedValue(this),
      react: jest.fn().mockResolvedValue(true),
      fetch: jest.fn().mockResolvedValue(this),
      fetchReference: jest.fn().mockResolvedValue(null)
    };
  }

  /**
   * Set message content
   */
  withContent(content) {
    this.message.content = content;
    return this;
  }

  /**
   * Set message author
   */
  fromUser(userOverrides) {
    this.message.author = createMockUser(userOverrides);
    if (this.message.guild && this.message.member) {
      this.message.member = createMockMember({ 
        user: this.message.author, 
        guild: this.message.guild 
      });
    }
    return this;
  }

  /**
   * Set the guild
   */
  inGuild(guildOverrides) {
    this.message.guild = createMockGuild(guildOverrides);
    this.message.guildId = this.message.guild.id;
    // Update channel to be in this guild
    if (this.message.channel && this.message.channel.type !== 1) { // Not DM
      this.message.channel.guild = this.message.guild;
    }
    // Update member to be in this guild
    if (this.message.member) {
      this.message.member.guild = this.message.guild;
    }
    return this;
  }

  /**
   * Set the channel
   */
  inChannel(channelOverrides) {
    this.message.channel = createMockTextChannel({
      ...channelOverrides,
      guild: this.message.guild
    });
    this.message.channelId = this.message.channel.id;
    return this;
  }

  /**
   * Make this a DM message
   */
  asDM() {
    const dmChannel = createMockDMChannel({ 
      recipient: this.message.author 
    });
    this.message.channel = dmChannel;
    this.message.channelId = dmChannel.id;
    this.message.guild = null;
    this.message.guildId = null;
    this.message.member = null;
    return this;
  }

  /**
   * Make this a thread message
   */
  asThread(threadOverrides = {}) {
    const parentChannel = this.message.channel.type === 0 
      ? this.message.channel 
      : createMockTextChannel({ guild: this.message.guild });
    
    const threadChannel = createMockThreadChannel({
      ...threadOverrides,
      parent: parentChannel,
      guild: this.message.guild
    });
    
    this.message.channel = threadChannel;
    this.message.channelId = threadChannel.id;
    return this;
  }

  /**
   * Make this a webhook message (like PluralKit)
   */
  asWebhook(webhookData = {}) {
    this.message.webhookId = webhookData.id || '888888888888888888';
    this.message.author = createMockUser({
      bot: true,
      username: webhookData.username || 'Webhook User',
      avatar: webhookData.avatar || 'webhook_avatar',
      ...webhookData
    });
    this.message.member = null; // Webhooks don't have members
    return this;
  }

  /**
   * Add an attachment
   */
  withAttachment(url, overrides = {}) {
    const attachment = createMockAttachment({
      url,
      ...overrides
    });
    this.message.attachments.set(attachment.id, attachment);
    return this;
  }

  /**
   * Add an embed
   */
  withEmbed(embedOverrides) {
    const embed = createMockEmbed(embedOverrides);
    this.message.embeds.push(embed);
    return this;
  }

  /**
   * Make this a reply to another message
   */
  asReplyTo(originalMessage) {
    this.message.reference = {
      messageId: originalMessage.id,
      channelId: originalMessage.channel?.id || originalMessage.channelId,
      guildId: originalMessage.guild?.id || originalMessage.guildId || null
    };
    this.message.fetchReference = jest.fn().mockResolvedValue(originalMessage);
    return this;
  }

  /**
   * Add a user mention
   */
  withMention(user) {
    const mockUser = typeof user === 'object' ? user : createMockUser({ id: user });
    this.message.mentions.users.set(mockUser.id, mockUser);
    if (this.message.guild) {
      const mockMember = createMockMember({ 
        user: mockUser, 
        guild: this.message.guild 
      });
      this.message.mentions.members.set(mockUser.id, mockMember);
    }
    return this;
  }

  /**
   * Set created timestamp
   */
  createdAt(date) {
    this.message.createdAt = date;
    this.message.createdTimestamp = date.getTime();
    return this;
  }

  /**
   * Override any property directly
   */
  with(overrides) {
    Object.assign(this.message, overrides);
    return this;
  }

  /**
   * Build the final message object
   */
  build() {
    // Deep clone to prevent test interference
    const cloned = JSON.parse(JSON.stringify(this.message));
    
    // Restore mock functions that were lost in cloning
    cloned.reply = jest.fn().mockResolvedValue({ id: 'reply_message_id' });
    cloned.delete = jest.fn().mockResolvedValue(true);
    cloned.edit = jest.fn().mockResolvedValue(cloned);
    cloned.react = jest.fn().mockResolvedValue(true);
    cloned.fetch = jest.fn().mockResolvedValue(cloned);
    cloned.fetchReference = this.message.fetchReference;
    
    // Restore collections
    cloned.attachments = this.message.attachments;
    cloned.mentions = this.message.mentions;
    cloned.stickers = this.message.stickers;
    
    // Restore method on nested objects
    if (cloned.author) {
      cloned.author.avatarURL = jest.fn(() => cloned.author.avatar);
      cloned.author.displayAvatarURL = jest.fn(() => cloned.author.avatar);
    }
    
    if (cloned.channel) {
      cloned.channel.send = jest.fn().mockResolvedValue({ id: 'sent_message_id' });
      cloned.channel.isTextBased = jest.fn(() => true);
      cloned.channel.isThread = jest.fn(() => cloned.channel.type === 11);
      cloned.channel.isDMBased = jest.fn(() => cloned.channel.type === 1);
    }
    
    return cloned;
  }
}

/**
 * Preset factories for common scenarios
 */
const Factories = {
  /**
   * Create a standard guild message
   */
  createGuildMessage: (content = 'test message') => 
    new MessageFactory().withContent(content).build(),
  
  /**
   * Create a DM message
   */
  createDMMessage: (content = 'dm message') => 
    new MessageFactory().withContent(content).asDM().build(),
  
  /**
   * Create a thread message
   */
  createThreadMessage: (content = 'thread message') => 
    new MessageFactory().withContent(content).asThread().build(),
  
  /**
   * Create a PluralKit/webhook message
   */
  createWebhookMessage: (content = 'webhook message', username = 'System Member') => 
    new MessageFactory()
      .withContent(content)
      .asWebhook({ username })
      .build(),
  
  /**
   * Create a message with media attachment
   */
  createMediaMessage: (content = 'media message', attachmentUrl = 'https://example.com/image.png') =>
    new MessageFactory()
      .withContent(content)
      .withAttachment(attachmentUrl)
      .build(),
  
  /**
   * Create a message with personality mention
   */
  createMentionMessage: (content = '@claude hello') =>
    new MessageFactory()
      .withContent(content)
      .build(),
  
  /**
   * Create a reply message
   */
  createReplyMessage: (content = 'this is a reply', originalMessage) => {
    if (!originalMessage) {
      originalMessage = new MessageFactory().withContent('original message').build();
    }
    return new MessageFactory()
      .withContent(content)
      .asReplyTo(originalMessage)
      .build();
  }
};

module.exports = {
  MessageFactory,
  ...Factories
};