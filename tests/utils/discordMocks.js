/**
 * Discord.js Mocking Utilities for Testing
 * This file provides mock implementations of Discord.js components to facilitate testing.
 */

/**
 * Create a mock Discord Message object
 * @param {Object} options - Message options
 * @param {string} options.id - Message ID
 * @param {Object} options.author - Author properties
 * @param {string} options.content - Message content
 * @param {Object} options.channel - Channel properties
 * @param {Array} options.embeds - Embeds array
 * @param {Object} options.reference - Reference to replied message
 * @param {boolean} options.isWebhook - Whether this is a webhook message
 * @returns {Object} Mock Message object
 */
function createMockMessage(options = {}) {
  const defaults = {
    id: `mock-message-${Date.now()}`,
    author: {
      id: 'mock-user-id',
      tag: 'MockUser#1234',
      bot: false,
      username: 'MockUser',
    },
    content: 'Mock message content',
    channel: createMockChannel(),
    embeds: [],
    reference: null,
    webhookId: options.isWebhook ? 'mock-webhook-id' : null,
    guild: { id: 'mock-guild-id' },
    member: {
      permissions: {
        has: permission => true,
      },
    },
    deletable: true,
  };

  const mockMessage = {
    ...defaults,
    ...options,
    reply: jest.fn().mockImplementation(async content => {
      return createMockMessage({
        id: `reply-to-${options.id || defaults.id}`,
        reference: { messageId: options.id || defaults.id },
      });
    }),
    delete: jest.fn().mockResolvedValue(true),
    reactions: {
      cache: new Map(),
    },
  };

  // If the guild was provided but not the member, create a mock member
  if (mockMessage.guild && !options.member) {
    mockMessage.member = {
      permissions: {
        has: jest.fn().mockReturnValue(true),
      },
    };
  }

  return mockMessage;
}

/**
 * Create a mock Discord Channel object
 * @param {Object} options - Channel options
 * @param {string} options.id - Channel ID
 * @param {string} options.name - Channel name
 * @param {boolean} options.isText - Is this a text channel
 * @returns {Object} Mock Channel object
 */
function createMockChannel(options = {}) {
  const defaults = {
    id: 'mock-channel-id',
    name: 'mock-channel',
    isText: true,
    isDMBased: () => false,
    isTextBased: () => true,
    send: jest.fn().mockImplementation(async content => {
      return createMockMessage({
        channel: { id: options.id || defaults.id },
      });
    }),
    sendTyping: jest.fn().mockResolvedValue(true),
    permissionsFor: jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    }),
    messages: {
      fetch: jest.fn().mockImplementation(async (options = {}) => {
        const messages = new Map();
        // Create a few mock messages
        for (let i = 0; i < (options.limit || 3); i++) {
          const msg = createMockMessage({
            id: `mock-fetched-message-${i}`,
            channel: { id: options.id || defaults.id },
          });
          messages.set(msg.id, msg);
        }
        return messages;
      }),
    },
    guild: { id: 'mock-guild-id' },
  };

  return {
    ...defaults,
    ...options,
  };
}

/**
 * Create a mock Discord Client object
 * @param {Object} options - Client options
 * @returns {Object} Mock Client object
 */
function createMockClient(options = {}) {
  const channels = new Map();
  const defaults = {
    user: {
      id: 'mock-bot-id',
      tag: 'MockBot#0000',
      setActivity: jest.fn(),
    },
    channels: {
      cache: channels,
      fetch: jest.fn().mockImplementation(async id => {
        if (channels.has(id)) {
          return channels.get(id);
        }
        const newChannel = createMockChannel({ id });
        channels.set(id, newChannel);
        return newChannel;
      }),
    },
    guilds: {
      cache: new Map(),
    },
    login: jest.fn().mockResolvedValue('mock-token'),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn().mockImplementation((event, ...args) => {
      // If listeners were registered with on(), call them
      if (mockClient._listeners && mockClient._listeners[event]) {
        mockClient._listeners[event].forEach(listener => {
          listener(...args);
        });
      }
      return true;
    }),
  };

  const mockClient = {
    ...defaults,
    ...options,
    // Add an internal store for listeners to simulate event handling
    _listeners: {},
    // Override on() to store listeners
    on: jest.fn().mockImplementation((event, listener) => {
      if (!mockClient._listeners[event]) {
        mockClient._listeners[event] = [];
      }
      mockClient._listeners[event].push(listener);
      return mockClient;
    }),
  };

  return mockClient;
}

/**
 * Create a mock Discord Webhook object
 * @param {Object} options - Webhook options
 * @returns {Object} Mock Webhook object
 */
function createMockWebhook(options = {}) {
  const defaults = {
    id: 'mock-webhook-id',
    name: 'Mock Webhook',
    channelId: 'mock-channel-id',
    send: jest.fn().mockImplementation(async content => {
      return createMockMessage({
        webhookId: options.id || defaults.id,
        author: {
          id: 'webhook-user-id',
          username: options.name || defaults.name,
          bot: true,
        },
        content: typeof content === 'string' ? content : '',
        embeds: content.embeds || [],
      });
    }),
  };

  return {
    ...defaults,
    ...options,
  };
}

/**
 * Create a mock REST API client
 * @returns {Object} Mock REST API client
 */
function createMockRESTClient() {
  return {
    setToken: jest.fn().mockReturnThis(),
    post: jest.fn().mockImplementation(async (endpoint, options) => {
      // Simulate successful response with generated ID
      return { id: `mock-api-response-${Date.now()}` };
    }),
  };
}

/**
 * Create a mock Embed object
 * @param {Object} options - Embed options
 * @returns {Object} Mock Embed object
 */
function createMockEmbed(options = {}) {
  const defaults = {
    title: 'Mock Embed',
    description: 'Mock embed description',
    color: 0x0099ff,
    fields: [],
    timestamp: new Date(),
    thumbnail: options.thumbnailUrl ? { url: options.thumbnailUrl } : null,
  };

  const mockEmbed = {
    ...defaults,
    ...options,
    // Builder pattern methods
    setTitle: jest.fn().mockImplementation(title => {
      mockEmbed.title = title;
      return mockEmbed;
    }),
    setDescription: jest.fn().mockImplementation(desc => {
      mockEmbed.description = desc;
      return mockEmbed;
    }),
    setColor: jest.fn().mockImplementation(color => {
      mockEmbed.color = color;
      return mockEmbed;
    }),
    addFields: jest.fn().mockImplementation(fields => {
      if (Array.isArray(fields)) {
        mockEmbed.fields.push(...fields);
      } else {
        mockEmbed.fields.push(fields);
      }
      return mockEmbed;
    }),
    setThumbnail: jest.fn().mockImplementation(url => {
      mockEmbed.thumbnail = { url };
      return mockEmbed;
    }),
    setFooter: jest.fn().mockImplementation(footer => {
      mockEmbed.footer = footer;
      return mockEmbed;
    }),
    toJSON: jest.fn().mockImplementation(() => {
      return { ...mockEmbed };
    }),
  };

  return mockEmbed;
}

/**
 * Create mock Discord.js permissions
 * @returns {Object} Mock permissions constants
 */
function createMockPermissions() {
  return {
    FLAGS: {
      VIEW_CHANNEL: 1 << 0,
      READ_MESSAGE_HISTORY: 1 << 1,
      MANAGE_MESSAGES: 1 << 2,
      MANAGE_WEBHOOKS: 1 << 3,
      ADMINISTRATOR: 1 << 4,
    },
    Flags: {
      ViewChannel: 1 << 0,
      ReadMessageHistory: 1 << 1,
      ManageMessages: 1 << 2,
      ManageWebhooks: 1 << 3,
      Administrator: 1 << 4,
    },
  };
}

/**
 * Mock the entire Discord.js module
 * @returns {Object} Mock Discord.js module
 */
function mockDiscordJs() {
  const Permissions = createMockPermissions();

  return {
    Client: jest.fn().mockImplementation(() => createMockClient()),
    WebhookClient: jest.fn().mockImplementation(() => createMockWebhook()),
    MessageEmbed: jest.fn().mockImplementation(() => createMockEmbed()),
    EmbedBuilder: jest.fn().mockImplementation(() => createMockEmbed()),
    Permissions,
    PermissionFlagsBits: Permissions.Flags,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4,
      GuildWebhooks: 8,
      DirectMessages: 16,
    },
    Partials: {
      Channel: 1,
      Message: 2,
      Reaction: 4,
    },
    TextChannel: function () {
      this.send = jest.fn();
    },
    REST: jest.fn().mockImplementation(() => createMockRESTClient()),
    Routes: {
      applicationCommands: jest.fn(),
      webhooks: jest.fn(),
      channels: jest.fn(),
    },
    Collection: class Collection extends Map {},
  };
}

module.exports = {
  createMockMessage,
  createMockChannel,
  createMockClient,
  createMockWebhook,
  createMockEmbed,
  createMockRESTClient,
  createMockPermissions,
  mockDiscordJs,
};
