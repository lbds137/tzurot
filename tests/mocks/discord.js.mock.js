// This is a mock for Discord.js to avoid making real API calls during tests

const EventEmitter = require('events');

class Client extends EventEmitter {
  constructor() {
    super();
    this.user = {
      id: 'mock-bot-id',
      tag: 'MockBot#0000',
      setActivity: jest.fn()
    };
    this.channels = {
      cache: new Map(),
      fetch: jest.fn().mockResolvedValue(null)
    };
    this.guilds = {
      cache: new Map(),
      fetch: jest.fn().mockResolvedValue(null)
    };
    this.login = jest.fn().mockResolvedValue('mock-token');
    this.emit = jest.fn();
  }
}

class TextChannel {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.type = 0;
    this.isTextBased = () => true;
    this.isDMBased = () => false;
    this.send = jest.fn().mockResolvedValue({ id: 'mock-message-id' });
    this.messages = {
      fetch: jest.fn().mockResolvedValue(null)
    };
    this.permissionsFor = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true)
    });
    this.sendTyping = jest.fn().mockResolvedValue();
  }
}

class User {
  constructor(id, username, bot = false) {
    this.id = id;
    this.username = username;
    this.tag = `${username}#0000`;
    this.bot = bot;
  }
}

class Message {
  constructor(id, content, authorId, channelId) {
    this.id = id;
    this.content = content;
    this.author = new User(authorId, 'MockUser');
    this.channel = new TextChannel(channelId, 'mock-channel');
    this.guild = { id: 'mock-guild-id' };
    this.reply = jest.fn().mockResolvedValue({ id: 'mock-reply-id' });
    this.delete = jest.fn().mockResolvedValue();
    this.webhookId = null;
    this.embeds = [];
    this.reference = null;
    this.member = {
      permissions: {
        has: jest.fn().mockReturnValue(true)
      }
    };
  }
}

class EmbedBuilder {
  constructor() {
    this.data = {
      title: null,
      description: null,
      color: null,
      fields: [],
      footer: null,
      thumbnail: null
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

  setFooter(footer) {
    this.data.footer = footer;
    return this;
  }

  addFields(...fields) {
    this.data.fields.push(...fields);
    return this;
  }

  toJSON() {
    return this.data;
  }
}

class REST {
  constructor() {
    this.setToken = jest.fn().mockReturnThis();
    this.post = jest.fn().mockResolvedValue({ id: 'mock-response-id' });
  }
}

module.exports = {
  Client,
  TextChannel,
  User,
  Message,
  EmbedBuilder,
  REST,
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 4,
    GuildWebhooks: 8,
    DirectMessages: 16
  },
  Partials: {
    Channel: 'CHANNEL',
    Message: 'MESSAGE',
    Reaction: 'REACTION'
  },
  PermissionFlagsBits: {
    Administrator: 'ADMINISTRATOR',
    ManageMessages: 'MANAGE_MESSAGES',
    ViewChannel: 'VIEW_CHANNEL',
    ReadMessageHistory: 'READ_MESSAGE_HISTORY'
  }
};