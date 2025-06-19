/**
 * Consolidated Discord.js Mock Implementation
 * Combines and improves the existing Discord mocks into a single, comprehensive system
 */

const EventEmitter = require('events');

/**
 * Mock Discord User
 */
class MockUser {
  constructor(options = {}) {
    this.id = options.id || `user-${Date.now()}`;
    this.username = options.username || 'MockUser';
    this.discriminator = options.discriminator || '0000';
    this.tag = `${this.username}#${this.discriminator}`;
    this.bot = options.bot || false;
    this.avatar = options.avatar || null;
    this.createdTimestamp = Date.now();
  }

  toString() {
    return `<@${this.id}>`;
  }
}

/**
 * Mock Discord Channel
 */
class MockChannel {
  constructor(options = {}) {
    this.id = options.id || `channel-${Date.now()}`;
    this.name = options.name || 'mock-channel';
    this.type = options.type || 0; // Text channel
    this.nsfw = options.nsfw || false;
    this.guild = options.guild || null;
    this.parentId = options.parentId || null;

    // Mock methods
    this.send = jest.fn().mockImplementation(async content => {
      return new MockMessage({
        id: `msg-${Date.now()}`,
        content: typeof content === 'string' ? content : '',
        channel: this,
        embeds: content?.embeds || [],
      });
    });

    this.sendTyping = jest.fn().mockResolvedValue(true);
    this.isTextBased = () => true;
    this.isDMBased = () => this.type === 1;

    this.permissionsFor = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });

    this.messages = {
      fetch: jest.fn().mockImplementation(async (options = {}) => {
        const messages = new Map();
        const limit = options.limit || 50;

        for (let i = 0; i < Math.min(limit, 5); i++) {
          const msg = new MockMessage({
            id: `fetched-msg-${i}`,
            content: `Mock message ${i}`,
            channel: this,
          });
          messages.set(msg.id, msg);
        }

        return messages;
      }),
    };
  }

  toString() {
    return `<#${this.id}>`;
  }
}

/**
 * Mock Discord Message
 */
class MockMessage {
  constructor(options = {}) {
    this.id = options.id || `msg-${Date.now()}`;
    this.content = options.content || '';
    this.author = options.author || new MockUser({ bot: false });
    this.channel = options.channel || new MockChannel();
    this.guild = options.guild || (this.channel.guild ? this.channel.guild : { id: 'mock-guild' });
    this.webhookId = options.webhookId || null;
    this.embeds = options.embeds || [];
    this.reference = options.reference || null;
    this.attachments = new Map();
    this.reactions = { cache: new Map() };
    this.createdTimestamp = Date.now();

    // Mock member if in a guild
    if (this.guild) {
      this.member = options.member || {
        id: this.author.id,
        user: this.author,
        permissions: {
          has: jest.fn().mockReturnValue(true),
        },
      };
    }

    // Mock methods
    this.reply = jest.fn().mockImplementation(async content => {
      return new MockMessage({
        id: `reply-${Date.now()}`,
        content: typeof content === 'string' ? content : '',
        author: this.channel.guild ? { id: 'bot-id', bot: true } : this.author,
        channel: this.channel,
        reference: { messageId: this.id },
        embeds: content?.embeds || [],
      });
    });

    this.delete = jest.fn().mockImplementation(async () => {
      return this;
    });

    this.edit = jest.fn().mockImplementation(async content => {
      this.content = typeof content === 'string' ? content : this.content;
      return this;
    });
  }

  toString() {
    return this.content;
  }
}

/**
 * Mock Discord Guild
 */
class MockGuild {
  constructor(options = {}) {
    this.id = options.id || `guild-${Date.now()}`;
    this.name = options.name || 'Mock Guild';
    this.channels = { cache: new Map() };
    this.members = { cache: new Map() };
    this.roles = { cache: new Map() };
  }
}

/**
 * Mock Discord Client
 */
class MockClient extends EventEmitter {
  constructor(options = {}) {
    super();

    this.user = new MockUser({
      id: 'bot-user-id',
      username: 'MockBot',
      bot: true,
      ...options.user,
    });

    this.channels = {
      cache: new Map(),
      fetch: jest.fn().mockImplementation(async id => {
        if (this.channels.cache.has(id)) {
          return this.channels.cache.get(id);
        }
        const channel = new MockChannel({ id });
        this.channels.cache.set(id, channel);
        return channel;
      }),
    };

    this.guilds = {
      cache: new Map(),
      fetch: jest.fn().mockImplementation(async id => {
        if (this.guilds.cache.has(id)) {
          return this.guilds.cache.get(id);
        }
        const guild = new MockGuild({ id });
        this.guilds.cache.set(id, guild);
        return guild;
      }),
    };

    this.login = jest.fn().mockImplementation(async token => {
      this.token = token;
      // Simulate ready event
      setImmediate(() => this.emit('ready'));
      return token;
    });

    this.destroy = jest.fn().mockResolvedValue(true);
  }
}

/**
 * Mock Discord Webhook
 */
class MockWebhook {
  constructor(options = {}) {
    this.id = options.id || `webhook-${Date.now()}`;
    this.name = options.name || 'Mock Webhook';
    this.avatar = options.avatar || null;
    this.channelId = options.channelId || 'mock-channel-id';
    this.guildId = options.guildId || 'mock-guild-id';
    this.url = `https://discord.com/api/webhooks/${this.id}/mock-token`;

    this.send = jest.fn().mockImplementation(async content => {
      return new MockMessage({
        id: `webhook-msg-${Date.now()}`,
        content: typeof content === 'string' ? content : '',
        author: new MockUser({
          id: 'webhook-user-id',
          username: this.name,
          bot: true,
        }),
        webhookId: this.id,
        embeds: content?.embeds || [],
      });
    });

    this.edit = jest.fn().mockImplementation(async options => {
      Object.assign(this, options);
      return this;
    });

    this.delete = jest.fn().mockResolvedValue(true);
  }
}

/**
 * Mock EmbedBuilder
 */
class MockEmbedBuilder {
  constructor(data = {}) {
    this.data = {
      title: null,
      description: null,
      color: null,
      fields: [],
      footer: null,
      thumbnail: null,
      image: null,
      timestamp: null,
      ...data,
    };
  }

  setTitle(title) {
    this.data.title = title;
    return this;
  }

  setDescription(description) {
    this.data.description = description;
    return this;
  }

  setColor(color) {
    this.data.color = color;
    return this;
  }

  setThumbnail(url) {
    this.data.thumbnail = { url };
    return this;
  }

  setImage(url) {
    this.data.image = { url };
    return this;
  }

  setFooter(footer) {
    this.data.footer = footer;
    return this;
  }

  setTimestamp(timestamp = new Date()) {
    this.data.timestamp = timestamp;
    return this;
  }

  addFields(...fields) {
    this.data.fields.push(...fields);
    return this;
  }

  toJSON() {
    return { ...this.data };
  }
}

/**
 * Mock Webhook Client
 */
class MockWebhookClient {
  constructor(url) {
    this.url = url;
    this.send = jest.fn().mockImplementation(async options => {
      return new MockMessage({
        id: `webhook-msg-${Date.now()}`,
        content: options.content || '',
        author: new MockUser({ username: options.username || 'Webhook' }),
        embeds: options.embeds || [],
        attachments: options.files || [],
      });
    });

    this.thread = jest.fn().mockImplementation(threadId => {
      return {
        send: jest.fn().mockImplementation(async options => {
          return new MockMessage({
            id: `thread-msg-${Date.now()}`,
            content: options.content || '',
            author: new MockUser({ username: options.username || 'Webhook' }),
            embeds: options.embeds || [],
            attachments: options.files || [],
            channelId: threadId,
          });
        }),
      };
    });

    this.edit = jest.fn().mockResolvedValue({});
    this.delete = jest.fn().mockResolvedValue({});
  }
}

/**
 * Mock REST API Client
 */
class MockREST {
  constructor() {
    this.setToken = jest.fn().mockReturnThis();
    this.post = jest.fn().mockImplementation(async (endpoint, options) => {
      return { id: `api-response-${Date.now()}` };
    });
    this.get = jest.fn().mockResolvedValue({});
    this.patch = jest.fn().mockResolvedValue({});
    this.delete = jest.fn().mockResolvedValue({});
  }
}

/**
 * Factory function to create Discord mock environment
 * @param {Object} options - Configuration options
 * @returns {Object} Discord mock environment
 */
function createDiscordEnvironment(options = {}) {
  const client = new MockClient(options.client);

  // Add some default channels and guilds if requested
  if (options.setupDefaults !== false) {
    const defaultGuild = new MockGuild({ id: 'default-guild' });
    const defaultChannel = new MockChannel({
      id: 'default-channel',
      guild: defaultGuild,
      nsfw: options.nsfw || false,
    });

    client.guilds.cache.set(defaultGuild.id, defaultGuild);
    client.channels.cache.set(defaultChannel.id, defaultChannel);
  }

  return {
    client,
    createChannel: opts => new MockChannel(opts),
    createMessage: opts => new MockMessage(opts),
    createUser: opts => new MockUser(opts),
    createWebhook: opts => new MockWebhook(opts),
    createEmbed: opts => new MockEmbedBuilder(opts),
  };
}

// Export the complete Discord.js mock module
module.exports = {
  // Classes
  Client: MockClient,
  Channel: MockChannel,
  TextChannel: MockChannel,
  Message: MockMessage,
  User: MockUser,
  Guild: MockGuild,
  Webhook: MockWebhook,
  WebhookClient: MockWebhookClient,
  EmbedBuilder: MockEmbedBuilder,
  REST: MockREST,

  // Constants
  GatewayIntentBits: {
    Guilds: 1 << 0,
    GuildMessages: 1 << 9,
    MessageContent: 1 << 15,
    GuildWebhooks: 1 << 5,
    DirectMessages: 1 << 12,
  },

  Partials: {
    Channel: 'CHANNEL',
    Message: 'MESSAGE',
    Reaction: 'REACTION',
  },

  PermissionFlagsBits: {
    Administrator: 1n << 3n,
    ManageMessages: 1n << 13n,
    ViewChannel: 1n << 10n,
    ReadMessageHistory: 1n << 16n,
    ManageWebhooks: 1n << 29n,
  },

  // Factory function
  createDiscordEnvironment,
};
