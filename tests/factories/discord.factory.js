/**
 * Discord.js Mock Factory
 * Creates realistic mock objects for Discord.js v14 structures
 */

// Collection isn't used directly, we just use Map for testing

/**
 * Create a Collection with entries
 */
function createMockCollection(entries = []) {
  const collection = new Map();  // Use Map directly for testing
  entries.forEach(([key, value]) => {
    collection.set(key, value);
  });
  // Add Collection-like methods if needed
  if (!collection.find) {
    collection.find = function(fn) {
      for (const [key, value] of this.entries()) {
        if (fn(value, key)) return value;
      }
      return undefined;
    };
  }
  if (!collection.first) {
    collection.first = function() {
      return this.values().next().value;
    };
  }
  return collection;
}

/**
 * Create a mock User object
 */
function createMockUser(overrides = {}) {
  return {
    id: overrides.id || '123456789012345678',
    username: overrides.username || 'TestUser',
    discriminator: overrides.discriminator || '0001',
    avatar: overrides.avatar || 'avatar_hash',
    bot: overrides.bot || false,
    system: overrides.system || false,
    avatarURL: jest.fn(() => overrides.avatarURL || 'https://cdn.discordapp.com/avatars/123/avatar.png'),
    displayAvatarURL: jest.fn(() => overrides.avatarURL || 'https://cdn.discordapp.com/avatars/123/avatar.png'),
    tag: overrides.tag || 'TestUser#0001',
    ...overrides
  };
}

/**
 * Create a mock GuildMember object
 */
function createMockMember(overrides = {}) {
  const user = overrides.user || createMockUser();
  return {
    id: user.id,
    user: user,
    nickname: overrides.nickname || null,
    displayName: overrides.nickname || user.username,
    roles: overrides.roles || createMockCollection(),
    permissions: overrides.permissions || {
      has: jest.fn(() => false),
      toArray: jest.fn(() => [])
    },
    guild: overrides.guild || createMockGuild(),
    joinedAt: overrides.joinedAt || new Date('2024-01-15T12:00:00Z'),
    kick: jest.fn(),
    ban: jest.fn(),
    ...overrides
  };
}

/**
 * Create a mock Guild object
 */
function createMockGuild(overrides = {}) {
  return {
    id: overrides.id || '987654321098765432',
    name: overrides.name || 'Test Guild',
    ownerId: overrides.ownerId || '111111111111111111',
    members: overrides.members || createMockCollection(),
    channels: overrides.channels || createMockCollection(),
    roles: overrides.roles || createMockCollection(),
    available: overrides.available !== undefined ? overrides.available : true,
    ...overrides
  };
}

/**
 * Create a mock TextChannel object
 */
function createMockTextChannel(overrides = {}) {
  return {
    id: overrides.id || '555555555555555555',
    name: overrides.name || 'general',
    type: overrides.type || 0, // GUILD_TEXT
    guild: overrides.guild || createMockGuild(),
    parent: overrides.parent || null,
    parentId: overrides.parentId || null,
    nsfw: overrides.nsfw || false,
    topic: overrides.topic || null,
    send: jest.fn().mockResolvedValue({ id: '999999999999999999' }),
    messages: {
      fetch: jest.fn().mockResolvedValue(createMockCollection()),
      cache: createMockCollection()
    },
    isTextBased: jest.fn(() => true),
    isThread: jest.fn(() => false),
    ...overrides
  };
}

/**
 * Create a mock DMChannel object
 */
function createMockDMChannel(overrides = {}) {
  return {
    id: overrides.id || '666666666666666666',
    type: 1, // DM
    recipient: overrides.recipient || createMockUser(),
    send: jest.fn().mockResolvedValue({ id: '888888888888888888' }),
    messages: {
      fetch: jest.fn().mockResolvedValue(createMockCollection()),
      cache: createMockCollection()
    },
    isTextBased: jest.fn(() => true),
    isDMBased: jest.fn(() => true),
    guild: null,
    ...overrides
  };
}

/**
 * Create a mock ThreadChannel object
 */
function createMockThreadChannel(overrides = {}) {
  const parentChannel = overrides.parent || createMockTextChannel();
  return {
    id: overrides.id || '777777777777777777',
    name: overrides.name || 'thread-discussion',
    type: 11, // GUILD_PUBLIC_THREAD
    guild: overrides.guild || parentChannel.guild,
    parent: parentChannel,
    parentId: parentChannel.id,
    ownerId: overrides.ownerId || '123456789012345678',
    send: jest.fn().mockResolvedValue({ id: '444444444444444444' }),
    messages: {
      fetch: jest.fn().mockResolvedValue(createMockCollection()),
      cache: createMockCollection()
    },
    isTextBased: jest.fn(() => true),
    isThread: jest.fn(() => true),
    ...overrides
  };
}

/**
 * Create a mock Attachment object
 */
function createMockAttachment(overrides = {}) {
  return {
    id: overrides.id || '333333333333333333',
    name: overrides.name || 'image.png',
    url: overrides.url || 'https://cdn.discordapp.com/attachments/123/456/image.png',
    proxyURL: overrides.proxyURL || 'https://media.discordapp.net/attachments/123/456/image.png',
    contentType: overrides.contentType || 'image/png',
    size: overrides.size || 1024,
    height: overrides.height || 500,
    width: overrides.width || 500,
    ...overrides
  };
}

/**
 * Create a mock Embed object
 */
function createMockEmbed(overrides = {}) {
  return {
    title: overrides.title || null,
    description: overrides.description || null,
    url: overrides.url || null,
    color: overrides.color || null,
    fields: overrides.fields || [],
    thumbnail: overrides.thumbnail || null,
    image: overrides.image || null,
    author: overrides.author || null,
    footer: overrides.footer || null,
    timestamp: overrides.timestamp || null,
    ...overrides
  };
}

/**
 * Create a mock WebhookClient
 */
function createMockWebhookClient(overrides = {}) {
  return {
    id: overrides.id || '222222222222222222',
    token: overrides.token || 'webhook_token_here',
    send: jest.fn().mockResolvedValue({ id: '111111111111111111' }),
    edit: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true),
    ...overrides
  };
}

module.exports = {
  createMockUser,
  createMockMember,
  createMockGuild,
  createMockTextChannel,
  createMockDMChannel,
  createMockThreadChannel,
  createMockAttachment,
  createMockEmbed,
  createMockWebhookClient,
  createMockCollection
};