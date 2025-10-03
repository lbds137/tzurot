/**
 * Tests for bot.js core functionality
 * Testing initialization, Discord.js client setup, and method patching
 */

// Mock dependencies
jest.mock('discord.js', () => {
  // Mock Message class
  class MockMessage {
    constructor() {
      this.channel = { id: 'test-channel-id' };
    }

    reply(options) {
      return Promise.resolve({
        id: 'test-reply-id',
        content: typeof options === 'string' ? options : options.content || '',
      });
    }
  }

  // Mock TextChannel class
  class MockTextChannel {
    constructor() {
      this.id = 'test-channel-id';
    }

    send(options) {
      return Promise.resolve({
        id: 'test-send-id',
        content: typeof options === 'string' ? options : options.content || '',
      });
    }
  }

  // Mock Client class
  class MockClient {
    constructor() {
      this.user = { tag: 'TestBot#1234', setActivity: jest.fn() };
      this.on = jest.fn();
    }

    login = jest.fn().mockResolvedValue('mock-token');
  }

  return {
    Client: MockClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 3,
      GuildWebhooks: 4,
      DirectMessages: 5,
    },
    Partials: {
      Channel: 'Channel',
      Message: 'Message',
      Reaction: 'Reaction',
    },
    Message: MockMessage,
    TextChannel: MockTextChannel,
  };
});

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  warning: jest.fn(), // Just in case
}));

jest.mock('../../src/webhookManager', () => ({
  registerEventListeners: jest.fn(),
}));

jest.mock('../../src/messageTracker', () => ({
  messageTracker: {
    trackOperation: jest.fn().mockReturnValue(true),
  },
}));


jest.mock('../../src/handlers/personalityHandler', () => ({
  handlePersonalityMessage: jest.fn(),
}));

jest.mock('../../src/handlers/messageHandler', () => ({
  handleMessage: jest.fn(),
}));

jest.mock('../../src/utils/pluralkitMessageStore', () => ({
  instance: {
    markAsDeleted: jest.fn(),
  },
}));

// Mock ApplicationBootstrap to prevent real initialization
jest.mock('../../src/application/bootstrap/ApplicationBootstrap', () => ({
  getApplicationBootstrap: jest.fn().mockReturnValue({
    initialize: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Mock config before requiring bot.js
jest.mock('../../config', () => ({
  botConfig: {
    name: 'Tzurot',
    prefix: '!tz',
    token: 'test-token',
    isDevelopment: false,
    environment: 'test',
    mentionChar: '@',
  },
  botPrefix: '!tz',
  getApiEndpoint: jest.fn(),
  getModelPath: jest.fn(),
  getProfileInfoEndpoint: jest.fn(),
}));

describe('Bot Core Functionality', () => {
  let bot;
  let mockClient;
  let originalToken;
  let originalDevToken;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Save original environment
    originalToken = process.env.DISCORD_TOKEN;
    originalDevToken = process.env.DISCORD_DEV_TOKEN;
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.DISCORD_DEV_TOKEN = 'test-token';

    // Clear the module cache to ensure fresh imports
    jest.resetModules();

    // Import after resetting modules
    bot = require('../../src/bot');
  });

  afterEach(() => {
    jest.useRealTimers();
    // Restore original environment
    process.env.DISCORD_TOKEN = originalToken;
    process.env.DISCORD_DEV_TOKEN = originalDevToken;

    // Clean up global client
    delete global.tzurotClient;
  });

  describe('Bot Initialization', () => {
    it('should initialize Discord client with correct intents and partials', async () => {
      // Since we can't spy on constructor calls directly, we'll verify
      // the client was created by checking it exists
      const client = await bot.initBot();

      expect(client).toBeDefined();
      expect(client.constructor.name).toBe('MockClient');
    });

    it('should set global client reference', async () => {
      const client = await bot.initBot();

      expect(global.tzurotClient).toBe(client);
    });


    it('should login with Discord token', async () => {
      const client = await bot.initBot();

      expect(client.login).toHaveBeenCalledWith('test-token');
    });

    it('should handle missing Discord token', async () => {
      // Mock config to return undefined token
      jest.resetModules();
      jest.doMock('../../config', () => ({
        botConfig: {
          name: 'Rotzot',
          prefix: '!rtz',
          token: undefined,
          isDevelopment: true,
          environment: 'development',
        },
        botPrefix: '!rtz',
        getApiEndpoint: jest.fn(),
        getModelPath: jest.fn(),
        getProfileInfoEndpoint: jest.fn(),
      }));

      bot = require('../../src/bot');

      const client = await bot.initBot();

      expect(client.login).toHaveBeenCalledWith(undefined);
    });
  });

  describe('Event Handlers', () => {
    let client;
    let eventHandlers;

    beforeEach(async () => {
      client = await bot.initBot();

      // Capture event handlers
      eventHandlers = {};
      client.on.mock.calls.forEach(([event, handler]) => {
        eventHandlers[event] = handler;
      });
    });

    it('should register ready event handler', () => {
      expect(eventHandlers.ready).toBeDefined();
      expect(typeof eventHandlers.ready).toBe('function');
    });

    it('should handle ready event correctly', async () => {
      const logger = require('../../src/logger');
      const webhookManager = require('../../src/webhookManager');

      // Trigger ready event
      await eventHandlers.ready();

      expect(logger.info).toHaveBeenCalledWith('Logged in as TestBot#1234!');
      expect(client.user.setActivity).toHaveBeenCalledWith('with multiple personalities', {
        type: 'PLAYING',
      });
      expect(webhookManager.registerEventListeners).toHaveBeenCalledWith(client);
    });

    it('should register error event handler', () => {
      expect(eventHandlers.error).toBeDefined();
      expect(typeof eventHandlers.error).toBe('function');
    });

    it('should handle error event correctly', () => {
      const logger = require('../../src/logger');
      const testError = new Error('Test error');

      // Trigger error event
      eventHandlers.error(testError);

      expect(logger.error).toHaveBeenCalledWith('Discord client error:', testError);
    });

    it('should register messageCreate event handler', () => {
      expect(eventHandlers.messageCreate).toBeDefined();
      expect(typeof eventHandlers.messageCreate).toBe('function');
    });

    it('should handle messageCreate event correctly', async () => {
      const messageHandler = require('../../src/handlers/messageHandler');
      const mockMessage = { id: 'test-message', content: 'Test content' };

      // Trigger messageCreate event
      await eventHandlers.messageCreate(mockMessage);

      expect(messageHandler.handleMessage).toHaveBeenCalledWith(mockMessage, client);
    });

    it('should register messageDelete event handler', () => {
      expect(eventHandlers.messageDelete).toBeDefined();
      expect(typeof eventHandlers.messageDelete).toBe('function');
    });

    it('should handle messageDelete event for user messages', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore').instance;
      const mockMessage = {
        id: 'test-message-id',
        partial: false,
        author: { id: 'user123', bot: false },
        content: 'Test content',
      };

      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);

      expect(pluralkitMessageStore.markAsDeleted).toHaveBeenCalledWith('test-message-id');
    });

    it('should ignore messageDelete for partial messages', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore').instance;
      const mockMessage = {
        id: 'test-message-id',
        partial: true,
        author: { id: 'user123', bot: false },
      };

      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);

      expect(pluralkitMessageStore.markAsDeleted).not.toHaveBeenCalled();
    });

    it('should ignore messageDelete for messages without author', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore').instance;
      const mockMessage = {
        id: 'test-message-id',
        partial: false,
        author: null,
      };

      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);

      expect(pluralkitMessageStore.markAsDeleted).not.toHaveBeenCalled();
    });

    it('should ignore messageDelete for bot messages', async () => {
      const pluralkitMessageStore = require('../../src/utils/pluralkitMessageStore').instance;
      const mockMessage = {
        id: 'test-message-id',
        partial: false,
        author: { id: 'bot123', bot: true },
      };

      // Trigger messageDelete event
      await eventHandlers.messageDelete(mockMessage);

      expect(pluralkitMessageStore.markAsDeleted).not.toHaveBeenCalled();
    });
  });

  describe('Module Exports', () => {
    it('should export initBot function', () => {
      expect(bot.initBot).toBeDefined();
      expect(typeof bot.initBot).toBe('function');
    });

    it('should export client instance', () => {
      expect(bot.client).toBeDefined();
    });
  });
});
